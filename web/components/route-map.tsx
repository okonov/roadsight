"use client";

import Image from "next/image";
import { useState } from "react";
import { STATIC_MAP_SIZES, StaticMapSize } from "@/lib/maps/static-map";
import { Route } from "@/lib/routes/types";

interface RouteMapProps {
  route: Route;
  size?: StaticMapSize;
  /** Sizing classes for the rendered box; height always follows from the 8:5 aspect. */
  className?: string;
}

/**
 * Static map of a resolved route's endpoints. Renders nothing when the route has no
 * endpoints yet, or when the map can't be produced (no Azure Maps key configured, service
 * down) — every caller still works without a picture.
 */
export function RouteMap({ route, size = "preview", className = "w-full" }: RouteMapProps) {
  const [failed, setFailed] = useState(false);

  if (!route.origin || !route.destination || failed) return null;

  const { width, height } = STATIC_MAP_SIZES[size];

  return (
    <Image
      // Endpoints can change without the URL changing, so version it on the route's own
      // timestamp; the proxy caches the image for a day.
      src={`/api/routes/${route.id}/map?size=${size}&v=${encodeURIComponent(route.updatedAt)}`}
      alt={`Map from ${route.origin.label} to ${route.destination.label}`}
      width={width}
      height={height}
      // Already rendered at the size it is displayed at; the optimizer would only re-encode
      // a finished PNG.
      unoptimized
      onError={() => setFailed(true)}
      className={`h-auto rounded border border-foreground/10 bg-foreground/5 ${className}`}
    />
  );
}
