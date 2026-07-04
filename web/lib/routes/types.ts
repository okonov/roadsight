export type RouteStatus = "draft" | "resolved" | "confirmed";

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface ResolvedPlace extends GeoPoint {
  /** Formal resolved name, e.g. "Lougheed Town Centre, Burnaby, BC" */
  label: string;
}

/** GeoJSON LineString; coordinates are [lng, lat] pairs (GeoJSON order). */
export interface RoutePolyline {
  type: "LineString";
  coordinates: [number, number][];
}

export interface Route {
  id: string;
  userId: string;
  name: string;
  description: string;
  status: RouteStatus;
  origin: ResolvedPlace | null;
  destination: ResolvedPlace | null;
  polyline: RoutePolyline | null;
  distanceMeters: number | null;
  durationSeconds: number | null;
  createdAt: string;
  updatedAt: string;
}
