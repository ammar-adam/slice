-- Slice: core tables, constraints, indexes, triggers
-- Order: 00000000000001
-- Decisions: market line = eta_initial only; void if no delivery by resolve_deadline_at;
--            rankings use restaurant name only (no addresses in UI).

-- -----------------------------------------------------------------------------
-- updated_at helper
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.set_updated_at() IS 'Sets updated_at to now() on row change';

-- -----------------------------------------------------------------------------
-- hosts
-- -----------------------------------------------------------------------------

CREATE TABLE public.hosts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nextauth_user_id text NOT NULL UNIQUE,
  google_sub text UNIQUE,
  email text UNIQUE,
  display_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX hosts_email_idx ON public.hosts (email);

CREATE TRIGGER hosts_set_updated_at
  BEFORE UPDATE ON public.hosts
  FOR EACH ROW
  EXECUTE PROCEDURE public.set_updated_at();

COMMENT ON TABLE public.hosts IS 'Order host identity (NextAuth subject mapping)';
COMMENT ON COLUMN public.hosts.nextauth_user_id IS 'Stable NextAuth user.id (JWT sub mapping)';
COMMENT ON COLUMN public.hosts.google_sub IS 'Google subject identifier when available';

-- -----------------------------------------------------------------------------
-- google_oauth_tokens (refresh token encrypted at application layer)
-- -----------------------------------------------------------------------------

CREATE TABLE public.google_oauth_tokens (
  host_id uuid PRIMARY KEY REFERENCES public.hosts (id) ON DELETE CASCADE,
  refresh_token text NOT NULL,
  access_token text,
  access_token_expires_at timestamptz,
  scopes text[] NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT google_oauth_tokens_scopes_not_empty CHECK (array_length(scopes, 1) IS NOT NULL AND array_length(scopes, 1) > 0)
);

CREATE TRIGGER google_oauth_tokens_set_updated_at
  BEFORE UPDATE ON public.google_oauth_tokens
  FOR EACH ROW
  EXECUTE PROCEDURE public.set_updated_at();

COMMENT ON TABLE public.google_oauth_tokens IS 'Offline Gmail access; refresh_token must be encrypted before storage';
COMMENT ON COLUMN public.google_oauth_tokens.scopes IS 'Must include https://www.googleapis.com/auth/gmail.readonly';

-- -----------------------------------------------------------------------------
-- orders
-- -----------------------------------------------------------------------------

CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id uuid NOT NULL REFERENCES public.hosts (id) ON DELETE CASCADE,
  platform text NOT NULL DEFAULT 'uber_eats',
  restaurant_name text NOT NULL,
  restaurant_name_normalized text NOT NULL,
  delivery_address_summary text,
  eta_initial_minutes integer,
  eta_final_minutes integer,
  actual_delivery_minutes integer,
  order_placed_at timestamptz NOT NULL,
  weather_precip_mm_hr double precision,
  distance_km double precision,
  delay_score double precision,
  resolved boolean NOT NULL DEFAULT false,
  resolved_at timestamptz,
  gmail_message_id_placed text,
  gmail_message_id_enroute text,
  gmail_message_id_delivered text,
  parser_version integer NOT NULL DEFAULT 1,
  raw_parser_debug jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT orders_platform_check CHECK (platform IN ('uber_eats', 'doordash', 'skip', 'unknown')),
  CONSTRAINT orders_eta_initial_nonnegative CHECK (eta_initial_minutes IS NULL OR eta_initial_minutes >= 0),
  CONSTRAINT orders_eta_final_nonnegative CHECK (eta_final_minutes IS NULL OR eta_final_minutes >= 0),
  CONSTRAINT orders_actual_nonnegative CHECK (actual_delivery_minutes IS NULL OR actual_delivery_minutes >= 0),
  CONSTRAINT orders_delay_score_range CHECK (delay_score IS NULL OR (delay_score >= 0::double precision AND delay_score <= 1::double precision)),
  CONSTRAINT orders_resolved_consistency CHECK (
    (resolved = false AND resolved_at IS NULL)
    OR (resolved = true AND resolved_at IS NOT NULL)
  )
);

CREATE INDEX orders_host_id_idx ON public.orders (host_id);
CREATE INDEX orders_host_order_placed_at_desc_idx ON public.orders (host_id, order_placed_at DESC);
CREATE INDEX orders_resolved_order_placed_at_desc_idx ON public.orders (resolved, order_placed_at DESC);
CREATE INDEX orders_restaurant_norm_placed_idx ON public.orders (restaurant_name_normalized, order_placed_at DESC);

CREATE TRIGGER orders_set_updated_at
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE PROCEDURE public.set_updated_at();

COMMENT ON TABLE public.orders IS 'Delivery orders ingested from Gmail (and later App Clip)';
COMMENT ON COLUMN public.orders.eta_initial_minutes IS 'Market line: bet resolves vs initial ETA only per product decision';
COMMENT ON COLUMN public.orders.eta_final_minutes IS 'Stored for analytics; not used as the market line';
COMMENT ON COLUMN public.orders.delay_score IS 'Model output 0–1 at time of order (late probability)';
COMMENT ON COLUMN public.orders.delivery_address_summary IS 'Parse artifact; never expose on rankings';

-- -----------------------------------------------------------------------------
-- bets
-- -----------------------------------------------------------------------------

CREATE TABLE public.bets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_slug text NOT NULL UNIQUE,
  host_id uuid NOT NULL REFERENCES public.hosts (id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.orders (id) ON DELETE RESTRICT,
  dare_text text,
  delay_probability double precision NOT NULL,
  status text NOT NULL DEFAULT 'open',
  resolve_deadline_at timestamptz NOT NULL,
  resolved_at timestamptz,
  voided_at timestamptz,
  void_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bets_status_check CHECK (status IN ('open', 'resolved', 'void')),
  CONSTRAINT bets_delay_probability_range CHECK (
    delay_probability >= 0::double precision
    AND delay_probability <= 1::double precision
  ),
  CONSTRAINT bets_resolved_consistency CHECK (
    (status = 'open' AND resolved_at IS NULL AND voided_at IS NULL)
    OR (status = 'resolved' AND resolved_at IS NOT NULL AND voided_at IS NULL)
    OR (status = 'void' AND voided_at IS NOT NULL AND resolved_at IS NULL)
  ),
  CONSTRAINT bets_void_reason_check CHECK (void_reason IS NULL OR status = 'void')
);

CREATE INDEX bets_order_id_idx ON public.bets (order_id);
CREATE INDEX bets_host_id_idx ON public.bets (host_id);
CREATE INDEX bets_status_deadline_idx ON public.bets (status, resolve_deadline_at);

CREATE TRIGGER bets_set_updated_at
  BEFORE UPDATE ON public.bets
  FOR EACH ROW
  EXECUTE PROCEDURE public.set_updated_at();

COMMENT ON TABLE public.bets IS 'Shareable market for a single order';
COMMENT ON COLUMN public.bets.resolve_deadline_at IS 'No delivery email by this time => void; typically order_placed_at + eta_initial + 180 min';
COMMENT ON COLUMN public.bets.delay_probability IS 'Snapshot of model late probability at bet creation (over hits if late vs eta_initial)';
COMMENT ON COLUMN public.bets.void_reason IS 'Audit trail, e.g. resolve_deadline_elapsed_no_delivery_email';

-- -----------------------------------------------------------------------------
-- bet_participants
-- -----------------------------------------------------------------------------

CREATE TABLE public.bet_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bet_id uuid NOT NULL REFERENCES public.bets (id) ON DELETE CASCADE,
  display_name text NOT NULL,
  side text NOT NULL,
  participant_fingerprint text,
  is_correct boolean,
  points_delta integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bet_participants_side_check CHECK (side IN ('over', 'under')),
  CONSTRAINT bet_participants_unique_name_per_bet UNIQUE (bet_id, display_name)
);

CREATE INDEX bet_participants_bet_id_idx ON public.bet_participants (bet_id);

COMMENT ON TABLE public.bet_participants IS 'Friend picks; multi-winner: all correct side winners get points; void => no points';
COMMENT ON COLUMN public.bet_participants.participant_fingerprint IS 'Optional stable pseudonym bucket for MVP stats';

-- -----------------------------------------------------------------------------
-- host_stats
-- -----------------------------------------------------------------------------

CREATE TABLE public.host_stats (
  host_id uuid PRIMARY KEY REFERENCES public.hosts (id) ON DELETE CASCADE,
  bets_participated integer NOT NULL DEFAULT 0,
  bets_correct integer NOT NULL DEFAULT 0,
  accuracy_pct double precision NOT NULL DEFAULT 0,
  current_streak integer NOT NULL DEFAULT 0,
  best_streak integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT host_stats_counts_nonnegative CHECK (
    bets_participated >= 0
    AND bets_correct >= 0
    AND current_streak >= 0
    AND best_streak >= 0
  ),
  CONSTRAINT host_stats_accuracy_range CHECK (
    accuracy_pct >= 0::double precision
    AND accuracy_pct <= 100::double precision
  ),
  CONSTRAINT host_stats_correct_lte_participated CHECK (bets_correct <= bets_participated)
);

CREATE TRIGGER host_stats_set_updated_at
  BEFORE UPDATE ON public.host_stats
  FOR EACH ROW
  EXECUTE PROCEDURE public.set_updated_at();

COMMENT ON TABLE public.host_stats IS 'Rolling aggregates for hosts';

-- -----------------------------------------------------------------------------
-- participant_identity_stats
-- -----------------------------------------------------------------------------

CREATE TABLE public.participant_identity_stats (
  fingerprint text PRIMARY KEY,
  display_name_last text,
  bets_participated integer NOT NULL DEFAULT 0,
  bets_correct integer NOT NULL DEFAULT 0,
  accuracy_pct double precision NOT NULL DEFAULT 0,
  current_streak integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT participant_identity_stats_counts_nonnegative CHECK (
    bets_participated >= 0
    AND bets_correct >= 0
    AND current_streak >= 0
  ),
  CONSTRAINT participant_identity_stats_accuracy_range CHECK (
    accuracy_pct >= 0::double precision
    AND accuracy_pct <= 100::double precision
  ),
  CONSTRAINT participant_identity_stats_correct_lte_participated CHECK (bets_correct <= bets_participated)
);

CREATE TRIGGER participant_identity_stats_set_updated_at
  BEFORE UPDATE ON public.participant_identity_stats
  FOR EACH ROW
  EXECUTE PROCEDURE public.set_updated_at();

COMMENT ON TABLE public.participant_identity_stats IS 'MVP pseudonymous accuracy for name-only bettors';

-- -----------------------------------------------------------------------------
-- restaurant_priors
-- -----------------------------------------------------------------------------

CREATE TABLE public.restaurant_priors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_name_normalized text NOT NULL UNIQUE,
  late_rate_prior double precision NOT NULL,
  mention_count integer NOT NULL DEFAULT 0,
  source text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT restaurant_priors_late_rate_range CHECK (
    late_rate_prior >= 0::double precision
    AND late_rate_prior <= 1::double precision
  ),
  CONSTRAINT restaurant_priors_mention_nonnegative CHECK (mention_count >= 0),
  CONSTRAINT restaurant_priors_source_check CHECK (source IN ('reddit_seed', 'empirical'))
);

CREATE TRIGGER restaurant_priors_set_updated_at
  BEFORE UPDATE ON public.restaurant_priors
  FOR EACH ROW
  EXECUTE PROCEDURE public.set_updated_at();

COMMENT ON TABLE public.restaurant_priors IS 'Reddit seed + empirical priors for cold-start model';

-- -----------------------------------------------------------------------------
-- gmail_sync_state (polling; week-1 — no watch/Pub/Sub)
-- -----------------------------------------------------------------------------

CREATE TABLE public.gmail_sync_state (
  host_id uuid PRIMARY KEY REFERENCES public.hosts (id) ON DELETE CASCADE,
  history_id text,
  last_synced_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER gmail_sync_state_set_updated_at
  BEFORE UPDATE ON public.gmail_sync_state
  FOR EACH ROW
  EXECUTE PROCEDURE public.set_updated_at();

COMMENT ON TABLE public.gmail_sync_state IS 'Incremental Gmail polling cursor per host; edge cron every 5 minutes';
COMMENT ON COLUMN public.gmail_sync_state.history_id IS 'Gmail History API id when used; optional for MVP list-based polling';