import { GeoPoint, RoutePolyline } from "@/lib/routes/types";

const STATIC_IMAGE_URL = "https://atlas.microsoft.com/map/static";
const API_VERSION = "2024-04-01";

/** Origin/destination pin colours, reused by the UI legend so the map is self-explaining. */
export const MAP_PIN_COLORS = { origin: "#1A7F37", destination: "#C02626" } as const;

/** Route line colour: distinct from both pins and from the road casings underneath. */
const MAP_ROUTE_COLOR = "#1D6FD8";

interface MapSize {
  width: number;
  height: number;
  /**
   * Pin scale. `sc` scales the pin's *label* along with its image, so anything much below 1
   * makes the A/B letters illegible — sizes that shrink their pins drop the labels instead
   * and lean on colour alone.
   */
  pinScale: number;
  /** Roughly a pin's height: below this the pin image is clipped by the image border. */
  minPaddingPx: number;
  /** Route line width. Proportionally heavier on the thumbnail so it survives downscaling. */
  lineWidth: number;
}

/**
 * Rendered sizes in CSS pixels, shared with the client components so the `<Image>` box and
 * the image the service actually returns cannot drift apart. Both are 8:5.
 *
 * `thumbnail` is deliberately requested larger than it is displayed (~128 px wide) so it
 * stays sharp on high-density screens.
 */
export const STATIC_MAP_SIZES = {
  preview: { width: 640, height: 400, pinScale: 1, minPaddingPx: 36, lineWidth: 4 },
  thumbnail: { width: 240, height: 150, pinScale: 0.6, minPaddingPx: 24, lineWidth: 3 },
} as const satisfies Record<string, MapSize>;

export type StaticMapSize = keyof typeof STATIC_MAP_SIZES;

// Web Mercator, the projection Azure Maps renders in. The world is TILE_SIZE pixels wide
// at zoom 0 and doubles per level.
//
// 512 rather than 256 is not a guess: rendering a 70 km pair (Burnaby -> Squamish, zoom 8)
// and a 1.5 km pair (zoom 14) against the live service puts both pins inside the intended
// margin. With 256 the computed zoom would be one level too tight and both endpoints would
// fall outside the image.
const TILE_SIZE = 512;

// Fraction of each axis left empty on either side, so a pin near the edge keeps its
// context. Floored at the size's minPaddingPx because a pin is a fixed number of pixels
// tall no matter how small the canvas is — on a thumbnail the fraction alone would clip it.
const PADDING = 0.12;

// A confirmation map is about recognising *where* the route is. Zooming past street level
// for two nearly identical points would show a rooftop and nothing to recognise; zooming
// out past MIN_ZOOM only ever shows more ocean.
const MIN_ZOOM = 1;
const MAX_ZOOM = 16;

// Hard service limit: one `path` parameter carries at most 100 locations. A real Azure Maps
// route path runs to thousands of points (1696 for Burnaby -> Squamish), so it has to be
// simplified before it can be drawn at all. The service also accepts up to 10 `path`
// parameters, but chaining them to raise this ceiling would buy nothing — see the tolerance
// below.
const MAX_PATH_POINTS = 100;

// Simplification tolerance, in pixels of the *rendered image*. Deviations smaller than this
// are invisible at the size the map will be shown, so the point budget above is not what
// decides how the route looks; it only stops a pathological path from blowing out the URL.
const SIMPLIFY_TOLERANCE_PX = 1.5;

interface WorldPoint {
  x: number;
  y: number;
}

function project({ lat, lng }: GeoPoint): WorldPoint {
  // Clamped short of the poles, where the Mercator y goes to infinity.
  const sin = Math.min(Math.max(Math.sin((lat * Math.PI) / 180), -0.9999), 0.9999);
  return {
    x: ((lng + 180) / 360) * TILE_SIZE,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * TILE_SIZE,
  };
}

function unproject({ x, y }: WorldPoint): GeoPoint {
  const mercatorY = (0.5 - y / TILE_SIZE) * 2 * Math.PI;
  return {
    lng: (x / TILE_SIZE) * 360 - 180,
    lat: ((2 * Math.atan(Math.exp(mercatorY)) - Math.PI / 2) * 180) / Math.PI,
  };
}

function usable(extent: number, size: MapSize): number {
  return extent - 2 * Math.max(extent * PADDING, size.minPaddingPx);
}

/**
 * Smallest view that holds every given point with the size's padding to spare.
 *
 * Fed the route path as well as the endpoints, because a road is free to bulge outside the
 * box its two ends describe — the Sea-to-Sky swings west of both — and a view framed on the
 * endpoints alone would clip it.
 *
 * Deliberately center+zoom rather than the `bbox` parameter, which would express the same
 * intent more directly but cannot be combined with `width`/`height` — it pins the result to
 * the default 512x512 square — and additionally constrains the allowed lat/lon span per
 * zoom level, which a coincidental pair of nearby endpoints can violate.
 */
function fitView(points: WorldPoint[], size: MapSize): { center: GeoPoint; zoom: number } {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  // Coincident points (the geocoder can roll both labels up to one place) would divide by
  // zero; the epsilon lands them at MAX_ZOOM instead.
  const spanX = Math.max(maxX - minX, 1e-9);
  const spanY = Math.max(maxY - minY, 1e-9);

  // The service takes integer zoom only, so this floors — which can only widen the margin,
  // never eat into it.
  const fitted = Math.floor(
    Math.min(
      Math.log2(usable(size.width, size) / spanX),
      Math.log2(usable(size.height, size) / spanY),
    ),
  );

  return {
    center: unproject({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 }),
    zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, fitted)),
  };
}

/** Perpendicular distance from `p` to the segment `a`-`b`, all in the same pixel space. */
function distanceToSegment(p: WorldPoint, a: WorldPoint, b: WorldPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  // Degenerate segment: fall back to the distance from its collapsed endpoint.
  const t =
    lengthSquared === 0
      ? 0
      : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Ramer-Douglas-Peucker: drops points that sit within `tolerance` of the line they span. */
function simplify(points: WorldPoint[], tolerance: number): WorldPoint[] {
  if (points.length <= 2) return points;

  const first = points[0];
  const last = points[points.length - 1];
  let farthest = 0;
  let maxDistance = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const distance = distanceToSegment(points[i], first, last);
    if (distance > maxDistance) {
      maxDistance = distance;
      farthest = i;
    }
  }

  if (maxDistance <= tolerance) return [first, last];
  return [
    ...simplify(points.slice(0, farthest + 1), tolerance),
    // The split point belongs to both halves; keep the copy from the first.
    ...simplify(points.slice(farthest), tolerance).slice(1),
  ];
}

/**
 * Route path reduced to something the `path` parameter can carry, simplified in the pixel
 * space of the image it is about to be drawn on.
 *
 * Starts at the visually lossless tolerance and coarsens only if the result still exceeds
 * the service's point limit. The doubling terminates: at a large enough tolerance the
 * algorithm keeps nothing but the two endpoints.
 */
function pathPoints(polyline: RoutePolyline, zoom: number): GeoPoint[] {
  const scale = 2 ** zoom;
  const projected = polyline.coordinates.map(([lng, lat]) => {
    const { x, y } = project({ lat, lng });
    return { x: x * scale, y: y * scale };
  });

  let tolerance = SIMPLIFY_TOLERANCE_PX;
  let simplified = simplify(projected, tolerance);
  while (simplified.length > MAX_PATH_POINTS) {
    tolerance *= 2;
    simplified = simplify(projected, tolerance);
  }

  return simplified.map(({ x, y }) => unproject({ x: x / scale, y: y / scale }));
}

/** Locations are lng-then-lat, opposite of every other coordinate in this codebase. */
function locations(points: GeoPoint[]): string {
  return points.map((p) => `${p.lng} ${p.lat}`).join("|");
}

function pin(point: GeoPoint, color: string, label: string, size: MapSize): string {
  // `co`/`lc` want bare six-digit hex. URLSearchParams handles the required encoding.
  const style = ["default", `co${color.replace("#", "")}`, "lcFFFFFF"];
  if (size.pinScale !== 1) style.push(`sc${size.pinScale}`);
  const location = locations([point]);
  return size.pinScale < 1
    ? `${style.join("|")}||${location}`
    : `${style.join("|")}||'${label}'${location}`;
}

export interface StaticMapRoute {
  origin: GeoPoint;
  destination: GeoPoint;
  /** Drawn when present; null until the route is confirmed and a path exists. */
  polyline: RoutePolyline | null;
}

/**
 * Static map of a route: the driven path where one is known, plus a colour-coded pin at each
 * endpoint.
 *
 * Multiple `pins` parameters and any `path` at all need an S1 or higher Azure Maps SKU.
 */
export function staticMapUrl(
  route: StaticMapRoute,
  subscriptionKey: string,
  sizeName: StaticMapSize = "preview",
): string {
  const size = STATIC_MAP_SIZES[sizeName];

  const framed = [
    route.origin,
    route.destination,
    // Road-snapped path ends sit metres away from the geocoded pins, so both matter.
    ...(route.polyline?.coordinates.map(([lng, lat]) => ({ lat, lng })) ?? []),
  ];
  const { center, zoom } = fitView(framed.map(project), size);

  const params = new URLSearchParams({
    "api-version": API_VERSION,
    tilesetId: "microsoft.base.road",
    center: `${center.lng},${center.lat}`,
    zoom: String(zoom),
    width: String(size.width),
    height: String(size.height),
  });
  if (route.polyline) {
    const style = `lc${MAP_ROUTE_COLOR.replace("#", "")}|lw${size.lineWidth}`;
    params.append("path", `${style}||${locations(pathPoints(route.polyline, zoom))}`);
  }
  params.append("pins", pin(route.origin, MAP_PIN_COLORS.origin, "A", size));
  params.append("pins", pin(route.destination, MAP_PIN_COLORS.destination, "B", size));
  params.append("subscription-key", subscriptionKey);

  return `${STATIC_IMAGE_URL}?${params}`;
}
