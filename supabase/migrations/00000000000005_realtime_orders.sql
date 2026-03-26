-- Realtime for orders + policy for open bet subscribers

-- Allow minimal realtime subscriptions for order updates when there exists an open bet on the order.
CREATE OR REPLACE FUNCTION public.can_read_order_updates(p_order_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.bets b
    WHERE b.order_id = p_order_id
      AND b.status = 'open'
  );
$$;

COMMENT ON FUNCTION public.can_read_order_updates(uuid) IS 'Gate order realtime/select to open bets only';

CREATE POLICY orders_select_open_bets
  ON public.orders
  FOR SELECT
  TO anon, authenticated
  USING (public.can_read_order_updates(id));

GRANT SELECT ON TABLE public.orders TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_order_updates(uuid) TO anon, authenticated;

ALTER TABLE public.orders REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;

