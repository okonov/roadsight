import { GeoPoint, RoutePolyline } from "@/lib/routes/types";
import {
  distanceToSegmentMeters,
  haversineMeters,
  localFrame,
  METERS_PER_DEGREE_LAT,
  toRadians,
} from "./distance";

export interface BoundingBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

/** GeoJSON stores [lng, lat]; every other coordinate in this codebase is {lat, lng}. */
function toGeoPoint([lng, lat]: [number, number]): GeoPoint {
  return { lat, lng };
}

/** Null for a polyline with no coordinates — there is no box to describe. */
export function polylineBounds(polyline: RoutePolyline): BoundingBox | null {
  if (polyline.coordinates.length === 0) return null;

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const [lng, lat] of polyline.coordinates) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  }
  return { minLat, maxLat, minLng, maxLng };
}

/**
 * Box grown by `meters` on every side, erring wide.
 *
 * The longitude pad uses the box's *largest* absolute latitude, because that is where a degree
 * of longitude is shortest and so where the pad in degrees must be widest. Padding too far only
 * lets a few extra candidates through to an exact distance test that will reject them; padding
 * too little would silently drop real matches, which is the failure nobody would notice.
 */
export function expandBounds(box: BoundingBox, meters: number): BoundingBox {
  const latDelta = meters / METERS_PER_DEGREE_LAT;
  const widestLat = Math.max(Math.abs(box.minLat), Math.abs(box.maxLat));

  // Near the poles the cosine collapses and the pad would run away; a whole hemisphere of
  // longitude is the honest answer there, and the exact test still does the real work.
  const cos = Math.cos(toRadians(Math.min(widestLat, 89)));
  const lngDelta = Math.min(180, meters / (METERS_PER_DEGREE_LAT * cos));

  return {
    minLat: box.minLat - latDelta,
    maxLat: box.maxLat + latDelta,
    minLng: box.minLng - lngDelta,
    maxLng: box.maxLng + lngDelta,
  };
}

export function boundsContain(box: BoundingBox, point: GeoPoint): boolean {
  return (
    point.lat >= box.minLat &&
    point.lat <= box.maxLat &&
    point.lng >= box.minLng &&
    point.lng <= box.maxLng
  );
}

/**
 * Distance from the start of the path to each vertex; `[0]` is always 0 and the last entry is
 * the path's own length.
 *
 * That length is the sum of great-circle chords between vertices, so it runs slightly short of
 * the figure a routing service reports for the same path (which follows the road network).
 * The two are different measurements and should never be presented as the same number.
 */
export function cumulativeLengths(polyline: RoutePolyline): number[] {
  const cumulative = new Array<number>(polyline.coordinates.length);
  let total = 0;
  for (let i = 0; i < polyline.coordinates.length; i++) {
    if (i > 0) {
      total += haversineMeters(
        toGeoPoint(polyline.coordinates[i - 1]),
        toGeoPoint(polyline.coordinates[i]),
      );
    }
    cumulative[i] = total;
  }
  return cumulative;
}

export interface NearestOnPolyline {
  /** Perpendicular metres from the path. */
  offsetMeters: number;
  /** Metres travelled along the path to reach the closest point. */
  alongMeters: number;
  segmentIndex: number;
}

/**
 * Closest point on the path to `point`, and how far along the path it sits.
 *
 * A point beyond either end of the path resolves to that end (`t` is clamped), so something
 * just past the destination is reported at the full path length rather than being discarded.
 * That is intended: it is on the same road, at the end of the drive.
 *
 * A self-crossing path reports only the nearer pass — the point appears once, not twice.
 *
 * Null only for a degenerate path of fewer than two points, which cannot describe a segment.
 */
export function nearestOnPolyline(
  polyline: RoutePolyline,
  point: GeoPoint,
  cumulative: number[] = cumulativeLengths(polyline),
): NearestOnPolyline | null {
  if (polyline.coordinates.length < 2) return null;

  // One frame for this point, reused across every segment: exact where it is measured, and a
  // single cosine for the whole walk.
  const frame = localFrame(point);

  let best: NearestOnPolyline | null = null;
  for (let i = 0; i < polyline.coordinates.length - 1; i++) {
    const start = toGeoPoint(polyline.coordinates[i]);
    const end = toGeoPoint(polyline.coordinates[i + 1]);
    const { meters, t } = distanceToSegmentMeters(frame, start, end);
    if (best && meters >= best.offsetMeters) continue;

    const segmentLength = cumulative[i + 1] - cumulative[i];
    best = {
      offsetMeters: meters,
      alongMeters: cumulative[i] + t * segmentLength,
      segmentIndex: i,
    };
  }
  return best;
}
