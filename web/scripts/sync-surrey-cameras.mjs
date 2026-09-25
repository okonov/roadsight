// Populates surrey_cameras from the City of Surrey's ArcGIS camera layer — a third source
// alongside DriveBC and Vancouver. See docs/add-surrey-cameras.md for the full design; §6 is
// what this implements.
//
//   node --env-file=.env.local scripts/sync-surrey-cameras.mjs
//
// Run by hand for now; daily in a scheduled GitHub Action later (§8 Phase 3). Needs
// DATABASE_URL. Four steps: fetch the layer (one request), normalise it
// (lib/cameras/surrey/parse-layer.mjs), HEAD every image, upsert.

import { Pool } from "pg";
import { parseLayer } from "../lib/cameras/surrey/parse-layer.mjs";

const OPERATIONAL_LAYER = "https://gisservices.surrey.ca/arcgis/rest/services/Public/Transportation/MapServer/2";
const OPEN_DATA_LAYER =
  "https://services5.arcgis.com/YRpe0VKTJytZSSIB/arcgis/rest/services/Traffic%20Cameras/FeatureServer/0";

// The tripwires (§6 step 1, §9 q.4). 701 features and ~595 live images measured 2026-09-24.
// Fewer features means a broken or truncated layer. Far fewer live images means the image
// host moved, and writing that probe result would hide every Surrey camera from the app.
const MIN_VALID_FEATURES = 500;
const MIN_LIVE_IMAGES = 400;

const PROBE_CONCURRENCY = 8;
const PROBE_TIMEOUT_MS = 10_000;

// A frame older than this at probe time is reported in the summary (§3 "Staleness").
const STALE_AFTER_MS = 30 * 60 * 1000;

async function fetchLayer(layerUrl, outFields) {
  const params = new URLSearchParams({ where: "1=1", outFields, outSR: "4326", f: "json" });
  const res = await fetch(`${layerUrl}/query?${params}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  // ArcGIS answers a bad query with 200 and an `error` object in the body.
  const body = await res.json();
  if (body.error) throw new Error(`ArcGIS error ${body.error.code}: ${body.error.message}`);
  if (body.exceededTransferLimit) throw new Error("exceededTransferLimit — the layer no longer fits one page");
  if (!Array.isArray(body.features) || body.features.length < MIN_VALID_FEATURES) {
    throw new Error(`only ${body.features?.length ?? 0} features (expected >= ${MIN_VALID_FEATURES})`);
  }
  return body.features;
}

async function fetchFeatures() {
  try {
    return await fetchLayer(OPERATIONAL_LAYER, "LOCATION,CAMERA_NAME,OWNER,IMAGE,NVR");
  } catch (error) {
    // The operational layer is the City's internal endpoint, not a published API (§9 q.4).
    // The open-data copy lags it by weeks but parses the same way.
    console.warn(`Operational layer failed (${error.message}) — falling back to the open-data copy.`);
    return await fetchLayer(OPEN_DATA_LAYER, "LOCATION,IMAGE");
  }
}

/**
 * HEAD one image. `{ status, modifiedAt }` on any HTTP answer, 404 included; `null` when the
 * request itself failed (timeout, DNS, reset) — that says nothing about the camera, so the
 * upsert keeps the previous probe result rather than hiding a camera that was fine yesterday.
 */
async function probe(imageUrl) {
  try {
    const res = await fetch(imageUrl, { method: "HEAD", signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    const lastModified = res.headers.get("last-modified");
    return { status: res.status, modifiedAt: lastModified ? new Date(lastModified) : null };
  } catch {
    return null;
  }
}

async function sync(pool) {
  console.log("Fetching layer...");
  const features = await fetchFeatures();
  const { cameras, dropped } = parseLayer(features);
  console.log(
    `${features.length} features → ${cameras.length} Surrey cameras ` +
      `(dropped: ${dropped.noImage} no image, ${dropped.notSurrey} provincial, ${dropped.duplicate} duplicate, ` +
      `${dropped.badImage} bad URL, ${dropped.noGeometry} no geometry)`,
  );

  console.log(`Probing ${cameras.length} images at concurrency ${PROBE_CONCURRENCY}...`);
  const probedAt = new Date();
  const probes = new Map(); // cameraKey -> { status, modifiedAt } | null
  await mapLimit(cameras, PROBE_CONCURRENCY, async (camera) => {
    probes.set(camera.cameraKey, await probe(camera.imageUrl));
  });

  const results = [...probes.values()];
  const live = results.filter((result) => result?.status === 200).length;
  console.log(`${live} of ${cameras.length} images answered 200.`);
  if (live < MIN_LIVE_IMAGES) {
    throw new Error(
      `Only ${live} images answered 200 (expected >= ${MIN_LIVE_IMAGES}) — the image host may have changed. Nothing written.`,
    );
  }

  const { rows: existingRows } = await pool.query(
    `SELECT camera_key, site_key, location_source, retired_at FROM surrey_cameras`,
  );
  const existing = new Map(existingRows.map((row) => [row.camera_key, row]));

  let created = 0;
  let returned = 0;
  const siteKeyChanges = [];

  for (const camera of cameras) {
    const result = probes.get(camera.cameraKey);
    const previous = existing.get(camera.cameraKey);
    if (!previous) created++;
    else if (previous.retired_at) returned++;
    if (previous && previous.location_source !== "manual" && previous.site_key !== camera.siteKey) {
      siteKeyChanges.push(`${camera.cameraName}: '${previous.site_key}' → '${camera.siteKey}'`);
    }

    await pool.query(
      `INSERT INTO surrey_cameras (camera_key, camera_name, location, site_key, kind, heading, image_url, nvr,
                                   lat, lng, image_status, image_modified_at, probed_at, last_seen_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now())
       ON CONFLICT (camera_key) DO UPDATE SET
         camera_name = EXCLUDED.camera_name,
         location = EXCLUDED.location,
         kind = EXCLUDED.kind,
         heading = EXCLUDED.heading,
         image_url = EXCLUDED.image_url,
         nvr = EXCLUDED.nvr,
         site_key = CASE WHEN surrey_cameras.location_source = 'manual' THEN surrey_cameras.site_key ELSE EXCLUDED.site_key END,
         lat = CASE WHEN surrey_cameras.location_source = 'manual' THEN surrey_cameras.lat ELSE EXCLUDED.lat END,
         lng = CASE WHEN surrey_cameras.location_source = 'manual' THEN surrey_cameras.lng ELSE EXCLUDED.lng END,
         image_status = CASE WHEN $14 THEN EXCLUDED.image_status ELSE surrey_cameras.image_status END,
         image_modified_at = CASE WHEN $14 THEN EXCLUDED.image_modified_at ELSE surrey_cameras.image_modified_at END,
         probed_at = CASE WHEN $14 THEN EXCLUDED.probed_at ELSE surrey_cameras.probed_at END,
         last_seen_at = now(),
         retired_at = NULL`,
      [
        camera.cameraKey,
        camera.cameraName,
        camera.location,
        camera.siteKey,
        camera.kind,
        camera.heading,
        camera.imageUrl,
        camera.nvr,
        camera.lat,
        camera.lng,
        result?.status ?? null,
        result?.modifiedAt ?? null,
        result ? probedAt : null,
        result !== null,
      ],
    );
  }

  const retired = await pool.query(
    `UPDATE surrey_cameras SET retired_at = now()
     WHERE retired_at IS NULL AND NOT (camera_key = ANY($1::text[]))`,
    [cameras.map((camera) => camera.cameraKey)],
  );

  const dead = results.filter((result) => result && result.status !== 200).length;
  const failed = results.filter((result) => result === null).length;
  const stale = results.filter(
    (result) => result?.status === 200 && result.modifiedAt && probedAt - result.modifiedAt > STALE_AFTER_MS,
  ).length;
  const sites = new Set(cameras.map((camera) => camera.siteKey)).size;

  console.log("");
  console.log("=== Sync summary ===");
  console.log(
    `Cameras: ${cameras.length} seen (${created} new, ${returned} returned), ${retired.rowCount} retired, ${sites} sites`,
  );
  console.log(`Images:  ${live} live, ${dead} not 200, ${failed} probe failed (previous result kept)`);
  console.log(`Frames older than 30 min: ${stale}`);
  if (siteKeyChanges.length > 0) {
    console.log(`site_key changes (${siteKeyChanges.length}):`);
    for (const change of siteKeyChanges) console.log(`  ${change}`);
  }
}

async function mapLimit(items, limit, fn) {
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required — see .env.local.example`);
  return value;
}

async function main() {
  const pool = new Pool({ connectionString: requireEnv("DATABASE_URL") });
  try {
    await sync(pool);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
