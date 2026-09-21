import {
  boundsContain,
  cumulativeLengths,
  expandBounds,
  nearestOnPolyline,
  polylineBounds,
} from "@/lib/geo/polyline";
import { RoutePolyline } from "@/lib/routes/types";
import { Camera, RouteCamera } from "./types";

/**
 * How far off the path a camera may sit and still count as "along this route".
 *
 * Generous on purpose — a camera is mounted beside the road, and a route's polyline is a
 * simplification of it. The cost of being generous is that two highways running close together
 * borrow each other's cameras; Highways 1 and 7 are about this far apart through parts of the
 * Fraser Valley. Tune here rather than anywhere else.
 */
export const CORRIDOR_METERS = 1_000;

/** Upper bound on how many cameras a page will show. See `thin` for how the cut is made. */
export const MAX_CAMERAS = 40;

export interface CamerasAlongRouteOptions {
  corridorMeters?: number;
  limit?: number;
}

/**
 * Cameras within the corridor, ordered by distance travelled from the origin.
 *
 * Pure and synchronous: it takes the catalogue it is given and does no I/O, so it is the one
 * piece of this feature that could be unit-tested as-is the day this repo grows a test runner.
 */
export function camerasAlongRoute(
  polyline: RoutePolyline,
  cameras: Camera[],
  options: CamerasAlongRouteOptions = {},
): RouteCamera[] {
  const corridorMeters = options.corridorMeters ?? CORRIDOR_METERS;
  const limit = options.limit ?? MAX_CAMERAS;

  // Fewer than two points is not a path. A confirmed route cannot be in that state — the
  // planner rejects it — but this function does not get to assume its caller.
  const bounds = polyline.coordinates.length < 2 ? null : polylineBounds(polyline);
  if (!bounds) return [];

  const cumulative = cumulativeLengths(polyline);
  const box = expandBounds(bounds, corridorMeters);

  const matched: RouteCamera[] = [];
  for (const camera of cameras) {
    // Four comparisons reject most of the province before any segment maths runs, which is
    // what keeps this linear-scan approach comfortably fast enough to skip a spatial index.
    if (!boundsContain(box, camera.location)) continue;

    const nearest = nearestOnPolyline(polyline, camera.location, cumulative);
    if (!nearest || nearest.offsetMeters > corridorMeters) continue;

    matched.push({
      ...camera,
      distanceFromRouteMeters: nearest.offsetMeters,
      distanceAlongRouteMeters: nearest.alongMeters,
    });
  }

  matched.sort((a, b) => a.distanceAlongRouteMeters - b.distanceAlongRouteMeters);
  return thin(matched, cumulative[cumulative.length - 1], limit);
}

/**
 * At most `limit` cameras, spread over the whole route.
 *
 * Taking the `limit` closest to the path would be wrong in a way that only shows up on real
 * data: metro Vancouver has cameras every few hundred metres, so every slot would be spent
 * before the route left town and a Sea-to-Sky drive would show nothing past Horseshoe Bay.
 *
 * Instead the route is cut into `limit` equal stretches and each contributes its best camera
 * before any stretch contributes a second. Within a stretch, a live camera outranks a dark one
 * at the same spot, ties break on proximity to the road, and every distinct site is represented
 * before any site offers a second angle. Empty stretches — a long run with no coverage at all —
 * give their slots back to the rest, so the limit is still filled when there are enough cameras
 * to fill it.
 *
 * Measured on Burnaby -> Squamish: 46 matches thinned to 40 covering all 22 distinct sites from
 * km 0.2 to km 70.7. Without the per-site step the same cut spent four slots on Capilano and
 * dropped the Lonsdale interchange entirely.
 */
function thin(matched: RouteCamera[], routeLength: number, limit: number): RouteCamera[] {
  if (matched.length <= limit) return matched;

  // A zero-length path has no stretches to spread across; fall back to the closest few.
  if (routeLength <= 0) {
    return [...matched]
      .sort((a, b) => a.distanceFromRouteMeters - b.distanceFromRouteMeters)
      .slice(0, limit);
  }

  const bucketLength = routeLength / limit;
  const buckets = new Map<number, RouteCamera[]>();
  for (const camera of matched) {
    // The camera sitting exactly at the end of the route would land one bucket past the last.
    const index = Math.min(limit - 1, Math.floor(camera.distanceAlongRouteMeters / bucketLength));
    const bucket = buckets.get(index);
    if (bucket) bucket.push(camera);
    else buckets.set(index, [camera]);
  }

  for (const [index, bucket] of buckets) {
    bucket.sort(
      (a, b) =>
        Number(!a.isOn) - Number(!b.isOn) || a.distanceFromRouteMeters - b.distanceFromRouteMeters,
    );
    buckets.set(index, dealByGroup(bucket));
  }

  // Round-robin: everyone's best, then everyone's second, until the budget runs out.
  const ordered = [...buckets.keys()].sort((a, b) => a - b);
  const selected: RouteCamera[] = [];
  for (let rank = 0; selected.length < limit; rank++) {
    const before = selected.length;
    for (const index of ordered) {
      if (selected.length >= limit) break;
      const camera = buckets.get(index)?.[rank];
      if (camera) selected.push(camera);
    }
    // Every bucket is exhausted; nothing further to hand out.
    if (selected.length === before) break;
  }

  return selected.sort((a, b) => a.distanceAlongRouteMeters - b.distanceAlongRouteMeters);
}

/**
 * The same cameras reordered so every site's best view comes before any site's second view.
 *
 * Input must already be in preference order; the grouping is stable, so sites appear in the
 * order their best camera did. This is what stops a four-camera interchange from crowding out
 * the next junction along the road — one angle of four places beats four angles of one.
 */
function dealByGroup(bucket: RouteCamera[]): RouteCamera[] {
  const sites = new Map<number, RouteCamera[]>();
  for (const camera of bucket) {
    const site = sites.get(camera.group);
    if (site) site.push(camera);
    else sites.set(camera.group, [camera]);
  }

  const dealt: RouteCamera[] = [];
  for (let rank = 0; dealt.length < bucket.length; rank++) {
    for (const site of sites.values()) {
      const camera = site[rank];
      if (camera) dealt.push(camera);
    }
  }
  return dealt;
}
