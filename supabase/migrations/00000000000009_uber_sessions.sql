-- Uber Eats session storage (encrypted payload at application layer; RLS locked down)

CREATE TABLE public.uber_sessions (
  host_id uuid PRIMARY KEY REFERENCES public.hosts (id) ON DELETE CASCADE,
  cookie_ciphertext text NOT NULL,
  x_csrf_token text,
  authorization_header text,
  validated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER uber_sessions_set_updated_at
  BEFORE UPDATE ON public.uber_sessions
  FOR EACH ROW
  EXECUTE PROCEDURE public.set_updated_at();

COMMENT ON TABLE public.uber_sessions IS 'Uber Eats web session; cookie stored encrypted server-side only';

ALTER TABLE public.uber_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY uber_sessions_deny_all_anon_auth
  ON public.uber_sessions
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

REVOKE ALL ON TABLE public.uber_sessions FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.uber_sessions TO service_role;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS uber_order_uuid text;

CREATE UNIQUE INDEX IF NOT EXISTS orders_host_uber_uuid_uniq
  ON public.orders (host_id, uber_order_uuid)
  WHERE uber_order_uuid IS NOT NULL;
