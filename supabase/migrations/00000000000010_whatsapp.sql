-- WhatsApp Cloud API: identity, dedupe, conversation state, host wa_id column
-- Service role only for new tables (Next.js uses service_role; anon/auth denied).

ALTER TABLE public.hosts
  ADD COLUMN IF NOT EXISTS whatsapp_wa_id text;

CREATE UNIQUE INDEX IF NOT EXISTS hosts_whatsapp_wa_id_uniq
  ON public.hosts (whatsapp_wa_id)
  WHERE whatsapp_wa_id IS NOT NULL;

COMMENT ON COLUMN public.hosts.whatsapp_wa_id IS 'Meta WhatsApp user id for this host when created via WhatsApp';

CREATE TABLE public.whatsapp_identities (
  wa_id text PRIMARY KEY,
  host_id uuid NOT NULL REFERENCES public.hosts (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX whatsapp_identities_host_id_uniq
  ON public.whatsapp_identities (host_id);

COMMENT ON TABLE public.whatsapp_identities IS 'Maps Meta wa_id to Slice host_id (synthetic nextauth_user_id = whatsapp:{wa_id})';

CREATE TABLE public.whatsapp_inbound_messages (
  message_id text PRIMARY KEY,
  wa_id text NOT NULL,
  body text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX whatsapp_inbound_messages_wa_id_created_idx
  ON public.whatsapp_inbound_messages (wa_id, created_at DESC);

COMMENT ON TABLE public.whatsapp_inbound_messages IS 'Inbound dedupe by Meta message id; body retained for demo debugging only';

CREATE TABLE public.whatsapp_conversation_state (
  wa_id text PRIMARY KEY,
  state text NOT NULL DEFAULT 'idle',
  context_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER whatsapp_conversation_state_set_updated_at
  BEFORE UPDATE ON public.whatsapp_conversation_state
  FOR EACH ROW
  EXECUTE PROCEDURE public.set_updated_at();

COMMENT ON TABLE public.whatsapp_conversation_state IS 'Per-wa_id bot state machine (idle, awaiting_dare, ...)';

ALTER TABLE public.whatsapp_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_inbound_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_conversation_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY whatsapp_identities_deny_all_anon_auth
  ON public.whatsapp_identities
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

CREATE POLICY whatsapp_inbound_messages_deny_all_anon_auth
  ON public.whatsapp_inbound_messages
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

CREATE POLICY whatsapp_conversation_state_deny_all_anon_auth
  ON public.whatsapp_conversation_state
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

REVOKE ALL ON TABLE public.whatsapp_identities FROM anon, authenticated;
REVOKE ALL ON TABLE public.whatsapp_inbound_messages FROM anon, authenticated;
REVOKE ALL ON TABLE public.whatsapp_conversation_state FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.whatsapp_identities TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.whatsapp_inbound_messages TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.whatsapp_conversation_state TO service_role;

-- TODO(production): purge whatsapp_inbound_messages.body rows older than 7 days (demo-week retention policy).
