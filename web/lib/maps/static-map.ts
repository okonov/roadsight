import { GeoPoint } from "@/lib/routes/types";

const STATIC_IMAGE_URL = "https://atlas.microsoft.com/map/static";
const API_VERSION = "2024-04-01";

/**
 * Rendered size in CSS pixels. Shared with the client component so the `<Image>` box and
 * the image the service actually returns cannot drift apart.
 */
export const STATIC_MAP_SIZE = { width: 640, height: 400 } as const;

/** Origin/destination pin colours, reused by the UI legend so the map is self-explaining. */
export const MAP_PIN_COLORS = { origin: "#1A7F37", destination: "#C02626" } as const;

// Web Mercator, the projection Azure Maps renders in. The world is TILE_SIZE pixels wide
// at zoom 0 and doubles per level.
//
// 512 rather than 256 is not a guess: rendering a 70 km pair (Burnaby -> Squamish, zoom 8)
// and a 1.5 km pair (zoom 14) against the live service puts both pins inside the intended
// margin. With 256 the computed zoom would be one level too tight and both endpoints would
// fall outside the image.
const TILE_SIZE = 512;

// Fraction of each axis left empty on either side, so a pin near the edge keeps its
// context and its ~40 px tall image is never clipped by the top border.
const PADDING = 0.12;

// A confirmation map is about recognising *where* the route is. Zooming past street level
// for two nearly identical points would show a rooftop and nothing to recognise; zooming
// out past MIN_ZOOM only ever shows more ocean.
const MIN_ZOOM = 1;
const MAX_ZOOM = 16;

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

/**
 * Smallest view that holds both endpoints with PADDING to spare.
 *
 * Deliberately center+zoom rather than the `bbox` parameter, which would express the same
 * intent more directly but cannot be combined with `width`/`height` — it pins the result to
 * the default 512x512 square — and additionally constrains the allowed lat/lon span per
 * zoom level, which a coincidental pair of nearby endpoints can violate.
 */
function fitView(a: GeoPoint, b: GeoPoint): { center: GeoPoint; zoom: number } {
  const pa = project(a);
  const pb = project(b);
  // Identical endpoints (the geocoder can roll both labels up to one place) would divide by
  // zero; the epsilon lands them at MAX_ZOOM instead.
  const spanX = Math.max(Math.abs(pa.x - pb.x), 1e-9);
  const spanY = Math.max(Math.abs(pa.y - pb.y), 1e-9);

  const usableWidth = STATIC_MAP_SIZE.width * (1 - 2 * PADDING);
  const usableHeight = STATIC_MAP_SIZE.height * (1 - 2 * PADDING);

  // The service takes integer zoom only, so this floors — which can only widen the margin,
  // never eat into it.
  const fitted = Math.floor(
    Math.min(Math.log2(usableWidth / spanX), Math.log2(usableHeight / spanY)),
  );

  return {
    center: unproject({ x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 }),
    zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, fitted)),
  };
}

function pin(point: GeoPoint, color: string, label: string): string {
  // `co`/`lc` want bare six-digit hex. Locations are lng-then-lat, opposite of every other
  // coordinate in this codebase. URLSearchParams handles the required encoding.
  return `default|co${color.replace("#", "")}|lcFFFFFF||'${label}'${point.lng} ${point.lat}`;
}

/**
 * Static map framing the two endpoints, one colour-coded pin each.
 *
 * Two `pins` parameters (one per style) need an S1 or higher Azure Maps SKU — the same tier
 * the `path` parameter will need when the confirmed route line is drawn on top of this.
 */
export function staticMapUrl(
  origin: GeoPoint,
  destination: GeoPoint,
  subscriptionKey: string,
): string {
  const { center, zoom } = fitView(origin, destination);

  const params = new URLSearchParams({
    "api-version": API_VERSION,
    tilesetId: "microsoft.base.road",
    center: `${center.lng},${center.lat}`,
    zoom: String(zoom),
    width: String(STATIC_MAP_SIZE.width),
    height: String(STATIC_MAP_SIZE.height),
  });
  params.append("pins", pin(origin, MAP_PIN_COLORS.origin, "A"));
  params.append("pins", pin(destination, MAP_PIN_COLORS.destination, "B"));
  params.append("subscription-key", subscriptionKey);

  return `${STATIC_IMAGE_URL}?${params}`;
}
