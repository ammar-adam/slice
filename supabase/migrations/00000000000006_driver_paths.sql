-- Driver path storage for animated tracking

CREATE TABLE public.order_driver_paths (
  order_id uuid PRIMARY KEY REFERENCES public.orders (id) ON DELETE CASCADE,
  restaurant_lat double precision NOT NULL,
  restaurant_lng double precision NOT NULL,
  delivery_lat double precision NOT NULL,
  delivery_lng double precision NOT NULL,
  waypoints jsonb NOT NULL,
  encoded_polyline text,
  total_distance_km double precision,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.order_driver_paths ENABLE ROW LEVEL SECURITY;

CREATE POLICY order_driver_paths_select_open_bets
  ON public.order_driver_paths
  FOR SELECT
  TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.bets b
      WHERE b.order_id = order_driver_paths.order_id
        AND b.status = 'open'
    )
  );

GRANT SELECT ON TABLE public.order_driver_paths TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.order_driver_paths TO service_role;

