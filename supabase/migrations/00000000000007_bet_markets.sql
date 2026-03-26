-- LMSR market state per bet

CREATE TABLE public.bet_markets (
  bet_id uuid PRIMARY KEY REFERENCES public.bets (id) ON DELETE CASCADE,
  lmsr_state jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.bet_markets ENABLE ROW LEVEL SECURITY;

CREATE POLICY bet_markets_select_open_bets
  ON public.bet_markets
  FOR SELECT
  TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.bets b
      WHERE b.id = bet_markets.bet_id
        AND b.status = 'open'
    )
  );

GRANT SELECT ON TABLE public.bet_markets TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.bet_markets TO service_role;

ALTER TABLE public.bet_markets REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.bet_markets;

