-- Slice: row level security, lockdown policies, public RPCs
-- Order: 00000000000002
-- Next.js + Edge use service_role (bypasses RLS). Anon/auth caller uses RPCs only.

-- -----------------------------------------------------------------------------
-- RLS: enable on all tables
-- -----------------------------------------------------------------------------

ALTER TABLE public.hosts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_oauth_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bet_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.host_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.participant_identity_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_priors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gmail_sync_state ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- Explicit deny for anon + authenticated (defense if table GRANTs are added later)
-- -----------------------------------------------------------------------------

CREATE POLICY hosts_deny_direct_anon_authenticated
  ON public.hosts
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

CREATE POLICY google_oauth_tokens_deny_direct_anon_authenticated
  ON public.google_oauth_tokens
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

CREATE POLICY orders_deny_direct_anon_authenticated
  ON public.orders
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

CREATE POLICY bets_deny_direct_anon_authenticated
  ON public.bets
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

CREATE POLICY bet_participants_deny_direct_anon_authenticated
  ON public.bet_participants
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

CREATE POLICY host_stats_deny_direct_anon_authenticated
  ON public.host_stats
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

CREATE POLICY participant_identity_stats_deny_direct_anon_authenticated
  ON public.participant_identity_stats
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

CREATE POLICY restaurant_priors_deny_direct_anon_authenticated
  ON public.restaurant_priors
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

CREATE POLICY gmail_sync_state_deny_direct_anon_authenticated
  ON public.gmail_sync_state
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

-- -----------------------------------------------------------------------------
-- Public read model for share links (no addresses, no tokens, no fingerprints)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_bet_by_slug(p_slug text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT jsonb_build_object(
    'bet', jsonb_build_object(
      'id', b.id,
      'public_slug', b.public_slug,
      'status', b.status,
      'dare_text', b.dare_text,
      'delay_probability', b.delay_probability,
      'resolve_deadline_at', b.resolve_deadline_at,
      'resolved_at', b.resolved_at,
      'voided_at', b.voided_at,
      'void_reason', b.void_reason,
      'created_at', b.created_at
    ),
    'order', jsonb_build_object(
      'restaurant_name', o.restaurant_name,
      'eta_initial_minutes', o.eta_initial_minutes,
      'order_placed_at', o.order_placed_at,
      'resolved', o.resolved,
      'actual_delivery_minutes', o.actual_delivery_minutes,
      'delay_score', o.delay_score
    ),
    'participants', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'display_name', p.display_name,
          'side', p.side,
          'is_correct', p.is_correct,
          'points_delta', p.points_delta,
          'created_at', p.created_at
        )
        ORDER BY p.created_at ASC
      )
      FROM public.bet_participants p
      WHERE p.bet_id = b.id
    ), '[]'::jsonb)
  )
  FROM public.bets b
  INNER JOIN public.orders o ON o.id = b.order_id
  WHERE b.public_slug = p_slug
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.get_bet_by_slug(text) IS 'Public bet payload; never exposes addresses or OAuth secrets';

-- -----------------------------------------------------------------------------
-- Rankings: counts per normalized restaurant (app gates public detail at >= 5)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_restaurant_ranking_summaries()
RETURNS TABLE (
  restaurant_name_normalized text,
  display_name text,
  resolved_order_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT
    o.restaurant_name_normalized,
    MAX(o.restaurant_name)::text AS display_name,
    COUNT(*)::bigint AS resolved_order_count
  FROM public.orders o
  WHERE o.resolved = true
  GROUP BY o.restaurant_name_normalized;
$$;

COMMENT ON FUNCTION public.get_restaurant_ranking_summaries() IS 'Public ranking rollups; name-only fields; app locks rows with resolved_order_count < 5';

-- -----------------------------------------------------------------------------
-- Grants / revokes (tables: service_role + postgres only via defaults; strip public/anon where needed)
-- -----------------------------------------------------------------------------

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

REVOKE ALL ON TABLE public.hosts FROM anon, authenticated;
REVOKE ALL ON TABLE public.google_oauth_tokens FROM anon, authenticated;
REVOKE ALL ON TABLE public.orders FROM anon, authenticated;
REVOKE ALL ON TABLE public.bets FROM anon, authenticated;
REVOKE ALL ON TABLE public.bet_participants FROM anon, authenticated;
REVOKE ALL ON TABLE public.host_stats FROM anon, authenticated;
REVOKE ALL ON TABLE public.participant_identity_stats FROM anon, authenticated;
REVOKE ALL ON TABLE public.restaurant_priors FROM anon, authenticated;
REVOKE ALL ON TABLE public.gmail_sync_state FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.hosts TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.google_oauth_tokens TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.orders TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.bets TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.bet_participants TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.host_stats TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.participant_identity_stats TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.restaurant_priors TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.gmail_sync_state TO service_role;

GRANT EXECUTE ON FUNCTION public.get_bet_by_slug(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_restaurant_ranking_summaries() TO anon, authenticated;
