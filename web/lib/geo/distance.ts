import { GeoPoint } from "@/lib/routes/types";

/** WGS84 mean radius. */
export const EARTH_RADIUS_M = 6_371_008.8;

/**
 * Metres per degree of latitude on the spherical model. Constant by construction — the real
 * ellipsoid varies from ~110.6 km at the equator to ~111.7 km at the poles, which is inside
 * the tolerance of everything this module is used for.
 */
export const METERS_PER_DEGREE_LAT = (EARTH_RADIUS_M * Math.PI) / 180;

export function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(s));
}

export interface Vec2 {
  /** Metres east of the frame's origin. */
  x: number;
  /** Metres north of the frame's origin. */
  y: number;
}

/**
 * A local east/north metre grid centred on one point.
 *
 * Equirectangular: exact at the origin and under 0.1% off within tens of kilometres, which is
 * far inside the tolerance of a corridor test measured in kilometres. Deliberately *not* the
 * Web Mercator projection in `lib/maps/static-map.ts`: a Mercator pixel is `1/cos(lat)` metres,
 * so a fixed pixel threshold is a distance threshold that silently widens as you go north —
 * across BC that is a 1.33x spread.
 */
export interface LocalFrame {
  toLocal(point: GeoPoint): Vec2;
}

export function localFrame(origin: GeoPoint): LocalFrame {
  const metersPerDegreeLng = METERS_PER_DEGREE_LAT * Math.cos(toRadians(origin.lat));
  return {
    toLocal(point: GeoPoint): Vec2 {
      return {
        x: (point.lng - origin.lng) * metersPerDegreeLng,
        y: (point.lat - origin.lat) * METERS_PER_DEGREE_LAT,
      };
    },
  };
}

export interface SegmentHit {
  meters: number;
  /**
   * Where the closest point falls along `a`->`b`, clamped to [0, 1]. Clamping is what makes a
   * point off the end of the segment resolve to that end rather than to the infinite line, and
   * it is also what lets a caller turn the hit into a distance travelled along a path.
   */
  t: number;
}

/**
 * Metres from the frame's own origin to the segment `a`-`b`.
 *
 * The measured point is the frame's origin rather than an argument: the caller builds one
 * frame per point and reuses it across every segment, which is both the cheapest arrangement
 * (one cosine per point, not per segment) and the most accurate, since the projection is exact
 * exactly where the measurement is taken.
 */
export function distanceToSegmentMeters(frame: LocalFrame, a: GeoPoint, b: GeoPoint): SegmentHit {
  const start = frame.toLocal(a);
  const end = frame.toLocal(b);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;

  // Degenerate segment: collapse to its start rather than dividing by zero.
  const t =
    lengthSquared === 0
      ? 0
      : Math.min(1, Math.max(0, -(start.x * dx + start.y * dy) / lengthSquared));

  return { meters: Math.hypot(start.x + t * dx, start.y + t * dy), t };
}
