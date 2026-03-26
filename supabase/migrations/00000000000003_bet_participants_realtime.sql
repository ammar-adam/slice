-- Allow public clients to read bet_participants for open bets (realtime + minimal surface).
-- Permissive FOR ALL deny policy ORs with this SELECT policy.

CREATE POLICY bet_participants_select_open_bets
  ON public.bet_participants
  FOR SELECT
  TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.bets b
      WHERE b.id = bet_participants.bet_id
        AND b.status = 'open'
    )
  );

GRANT SELECT ON TABLE public.bet_participants TO anon, authenticated;

ALTER TABLE public.bet_participants REPLICA IDENTITY FULL;

ALTER PUBLICATION supabase_realtime ADD TABLE public.bet_participants;
