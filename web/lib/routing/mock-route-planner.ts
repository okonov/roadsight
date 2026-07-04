import { GeoPoint, RoutePolyline } from "@/lib/routes/types";
import { RoutePlan, RoutePlanner } from "./route-planner";

const EARTH_RADIUS_M = 6371000;
const ROAD_FACTOR = 1.25; // roads are not straight lines
const AVG_SPEED_MPS = 60 / 3.6; // 60 km/h

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(s));
}

export class MockRoutePlanner implements RoutePlanner {
  async plan(origin: GeoPoint, destination: GeoPoint): Promise<RoutePlan | null> {
    // Artificial delay so the UI's "Fetching route…" state is visible in demos.
    await new Promise((r) => setTimeout(r, 300));

    // 6 points interpolated origin→destination with a small perpendicular bulge at the
    // midpoints, so the mock doesn't render as a ruler line on a map.
    const pointCount = 6;
    const dLat = destination.lat - origin.lat;
    const dLng = destination.lng - origin.lng;
    const coordinates: [number, number][] = [];
    for (let i = 0; i < pointCount; i++) {
      const t = i / (pointCount - 1);
      const bulge = 0.05 * Math.sin(Math.PI * t);
      const lat = origin.lat + dLat * t - dLng * bulge;
      const lng = origin.lng + dLng * t + dLat * bulge;
      coordinates.push([lng, lat]); // GeoJSON order
    }
    const polyline: RoutePolyline = { type: "LineString", coordinates };

    const distanceMeters = haversineMeters(origin, destination) * ROAD_FACTOR;
    return {
      polyline,
      distanceMeters,
      durationSeconds: distanceMeters / AVG_SPEED_MPS,
    };
  }
}
