"""
Reddit seed scraper for `restaurant_priors`.

Scrapes complaint posts/comments, extracts restaurant mentions, and writes:
- restaurant_priors.json
Then upserts into Supabase `restaurant_priors`.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Iterable

from dotenv import load_dotenv

import praw
from supabase import create_client


COMPLAINT_TERMS = [
    "late delivery",
    "took forever",
    "never arrived",
    "cold food",
    "wrong order",
    "cancelled",
]

SUBREDDITS_DEFAULT = ["waterloo", "UberEats", "ontario", "KitchenerWaterloo"]

# Heuristic: sequences of capitalized words (allow & and apostrophes) near complaint language.
RESTAURANT_MENTION_RE = re.compile(
    r"\b([A-Z][A-Za-z0-9'&]+(?:\s+[A-Z][A-Za-z0-9'&]+){0,4})\b"
)

NEGATIVE_HINT_RE = re.compile(
    r"\b(late|never arrived|cancel+|cold|wrong order|took forever|awful|terrible|worst)\b",
    re.IGNORECASE,
)


def normalize_restaurant_name(name: str) -> str:
    # Must match canonical rules used in app: lowercase, strip diacritics, drop punctuation except &, collapse whitespace.
    import unicodedata

    s = unicodedata.normalize("NFD", name.lower())
    s = "".join(ch for ch in s if unicodedata.category(ch) != "Mn")
    s = re.sub(r"[^a-z0-9\s&]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


@dataclass(frozen=True)
class Mention:
    restaurant_norm: str
    raw: str
    weight: int
    negative: bool


def iter_text_blobs(submission) -> Iterable[tuple[str, int]]:
    upvotes = max(1, int(getattr(submission, "score", 0) or 0))
    title = getattr(submission, "title", "") or ""
    selftext = getattr(submission, "selftext", "") or ""
    yield (f"{title}\n{selftext}", upvotes)
    try:
        submission.comments.replace_more(limit=0)
        for c in submission.comments.list():
            body = getattr(c, "body", "") or ""
            score = max(1, int(getattr(c, "score", 0) or 0))
            yield (body, score)
    except Exception:
        return


def extract_mentions(text: str, weight: int) -> list[Mention]:
    negative = bool(NEGATIVE_HINT_RE.search(text))
    # Only consider mentions when the text includes complaint-ish terms.
    complaintish = any(t.lower() in text.lower() for t in COMPLAINT_TERMS) or negative
    if not complaintish:
        return []
    out: list[Mention] = []
    for m in RESTAURANT_MENTION_RE.finditer(text):
        raw = m.group(1).strip()
        if len(raw) < 3:
            continue
        norm = normalize_restaurant_name(raw)
        if len(norm) < 3:
            continue
        # Filter obvious non-restaurants.
        if norm in {"uber eats", "ubereats", "waterloo", "ontario"}:
            continue
        out.append(Mention(restaurant_norm=norm, raw=raw, weight=weight, negative=negative))
    return out


def compute_priors(mentions: list[Mention]) -> list[dict]:
    if not mentions:
        return []

    total_by_rest = Counter()
    neg_by_rest = Counter()

    for m in mentions:
        total_by_rest[m.restaurant_norm] += m.weight
        if m.negative:
            neg_by_rest[m.restaurant_norm] += m.weight

    rows: list[dict] = []
    for rest, total_w in total_by_rest.items():
        neg_w = neg_by_rest.get(rest, 0)
        ratio = (neg_w / total_w) if total_w > 0 else 0.0
        late_rate_prior = 0.5 + (ratio * 0.4)
        late_rate_prior = max(0.35, min(0.90, late_rate_prior))
        rows.append(
            {
                "restaurant_name_normalized": rest,
                "late_rate_prior": float(late_rate_prior),
                "mention_count": int(total_w),
                "source": "reddit_seed",
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
        )

    rows.sort(key=lambda r: (r["mention_count"], r["late_rate_prior"]), reverse=True)
    return rows


def upsert_supabase(rows: list[dict]) -> None:
    url = os.getenv("NEXT_PUBLIC_SUPABASE_URL") or os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_KEY")
    if not url or not key:
        raise SystemExit("Missing SUPABASE url/key env (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).")

    supabase = create_client(url, key)
    # Upsert; DB has unique on restaurant_name_normalized.
    # We only want to update if mention_count is higher.
    for row in rows:
        existing = (
            supabase.table("restaurant_priors")
            .select("mention_count")
            .eq("restaurant_name_normalized", row["restaurant_name_normalized"])
            .execute()
        )
        existing_count = 0
        if existing.data and isinstance(existing.data, list) and len(existing.data) > 0:
            existing_count = int(existing.data[0].get("mention_count") or 0)
        if row["mention_count"] <= existing_count:
            continue
        supabase.table("restaurant_priors").upsert(row, on_conflict="restaurant_name_normalized").execute()


def main() -> None:
    load_dotenv()
    ap = argparse.ArgumentParser()
    ap.add_argument("--subreddit", action="append", default=[], help="Subreddit (repeatable).")
    ap.add_argument("--limit", type=int, default=500, help="Max submissions per subreddit search.")
    ap.add_argument("--out", default="restaurant_priors.json", help="Output json filename.")
    args = ap.parse_args()

    subreddits = args.subreddit if args.subreddit else SUBREDDITS_DEFAULT
    reddit_id = os.getenv("REDDIT_CLIENT_ID")
    reddit_secret = os.getenv("REDDIT_CLIENT_SECRET")
    reddit_agent = os.getenv("REDDIT_USER_AGENT") or "slice-seed/1.0"
    if not reddit_id or not reddit_secret:
        raise SystemExit("Missing REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET in env.")

    reddit = praw.Reddit(
        client_id=reddit_id,
        client_secret=reddit_secret,
        user_agent=reddit_agent,
    )

    mentions: list[Mention] = []
    for sr in subreddits:
        subreddit = reddit.subreddit(sr)
        for term in COMPLAINT_TERMS:
            try:
                for submission in subreddit.search(term, limit=args.limit, sort="new"):
                    for blob, weight in iter_text_blobs(submission):
                        mentions.extend(extract_mentions(blob, weight))
            except Exception:
                continue

    rows = compute_priors(mentions)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(rows, f, indent=2, ensure_ascii=False)

    upsert_supabase(rows)
    print(f"Wrote {len(rows)} priors to {args.out} and upserted to Supabase.")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)
