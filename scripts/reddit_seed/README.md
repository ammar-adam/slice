## Reddit priors seed (restaurant_priors)

### Requirements
- Python 3.11+
- Reddit API credentials:
  - `REDDIT_CLIENT_ID`
  - `REDDIT_CLIENT_SECRET`
  - `REDDIT_USER_AGENT` (optional)
- Supabase credentials (service role recommended):
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`

### Install

```bash
pip install -r ../../requirements.txt
```

### Run

Example:

```bash
python seed_priors.py --subreddit waterloo --limit 500
```

Outputs `restaurant_priors.json` in the current directory and upserts into the `restaurant_priors` table.

