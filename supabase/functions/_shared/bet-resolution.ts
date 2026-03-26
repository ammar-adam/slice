import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

export function computeParticipantOutcome(args: {
  side: "over" | "under";
  delayProbability: number;
  actualMinutes: number;
  etaInitialMinutes: number;
}): { is_correct: boolean; points_delta: number } {
  const modelSide = args.delayProbability > 0.5 ? "over" : "under";
  const won = args.side === "over"
    ? args.actualMinutes > args.etaInitialMinutes
    : args.actualMinutes <= args.etaInitialMinutes;
  if (!won) return { is_correct: false, points_delta: -20 };
  let pts = 50;
  if (args.side !== modelSide) pts += 80;
  return { is_correct: true, points_delta: pts };
}

type BetRow = {
  id: string;
  host_id: string;
  status: string;
  delay_probability: number;
};

type ParticipantRow = {
  id: string;
  display_name: string;
  side: "over" | "under";
  participant_fingerprint: string | null;
};

async function bumpHostStatsAggregate(
  supabase: SupabaseClient,
  hostId: string,
  deltaParticipated: number,
  deltaCorrect: number,
) {
  const { data: row } = await supabase.from("host_stats").select(
    "bets_participated,bets_correct,accuracy_pct,current_streak,best_streak",
  ).eq("host_id", hostId).maybeSingle();
  const participated = (row?.bets_participated ?? 0) + deltaParticipated;
  const correct = (row?.bets_correct ?? 0) + deltaCorrect;
  const accuracy_pct = participated > 0 ? (correct / participated) * 100 : 0;
  await supabase.from("host_stats").upsert({
    host_id: hostId,
    bets_participated: participated,
    bets_correct: correct,
    accuracy_pct,
    current_streak: row?.current_streak ?? 0,
    best_streak: row?.best_streak ?? 0,
  });
}

async function bumpParticipantIdentity(
  supabase: SupabaseClient,
  fingerprint: string,
  displayName: string,
  isCorrect: boolean,
) {
  const { data: row } = await supabase.from("participant_identity_stats")
    .select("bets_participated,bets_correct,accuracy_pct,current_streak")
    .eq("fingerprint", fingerprint).maybeSingle();
  const participated = (row?.bets_participated ?? 0) + 1;
  const correct = (row?.bets_correct ?? 0) + (isCorrect ? 1 : 0);
  const accuracy_pct = participated > 0 ? (correct / participated) * 100 : 0;
  const current_streak = isCorrect ? (row?.current_streak ?? 0) + 1 : 0;
  await supabase.from("participant_identity_stats").upsert({
    fingerprint,
    display_name_last: displayName,
    bets_participated: participated,
    bets_correct: correct,
    accuracy_pct,
    current_streak,
  });
}

export async function resolveBetAndParticipants(
  supabase: SupabaseClient,
  bet: BetRow,
  participants: ParticipantRow[],
  args: { actualMinutes: number; etaInitialMinutes: number; nowIso: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  let hostDeltaPart = 0;
  let hostDeltaCorrect = 0;

  for (const p of participants) {
    const out = computeParticipantOutcome({
      side: p.side,
      delayProbability: bet.delay_probability,
      actualMinutes: args.actualMinutes,
      etaInitialMinutes: args.etaInitialMinutes,
    });
    hostDeltaPart += 1;
    if (out.is_correct) hostDeltaCorrect += 1;
    const { error: pErr } = await supabase.from("bet_participants").update({
      is_correct: out.is_correct,
      points_delta: out.points_delta,
    }).eq("id", p.id);
    if (pErr) return { ok: false, error: pErr.message };
    if (p.participant_fingerprint) {
      await bumpParticipantIdentity(
        supabase,
        p.participant_fingerprint,
        p.display_name,
        out.is_correct,
      );
    }
  }

  await bumpHostStatsAggregate(supabase, bet.host_id, hostDeltaPart, hostDeltaCorrect);

  const { error: bErr } = await supabase.from("bets").update({
    status: "resolved",
    resolved_at: args.nowIso,
  }).eq("id", bet.id);
  if (bErr) return { ok: false, error: bErr.message };
  return { ok: true };
}

export async function voidOpenBet(
  supabase: SupabaseClient,
  betId: string,
  reason: string,
  nowIso: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error: pErr } = await supabase.from("bet_participants").update({
    is_correct: null,
    points_delta: null,
  }).eq("bet_id", betId);
  if (pErr) return { ok: false, error: pErr.message };
  const { error: bErr } = await supabase.from("bets").update({
    status: "void",
    voided_at: nowIso,
    void_reason: reason,
  }).eq("id", betId);
  if (bErr) return { ok: false, error: bErr.message };
  return { ok: true };
}
