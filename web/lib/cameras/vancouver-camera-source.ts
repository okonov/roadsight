import { Pool } from "pg";
import { CameraSource } from "./camera-source";
import { Camera, CameraCatalogue } from "./types";

/**
 * How long a loaded list is reused. The tables change when someone runs
 * `scripts/sync-vancouver-cameras.mjs`, on the order of weeks, so this is about not querying
 * Postgres per page view rather than about freshness. Same hour as DriveBC's for symmetry.
 */
const CATALOGUE_TTL_MS = 60 * 60 * 1000;

/** After a failure, wait this long before querying again rather than retrying per request. */
const ERROR_BACKOFF_MS = 60 * 1000;

/**
 * The City's frames refresh every five minutes, each camera at its own fixed offset (measured;
 * the site's own text says 10–15). Nothing reads it today beyond the card's staleness maths,
 * which never runs for a camera with no timestamp.
 */
const UPDATE_PERIOD_SECONDS = 300;

// Sites without a location are never matched to a route, so there is no point shipping them.
// Retired rows stay in the tables for history and are skipped here.
const CAMERAS_SQL = `
  SELECT c.id, c.site_id, c.image_path, c.direction_label, s.name, s.lat, s.lng
  FROM vancouver_cameras c
  JOIN vancouver_camera_sites s ON s.id = c.site_id
  WHERE c.retired_at IS NULL
    AND s.retired_at IS NULL
    AND s.lat IS NOT NULL
    AND s.lng IS NOT NULL
`;

interface CameraRow {
  id: number;
  site_id: number;
  image_path: string;
  direction_label: string;
  name: string;
  lat: number;
  lng: number;
}

function toCamera(row: CameraRow): Camera {
  return {
    id: `vancouver:${row.id}`,
    source: "vancouver",
    sourceKey: row.image_path,
    // Shown as the City publishes it, typos included (docs/add-trafficcams-vancouver.md §8.5).
    name: row.name,
    caption: "",
    highway: "",
    highwayDescription: "",
    regionName: "",
    orientation: row.direction_label,
    group: `vancouver:${row.site_id}`,
    location: { lat: row.lat, lng: row.lng },
    // The City publishes no liveness at all, and a dead camera's response is unobserved. The
    // honest answer is "assume on, show 'Image unavailable' if the picture fails" — see §5.
    isOn: true,
    isStale: false,
    isDelayed: false,
    lastUpdated: null,
    updatePeriodSeconds: UPDATE_PERIOD_SECONDS,
    credit: "City of Vancouver",
    dbcMark: "",
  };
}

/**
 * The City of Vancouver's intersection cameras, as last synced into Postgres.
 *
 * Same caching shape as `DriveBcCameraSource` — hour-long TTL, one query in flight, the last
 * good list served through an error — but with **no snapshot fallback**: a cold process that
 * cannot reach the database contributes zero cameras, and the route page already renders
 * without any. Never throws, per the `CameraSource` contract.
 */
export class VancouverCameraSource implements CameraSource {
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
        `Vancouver camera query failed after ${Date.now() - startedAt}ms:`,
        error instanceof Error ? error.message : error,
      );
      this.nextAttemptAtMs = Date.now() + ERROR_BACKOFF_MS;
    }
  }
}
