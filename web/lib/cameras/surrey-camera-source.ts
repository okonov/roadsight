import { Pool } from "pg";
import { CameraSource } from "./camera-source";
import { Camera, CameraCatalogue } from "./types";

/**
 * How long a loaded list is reused. The table changes when someone runs
 * `scripts/sync-surrey-cameras.mjs`, daily at most, so this is about not querying Postgres per
 * page view rather than about freshness. Same hour as the other two sources.
 */
const CATALOGUE_TTL_MS = 60 * 60 * 1000;

/** After a failure, wait this long before querying again rather than retrying per request. */
const ERROR_BACKOFF_MS = 60 * 1000;

/**
 * Surrey's frames refresh every one to five minutes depending on the recorder
 * (docs/add-surrey-cameras.md §3); the slowest is the one worth quoting. As with Vancouver,
 * nothing reads it beyond the card's staleness maths, which never runs without a timestamp.
 */
const UPDATE_PERIOD_SECONDS = 300;

// Only cameras whose image answered 200 at the last probe: 7% of the layer's URLs are dead
// (§2), and without this about one card in thirteen would say "Image unavailable". Retired rows
// stay in the table for history and are skipped here.
//
// Conventional views first, so where a site has both, a 360° fisheye does not lead (§7). Only
// a tiebreak, though: `thin` re-ranks each stretch by distance from the road before dealing by
// site, and this order survives only among cameras at the same point.
const CAMERAS_SQL = `
  SELECT id, site_key, image_url, location, kind, heading, lat, lng
  FROM surrey_cameras
  WHERE retired_at IS NULL
    AND image_status = 200
  ORDER BY (kind = 'view') DESC, id
`;

interface CameraRow {
  id: number;
  site_key: string;
  image_url: string;
  location: string;
  kind: "view" | "pano" | "quad";
  heading: "N" | "E" | "S" | "W" | null;
  lat: number;
  lng: number;
}

/** What the name's suffix says about the frame (§2 "What a camera is"). */
function orientationOf(row: CameraRow): string {
  if (row.heading) return row.heading;
  if (row.kind === "pano") return "360°";
  if (row.kind === "quad") return "4 views";
  return "";
}

function toCamera(row: CameraRow): Camera {
  return {
    id: `surrey:${row.id}`,
    source: "surrey",
    sourceKey: row.image_url,
    // Shown as the City publishes it, "And" and "&" alike (docs/add-surrey-cameras.md §9.7).
    name: row.location,
    caption: "",
    highway: "",
    highwayDescription: "",
    regionName: "",
    orientation: orientationOf(row),
    group: `surrey:${row.site_key}`,
    location: { lat: row.lat, lng: row.lng },
    // The probe already dropped every camera whose image did not answer 200; a frame that
    // breaks between syncs shows "Image unavailable" via the card's `onError`.
    isOn: true,
    isStale: false,
    isDelayed: false,
    lastUpdated: null,
    updatePeriodSeconds: UPDATE_PERIOD_SECONDS,
    credit: "City of Surrey",
    dbcMark: "",
  };
}

/**
 * The City of Surrey's intersection cameras, as last synced into Postgres.
 *
 * A copy of `VancouverCameraSource`'s caching — hour-long TTL, one query in flight, the last
 * good list served through an error, no snapshot fallback. If a third twin appears, pull this
 * into a shared `PgCameraSource`. Never throws, per the `CameraSource` contract.
 */
export class SurreyCameraSource implements CameraSource {
  private cached: { catalogue: CameraCatalogue; fetchedAtMs: number } | null = null;
  private inFlight: Promise<void> | null = null;
  private nextAttemptAtMs = 0;

  constructor(private readonly pool: Pool) {}

  async load(): Promise<CameraCatalogue> {
    const now = Date.now();
    const isFresh = this.cached !== null && now - this.cached.fetchedAtMs < CATALOGUE_TTL_MS;
    if (!isFresh && now >= this.nextAttemptAtMs) {
      await this.refresh();
    }

    return (
      this.cached?.catalogue ?? { cameras: [], fetchedAt: new Date().toISOString(), origin: "live" }
    );
  }

  private refresh(): Promise<void> {
    this.inFlight ??= this.query().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async query(): Promise<void> {
    const startedAt = Date.now();
    try {
      const { rows } = await this.pool.query<CameraRow>(CAMERAS_SQL);
      this.cached = {
        catalogue: {
          cameras: rows.map(toCamera),
          fetchedAt: new Date().toISOString(),
          origin: "live",
        },
        fetchedAtMs: Date.now(),
      };
      this.nextAttemptAtMs = 0;
    } catch (error) {
      console.warn(
        `Surrey camera query failed after ${Date.now() - startedAt}ms:`,
        error instanceof Error ? error.message : error,
      );
      this.nextAttemptAtMs = Date.now() + ERROR_BACKOFF_MS;
    }
  }
}
