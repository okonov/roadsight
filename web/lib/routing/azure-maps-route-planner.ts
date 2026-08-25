import { z } from "zod";
import { GeoPoint, RoutePolyline } from "@/lib/routes/types";
import { RoutePlan, RoutePlanner } from "./route-planner";

const DIRECTIONS_URL = "https://atlas.microsoft.com/route/directions";
const API_VERSION = "2025-01-01";

// A GeoJSON position is [lon, lat] with an optional third altitude element, so this cannot
// be a plain 2-tuple.
const positionSchema = z.tuple([z.number(), z.number()]).rest(z.number());

// The response is a FeatureCollection mixing echoed Waypoint points with the route itself,
// so the caller picks out the RoutePath feature rather than assuming a position.
const routePathSchema = z.object({
  geometry: z.object({
    // One line per leg. Two waypoints produce exactly one, but the service is documented to
    // return a MultiLineString regardless.
    type: z.literal("MultiLineString"),
    coordinates: z.array(z.array(positionSchema)),
  }),
  properties: z.object({
    type: z.literal("RoutePath"),
    distanceInMeters: z.number(),
    durationInSeconds: z.number(),
  }),
});

const responseSchema = z.object({ features: z.array(z.unknown()) });

/**
 * Legs joined into the single LineString the rest of the app stores and draws.
 *
 * Legs are contiguous by construction — each one ends where the next begins — so this is
 * lossless, unlike flattening an arbitrary MultiLineString. The shared point is dropped at
 * every join: a repeated coordinate is a zero-length segment, which is noise for drawing and
 * for the distance-along-path maths that camera matching will need.
 */
function joinLegs(legs: [number, number, ...number[]][][]): [number, number][] {
  const coordinates: [number, number][] = [];
  for (const leg of legs) {
    for (const [lng, lat] of leg) {
      const previous = coordinates[coordinates.length - 1];
      if (previous && previous[0] === lng && previous[1] === lat) continue;
      coordinates.push([lng, lat]);
    }
  }
  return coordinates;
}

export class AzureMapsRoutePlanner implements RoutePlanner {
  constructor(private readonly subscriptionKey: string) {}

  async plan(origin: GeoPoint, destination: GeoPoint): Promise<RoutePlan | null> {
    const params = new URLSearchParams({
      "api-version": API_VERSION,
      "subscription-key": this.subscriptionKey,
    });

    const res = await fetch(`${DIRECTIONS_URL}?${params}`, {
      method: "POST",
      headers: { "Content-Type": "application/geo+json" },
      body: JSON.stringify({
        type: "FeatureCollection",
        features: [waypoint(origin, 0), waypoint(destination, 1)],
        travelMode: "driving",
        // The spec asks for the "most recommended" route, which is the fastest one given
        // conditions now. Note this makes the persisted duration a snapshot: it is what the
        // trip would have taken at confirmation time, not a timeless estimate.
        optimizeRoute: "fastestWithTraffic",
        // Without this the response carries only the itinerary — no geometry at all.
        routeOutputOptions: ["routePath"],
        maxRouteCount: 1,
      }),
    });
    if (!res.ok) {
      throw new Error(`Azure Maps route directions failed: ${res.status} ${await res.text()}`);
    }

    const parsed = responseSchema.safeParse(await res.json());
    if (!parsed.success) return null;

    const routePath = parsed.data.features
      .map((feature) => routePathSchema.safeParse(feature))
      .find((result) => result.success)?.data;
    if (!routePath) return null;

    const coordinates = joinLegs(routePath.geometry.coordinates);
    // A single point is not a route; treat a degenerate path as no route rather than
    // persisting a polyline nothing can be drawn from.
    if (coordinates.length < 2) return null;

    const polyline: RoutePolyline = { type: "LineString", coordinates };
    return {
      polyline,
      distanceMeters: routePath.properties.distanceInMeters,
      durationSeconds: routePath.properties.durationInSeconds,
    };
  }
}

/** Waypoints are ordered by `pointIndex`, not by their position in the array. */
function waypoint({ lat, lng }: GeoPoint, pointIndex: number) {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [lng, lat] },
    properties: { pointIndex, pointType: "waypoint" },
  };
}
