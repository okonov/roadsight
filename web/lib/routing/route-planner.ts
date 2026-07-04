import { GeoPoint, RoutePolyline } from "@/lib/routes/types";

export interface RoutePlan {
  /** The "most recommended" route only (per spec). */
  polyline: RoutePolyline;
  distanceMeters: number;
  durationSeconds: number;
}

export interface RoutePlanner {
  plan(origin: GeoPoint, destination: GeoPoint): Promise<RoutePlan | null>;
}
