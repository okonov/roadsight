import { z } from "zod";
import { CameraSource } from "./camera-source";
import { Camera, CameraCatalogue } from "./types";

const WEBCAMS_URL = process.env.DRIVEBC_WEBCAMS_URL ?? "https://www.drivebc.ca/api/webcams/";

/**
 * How long a fetched list is reused. This governs *metadata* only — which cameras exist and
 * whether they are live. The pictures are unaffected: they are fetched by the browser straight
 * from DriveBC, which sends `no-cache` and revalidates every time, so a frame is never older
 * than DriveBC's own. The visible cost of an hour is that a camera which goes dark keeps its
 * "live" badge until the next refresh.
 */
const CATALOGUE_TTL_MS = 60 * 60 * 1000;

/** After a failure, wait this long before trying DriveBC again rather than retrying per request. */
const ERROR_BACKOFF_MS = 60 * 1000;

const FETCH_TIMEOUT_MS = 8_000;

/**
 * A response that loses more than this fraction to validation is a schema change, not noise.
 * One malformed record in a thousand must not blank the feature; six hundred of them must not
 * be served as if the catalogue had simply shrunk.
 */
const MIN_VALID_FRACTION = 0.9;

// A GeoJSON position is [lng, lat] with an optional altitude, so this cannot be a 2-tuple.
const positionSchema = z.tuple([z.number(), z.number()]).rest(z.number());

/**
 * Only `id` and `location` are load-bearing — everything else defaults, so a field DriveBC
 * renames or nulls costs a caption rather than the whole catalogue. The image URL is built
 * from the id (see `image-url.ts`), so `links` is deliberately not read at all.
 */
const driveBcCameraSchema = z.object({
  id: z.number(),
  location: z.object({ type: z.literal("Point"), coordinates: positionSchema }),
  name: z.string().nullish(),
  name_override: z.string().nullish(),
  caption: z.string().nullish(),
  caption_override: z.string().nullish(),
  highway: z.string().nullish(),
  highway_description: z.string().nullish(),
  region_name: z.string().nullish(),
  orientation: z.string().nullish(),
  group: z.number().nullish(),
  is_on: z.boolean().nullish(),
  should_appear: z.boolean().nullish(),
  marked_stale: z.boolean().nullish(),
  marked_delayed: z.boolean().nullish(),
  last_update_modified: z.string().nullish(),
  update_period_mean: z.number().nullish(),
  credit: z.string().nullish(),
  dbc_mark: z.string().nullish(),
});

type DriveBcCamera = z.infer<typeof driveBcCameraSchema>;

function toCamera(raw: DriveBcCamera): Camera {
  const [lng, lat] = raw.location.coordinates;
  return {
    id: `drivebc:${raw.id}`,
    source: "drivebc",
    sourceKey: String(raw.id),
    // DriveBC keeps an editorial override alongside the machine-generated value and shows the
    // override when it is set.
    name: raw.name_override || raw.name || `Camera ${raw.id}`,
    caption: raw.caption_override || raw.caption || "",
    highway: raw.highway || "",
    highwayDescription: raw.highway_description || "",
    regionName: raw.region_name || "",
    orientation: raw.orientation || "",
    // A camera with no group is its own site, which is what its own id already expresses.
    group: `drivebc:${raw.group ?? raw.id}`,
    location: { lat, lng },
    isOn: raw.is_on ?? true,
    isStale: raw.marked_stale ?? false,
    isDelayed: raw.marked_delayed ?? false,
    lastUpdated: raw.last_update_modified ?? null,
    updatePeriodSeconds: raw.update_period_mean ?? null,
    credit: raw.credit || "",
    dbcMark: raw.dbc_mark || "DriveBC.ca",
  };
}

/**
 * DriveBC's array mapped to our cameras, or null if the payload is unusable.
 *
 * Validates per item rather than as one array: `z.array(...).safeParse` fails the whole
 * response for a single bad record, which would take the feature down for a cosmetic upstream
 * change. `MIN_VALID_FRACTION` is the tripwire that still catches a real schema change.
 *
 * Cameras DriveBC has hidden from its own map (`should_appear: false`) are dropped here, and
 * do not count against that fraction — they parsed fine, we simply have no business showing
 * them. Dark cameras (`is_on: false`) are *kept*: "a camera exists here but is not sending"
 * is real information for a driver, and the UI renders it as such.
 *
 * Exported because the committed snapshot holds raw DriveBC records too, so it is read back
 * through exactly the parser that will read the live feed.
 */
export function parseCameras(payload: unknown): Camera[] | null {
  if (!Array.isArray(payload) || payload.length === 0) return null;

  const cameras: Camera[] = [];
  let valid = 0;
  for (const item of payload) {
    const parsed = driveBcCameraSchema.safeParse(item);
    if (!parsed.success) continue;
    valid++;
    if (parsed.data.should_appear === false) continue;
    cameras.push(toCamera(parsed.data));
  }

  if (valid / payload.length < MIN_VALID_FRACTION) return null;
  return cameras;
}

/**
 * The live DriveBC catalogue, cached in process for `CATALOGUE_TTL_MS`.
 *
 * Never throws, per the `CameraSource` contract: on any failure it serves the last good list,
 * and failing that whatever the caller passes as the fallback.
 */
export class DriveBcCameraSource implements CameraSource {
  private cached: { catalogue: CameraCatalogue; fetchedAtMs: number } | null = null;
  private inFlight: Promise<void> | null = null;
  private nextAttemptAtMs = 0;

  constructor(private readonly fallback: CameraSource) {}

  async load(): Promise<CameraCatalogue> {
    const now = Date.now();
    const isFresh = this.cached !== null && now - this.cached.fetchedAtMs < CATALOGUE_TTL_MS;
    if (!isFresh && now >= this.nextAttemptAtMs) {
      await this.refresh();
    }

    // A stale live list still beats the committed snapshot, so the fallback is only reached on
    // a cold process that cannot talk to DriveBC at all.
    return this.cached?.catalogue ?? this.fallback.load();
  }

  /** One upstream request no matter how many page loads arrive on a cold cache. */
  private refresh(): Promise<void> {
    this.inFlight ??= this.fetchCatalogue().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async fetchCatalogue(): Promise<void> {
    const startedAt = Date.now();
    try {
      const res = await fetch(WEBCAMS_URL, {
        // We own the TTL above. Letting Next's data cache also hold this body would give two
        // caches with different expiries and no way to tell which one answered.
        cache: "no-store",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const cameras = parseCameras(await res.json());
      if (!cameras) throw new Error("payload failed validation");

      this.cached = {
        catalogue: { cameras, fetchedAt: new Date().toISOString(), origin: "live" },
        fetchedAtMs: Date.now(),
      };
      this.nextAttemptAtMs = 0;
    } catch (error) {
      // No observability stack in this app; a log line is what a failure gets.
      console.warn(
        `DriveBC camera catalogue fetch failed after ${Date.now() - startedAt}ms:`,
        error instanceof Error ? error.message : error,
      );
      this.nextAttemptAtMs = Date.now() + ERROR_BACKOFF_MS;
    }
  }
}
