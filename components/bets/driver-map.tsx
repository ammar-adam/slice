"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { createBrowserSupabase } from "@/lib/supabase/browser";
import { interpolateDriverPosition } from "@/lib/tracking/driver-path";

type LatLng = { lat: number; lng: number };

function minutesBetween(a: Date, b: Date): number {
  const ms = b.getTime() - a.getTime();
  if (!Number.isFinite(ms)) return 0;
  return Math.max(0, ms / 60_000);
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

function hasGoogleMaps(): boolean {
  return typeof window !== "undefined" &&
    typeof (window as any).google !== "undefined" &&
    (window as any).google?.maps;
}

export function DriverMap(props: {
  orderId: string;
  restaurantLat: number;
  restaurantLng: number;
  deliveryLat: number;
  deliveryLng: number;
  etaMinutes: number;
  orderPlacedAt: Date;
  pickupAt: Date | null;
}) {
  const supabase = useMemo(() => createBrowserSupabase(), []);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const driverMarkerRef = useRef<any>(null);
  const routePolylineRef = useRef<any>(null);
  const animRef = useRef<number | null>(null);

  const [waypoints, setWaypoints] = useState<LatLng[] | null>(null);
  const [pickupAt, setPickupAt] = useState<Date | null>(props.pickupAt);
  const [etaFinalMinutes, setEtaFinalMinutes] = useState<number | null>(null);
  const [liveGps, setLiveGps] = useState<LatLng | null>(null);
  const [liveEtaRemaining, setLiveEtaRemaining] = useState<number | null>(null);

  const origin = useMemo(
    () => ({ lat: props.restaurantLat, lng: props.restaurantLng }),
    [props.restaurantLat, props.restaurantLng],
  );
  const dest = useMemo(
    () => ({ lat: props.deliveryLat, lng: props.deliveryLng }),
    [props.deliveryLat, props.deliveryLng],
  );

  useEffect(() => {
    // Load path from Supabase if available.
    let cancelled = false;
    (async () => {
      const { data: dataRaw, error } = await (supabase as any)
        .from("order_driver_paths")
        .select("waypoints,encoded_polyline,total_distance_km")
        .eq("order_id", props.orderId)
        .maybeSingle();
      const data = dataRaw as { waypoints?: unknown } | null;
      if (cancelled) return;
      if (error || !data) {
        setWaypoints(null);
        return;
      }
      const wp = data.waypoints as unknown;
      if (!Array.isArray(wp)) {
        setWaypoints(null);
        return;
      }
      const parsed: LatLng[] = wp
        .map((p) =>
          p && typeof p === "object"
            ? { lat: Number((p as any).lat), lng: Number((p as any).lng) }
            : null
        )
        .filter((p): p is LatLng =>
          !!p && Number.isFinite(p.lat) && Number.isFinite(p.lng)
        );
      setWaypoints(parsed.length >= 2 ? parsed : null);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, props.orderId]);

  useEffect(() => {
    const channel = supabase
      .channel(`order:${props.orderId}`)
      .on("broadcast", { event: "eta_update" }, (payload) => {
        const eta = (payload?.payload as { eta_final_minutes?: unknown })
          ?.eta_final_minutes;
        if (typeof eta === "number" && Number.isFinite(eta) && eta > 0) {
          setEtaFinalMinutes(Math.round(eta));
          setPickupAt((prev) => prev ?? new Date());
        }
      })
      .on("broadcast", { event: "location_update" }, (payload) => {
        const p = payload?.payload as {
          lat?: unknown;
          lng?: unknown;
          eta_remaining_minutes?: unknown;
        };
        const lat = typeof p?.lat === "number" ? p.lat : Number(p?.lat);
        const lng = typeof p?.lng === "number" ? p.lng : Number(p?.lng);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          setLiveGps({ lat, lng });
          setPickupAt((prev) => prev ?? new Date());
        }
        const er = p?.eta_remaining_minutes;
        if (typeof er === "number" && Number.isFinite(er) && er >= 0) {
          setLiveEtaRemaining(Math.round(er));
          setEtaFinalMinutes(Math.round(er));
        }
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, props.orderId]);

  useEffect(() => {
    if (!containerRef.current) return;
    if (!hasGoogleMaps()) return;
    if (mapRef.current) return;

    const google = (window as any).google;

    const map = new google.maps.Map(containerRef.current, {
      center: origin,
      zoom: 14,
      disableDefaultUI: true,
      clickableIcons: false,
      styles: [
        { featureType: "poi", stylers: [{ visibility: "off" }] },
        { featureType: "transit", stylers: [{ visibility: "off" }] },
        { featureType: "road", elementType: "labels.icon", stylers: [{ visibility: "off" }] },
        { elementType: "labels.text.fill", stylers: [{ color: "#6b7280" }] },
        { elementType: "geometry", stylers: [{ color: "#f3f4f6" }] },
        { featureType: "water", stylers: [{ color: "#e5e7eb" }] },
      ],
    });

    mapRef.current = map;

    const restMarker = new google.maps.Marker({
      position: origin,
      map,
      label: { text: "🍕", fontSize: "18px" },
    });

    const homeMarker = new google.maps.Marker({
      position: dest,
      map,
      label: { text: "🏠", fontSize: "18px" },
    });

    driverMarkerRef.current = new google.maps.Marker({
      position: origin,
      map,
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 8,
        fillColor: "#f97316",
        fillOpacity: 1,
        strokeColor: "#ffffff",
        strokeWeight: 2,
      },
      zIndex: 999,
    });

    // Fit bounds around endpoints.
    const bounds = new google.maps.LatLngBounds();
    bounds.extend(origin);
    bounds.extend(dest);
    map.fitBounds(bounds, 64);

    void restMarker;
    void homeMarker;
  }, [origin, dest]);

  useEffect(() => {
    if (!hasGoogleMaps()) return;
    if (!mapRef.current) return;
    const google = (window as any).google;

    if (!waypoints || waypoints.length < 2) {
      if (routePolylineRef.current) {
        routePolylineRef.current.setMap(null);
        routePolylineRef.current = null;
      }
      return;
    }

    if (routePolylineRef.current) {
      routePolylineRef.current.setMap(null);
    }

    routePolylineRef.current = new google.maps.Polyline({
      path: waypoints,
      geodesic: true,
      strokeColor: "#f97316",
      strokeOpacity: 0.9,
      strokeWeight: 3,
      icons: [
        {
          icon: { path: "M 0,-1 0,1", strokeOpacity: 1, scale: 3 },
          offset: "0",
          repeat: "12px",
        },
      ],
      map: mapRef.current,
    });
  }, [waypoints]);

  useEffect(() => {
    if (!hasGoogleMaps()) return;
    if (!driverMarkerRef.current) return;
    if (liveGps) {
      driverMarkerRef.current.setPosition(liveGps);
    }
  }, [liveGps]);

  useEffect(() => {
    // Simulated path when Uber GPS updates are not available.
    if (!hasGoogleMaps()) return;
    if (!mapRef.current || !driverMarkerRef.current) return;
    if (liveGps) return;
    if (!waypoints || waypoints.length < 2) return;

    const eta = Math.max(1, etaFinalMinutes ?? props.etaMinutes);
    const pickupDelayMinutes = pickupAt
      ? minutesBetween(props.orderPlacedAt, pickupAt)
      : Infinity;

    const step = () => {
      const now = new Date();
      const minutesElapsed = minutesBetween(props.orderPlacedAt, now);
      const moving = pickupAt != null;
      const pos = moving
        ? interpolateDriverPosition({
          waypoints,
          eta_minutes: eta,
          minutes_elapsed: minutesElapsed,
          pickup_delay_minutes: clamp(pickupDelayMinutes, 0, 120),
        })
        : { lat: origin.lat, lng: origin.lng, progress: 0 };

      driverMarkerRef.current.setPosition({ lat: pos.lat, lng: pos.lng });

      animRef.current = window.setTimeout(() => {
        requestAnimationFrame(step);
      }, 10_000);
    };

    requestAnimationFrame(step);

    return () => {
      if (animRef.current != null) window.clearTimeout(animRef.current);
      animRef.current = null;
    };
  }, [
    liveGps,
    waypoints,
    etaFinalMinutes,
    pickupAt,
    origin,
    props.etaMinutes,
    props.orderPlacedAt,
  ]);

  if (!Number.isFinite(origin.lat) || !Number.isFinite(origin.lng) || !Number.isFinite(dest.lat) ||
    !Number.isFinite(dest.lng)) {
    return (
      <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/[0.06]">
        <p className="text-sm font-semibold text-neutral-900">Tracking</p>
        <p className="mt-2 text-sm text-neutral-600">
          Tracking will appear once driver is assigned.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-black/[0.06]">
      <div className="px-5 py-4">
        <p className="text-sm font-semibold text-neutral-900">Live tracking</p>
        <p className="mt-1 text-xs text-neutral-500">
          {liveGps
            ? liveEtaRemaining != null
              ? `Live GPS · ~${liveEtaRemaining} min`
              : "Live GPS · driver on map"
            : pickupAt
              ? "Driver en route (simulated path)"
              : "Being prepared"}
        </p>
      </div>
      <div ref={containerRef} className="h-56 w-full bg-neutral-100" />
      {!hasGoogleMaps() ? (
        <div className="px-5 py-4 text-xs text-neutral-500">
          Map loading… (ensure Google Maps JS script is configured)
        </div>
      ) : null}
    </div>
  );
}

