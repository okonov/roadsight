// Populates vancouver_camera_sites and vancouver_cameras from trafficcams.vancouver.ca — the
// City of Vancouver's intersection cameras, a second source alongside DriveBC. See
// docs/add-trafficcams-vancouver.md for the full design; §4 is what this implements.
//
//   node --env-file=.env.local scripts/sync-vancouver-cameras.mjs            # both steps
//   node --env-file=.env.local scripts/sync-vancouver-cameras.mjs crawl      # step 1 only
//   node --env-file=.env.local scripts/sync-vancouver-cameras.mjs geocode    # step 2 only
//
// Run by hand for now; a scheduled GitHub Action comes later (§7 Phase 3). Needs
// DATABASE_URL always, and AZURE_MAPS_KEY for the geocode step — both already in
// .env.local.example. `--env-file` is Node's own flag; no dotenv dependency needed.
//
// Plain ESM, no HTML/XML parser dependency, same shape as fetch-camera-snapshot.mjs. The
// pure parsing logic lives in lib/cameras/vancouver/ so it can be unit-tested later against
// the committed fixtures without re-fetching the live site.

import { Pool } from "pg";
import { z } from "zod";
import { parseKml } from "../lib/cameras/vancouver/parse-kml.mjs";
import { parseRootPage } from "../lib/cameras/vancouver/parse-root-page.mjs";
import { parseIntersectionPage } from "../lib/cameras/vancouver/parse-intersection-page.mjs";

const KML_URL = "https://vanmapp1.vancouver.ca/googleKml/traffic_cameras/";
const ROOT_URL = "https://trafficcams.vancouver.ca/";
const PAGE_BASE = "https://trafficcams.vancouver.ca";
const GEOCODE_URL = "https://atlas.microsoft.com/geocode";
const GEOCODE_API_VERSION = "2026-01-01";

// Same bias point as lib/geocoding/azure-maps-geocoder.ts — downtown Vancouver, so an
// unqualified freeform query doesn't drift to another city entirely.
const BIAS_COORDINATES = "-123.1,49.3";

// The tripwire from §4 step 5: a response that shrinks past this must be a layout change on
// the City's side, not a quiet Tuesday. 216/219 measured 2026-09-21; 150 leaves headroom for
// normal month-to-month churn while still catching a real break.
const MIN_VALID_PAGES = 150;
const MIN_VALID_PLACEMARKS = 150;

const CRAWL_CONCURRENCY = 4;

async function crawl(pool) {
  console.log("Fetching KML...");
  // A missing KML is insurance-plan territory (§8.2: sites still get discovered from the root
  // page and geocoded by Azure), so its total absence is a warning, not a failure. A KML that
  // answers but with a suspiciously short placemark list is the real tripwire — that is a
  // layout change on an endpoint we already depend on, same as a broken root page.
  let placemarks = [];
  try {
    const res = await fetch(KML_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    placemarks = parseKml(await res.text());
    if (placemarks.length < MIN_VALID_PLACEMARKS) {
      throw new Error(`only ${placemarks.length} placemarks (expected >= ${MIN_VALID_PLACEMARKS})`);
    }
  } catch (error) {
    console.warn(
      `KML unavailable — continuing with the root page + Azure geocoding only (§8.2): ${error.message}`,
    );
    placemarks = [];
  }

  console.log("Fetching root page...");
  const rootRes = await fetch(ROOT_URL);
  if (!rootRes.ok) throw new Error(`Root page fetch failed: HTTP ${rootRes.status}`);
  const rootPaths = parseRootPage(await rootRes.text());
  if (rootPaths.length < MIN_VALID_PAGES) {
    throw new Error(
      `Root page yielded only ${rootPaths.length} pages (expected >= ${MIN_VALID_PAGES}) — the site's layout may have changed.`,
    );
  }

  const kmlByPath = new Map();
  let placemarksWithNoLink = 0;
  for (const placemark of placemarks) {
    if (!placemark.pagePath) {
      placemarksWithNoLink++;
      continue;
    }
    kmlByPath.set(placemark.pagePath, placemark);
  }

  const pagePaths = [...new Set([...rootPaths, ...kmlByPath.keys()])];
  console.log(`Crawling ${pagePaths.length} pages at concurrency ${CRAWL_CONCURRENCY}...`);

  const crawled = new Map(); // pagePath -> { name, images }
  const crawlFailures = [];
  await mapLimit(pagePaths, CRAWL_CONCURRENCY, async (pagePath) => {
    try {
      const res = await fetch(PAGE_BASE + pagePath);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const parsed = parseIntersectionPage(await res.text());
      if (!parsed.name || parsed.images.length === 0) {
        throw new Error("page has no title or no camera images");
      }
      crawled.set(pagePath, parsed);
    } catch (error) {
      crawlFailures.push({ pagePath, message: error.message });
    }
  });

  if (crawlFailures.length > 0) {
    console.warn(`${crawlFailures.length} page(s) failed to crawl (left untouched, not retired):`);
    for (const failure of crawlFailures) console.warn(`  ${failure.pagePath}: ${failure.message}`);
  }

  let sitesNew = 0;
  let sitesSeen = 0;
  let camerasNew = 0;
  let camerasSeen = 0;
  const seenPagePaths = [];
  const seenImagePaths = [];

  for (const pagePath of pagePaths) {
    const crawledPage = crawled.get(pagePath);
    const kmlEntry = kmlByPath.get(pagePath);
    const name = crawledPage?.name ?? kmlEntry?.name;

    if (!name) {
      // Crawl failed for a page that isn't in the KML either, so there is nothing to insert
      // a *new* row with. If a row already exists from a previous run, still mark it seen —
      // a transient fetch failure should not retire a camera that was fine yesterday.
      seenPagePaths.push(pagePath);
      await pool.query(
        `UPDATE vancouver_camera_sites SET last_seen_at = now(), retired_at = NULL WHERE page_path = $1`,
        [pagePath],
      );
      continue;
    }

    seenPagePaths.push(pagePath);
    const hasKmlLocation = kmlEntry?.lat != null && kmlEntry?.lng != null;
    const siteResult = await pool.query(
      `INSERT INTO vancouver_camera_sites (page_path, kml_id, name, lat, lng, location_source, last_seen_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (page_path) DO UPDATE SET
         kml_id = COALESCE(EXCLUDED.kml_id, vancouver_camera_sites.kml_id),
         name = EXCLUDED.name,
         last_seen_at = now(),
         retired_at = NULL,
         lat = CASE WHEN vancouver_camera_sites.location_source IS DISTINCT FROM 'manual' AND EXCLUDED.lat IS NOT NULL
                    THEN EXCLUDED.lat ELSE vancouver_camera_sites.lat END,
         lng = CASE WHEN vancouver_camera_sites.location_source IS DISTINCT FROM 'manual' AND EXCLUDED.lng IS NOT NULL
                    THEN EXCLUDED.lng ELSE vancouver_camera_sites.lng END,
         location_source = CASE WHEN vancouver_camera_sites.location_source IS DISTINCT FROM 'manual' AND EXCLUDED.lat IS NOT NULL
                    THEN EXCLUDED.location_source ELSE vancouver_camera_sites.location_source END
       RETURNING id, (xmax = 0) AS inserted`,
      [
        pagePath,
        kmlEntry?.kmlId ?? null,
        name,
        kmlEntry?.lat ?? null,
        kmlEntry?.lng ?? null,
        hasKmlLocation ? "kml" : null,
      ],
    );
    const { id: siteId, inserted: siteInserted } = siteResult.rows[0];
    if (siteInserted) sitesNew++;
    else sitesSeen++;

    for (const image of crawledPage?.images ?? []) {
      seenImagePaths.push(image.imagePath);
      const cameraResult = await pool.query(
        `INSERT INTO vancouver_cameras (site_id, image_path, direction_label, heading, alt, last_seen_at)
         VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (image_path) DO UPDATE SET
           site_id = EXCLUDED.site_id,
           direction_label = EXCLUDED.direction_label,
           heading = EXCLUDED.heading,
           alt = EXCLUDED.alt,
           last_seen_at = now(),
           retired_at = NULL
         RETURNING (xmax = 0) AS inserted`,
        [siteId, image.imagePath, image.directionLabel, image.heading ?? null, image.alt],
      );
      if (cameraResult.rows[0].inserted) camerasNew++;
      else camerasSeen++;
    }
  }

  const sitesRetired = await pool.query(
    `UPDATE vancouver_camera_sites SET retired_at = now()
     WHERE retired_at IS NULL AND NOT (page_path = ANY($1::text[]))`,
    [seenPagePaths],
  );

  // Scoped to sites this pass actually fetched (not ones that merely failed to load): a page
  // we couldn't reach this run is not evidence its cameras are gone.
  const successfullyCrawledPaths = [...crawled.keys()];
  const camerasRetired = await pool.query(
    `UPDATE vancouver_cameras c SET retired_at = now()
     FROM vancouver_camera_sites s
     WHERE c.site_id = s.id
       AND c.retired_at IS NULL
       AND s.page_path = ANY($1::text[])
       AND NOT (c.image_path = ANY($2::text[]))`,
    [successfullyCrawledPaths, seenImagePaths],
  );

  const { rows: noLocationRows } = await pool.query(
    `SELECT count(*)::int AS count FROM vancouver_camera_sites WHERE lat IS NULL AND retired_at IS NULL`,
  );

  console.log("");
  console.log("=== Crawl summary ===");
  console.log(`Sites:   ${sitesNew + sitesSeen} seen (${sitesNew} new), ${sitesRetired.rowCount} retired`);
  console.log(`Cameras: ${camerasNew + camerasSeen} seen (${camerasNew} new), ${camerasRetired.rowCount} retired`);
  console.log(`Sites without a location: ${noLocationRows[0].count}`);
  if (placemarksWithNoLink > 0) {
    console.log(`KML placemarks with no page link (skipped): ${placemarksWithNoLink}`);
  }
  if (crawlFailures.length > 0) {
    console.log(`Pages that failed to crawl this pass: ${crawlFailures.length}`);
  }
}

// A GeoJSON position is [lng, lat] with an optional altitude, so this cannot be a 2-tuple.
const positionSchema = z.tuple([z.number(), z.number()]).rest(z.number());

const geocodeResponseSchema = z.object({
  features: z.array(
    z.object({
      geometry: z.object({ coordinates: positionSchema }),
      properties: z.object({
        address: z
          .object({ addressLine: z.string().optional(), formattedAddress: z.string().optional() })
          .optional(),
      }),
    }),
  ),
});

/**
 * One geocode attempt. Returns null on no match, a Low-ish miss, or — the gate that actually
 * matters here (§2) — a result whose `addressLine` doesn't echo back the `&` intersection, since
 * Azure rolls an unmatched intersection up to a point somewhere along just one of the streets
 * rather than failing outright.
 */
async function fetchGeocode(params) {
  const res = await fetch(`${GEOCODE_URL}?${params}`);
  if (!res.ok) throw new Error(`Azure Maps geocode failed: ${res.status} ${await res.text()}`);

  const parsed = geocodeResponseSchema.safeParse(await res.json());
  if (!parsed.success) return null;

  const feature = parsed.data.features[0];
  if (!feature) return null;

  const addressLine = feature.properties.address?.addressLine ?? "";
  if (!addressLine.includes("&")) return null;

  const [lng, lat] = feature.geometry.coordinates;
  return { lat, lng, note: feature.properties.address?.formattedAddress ?? addressLine };
}

function ampersand(name) {
  return name.replace(/ and /gi, " & ");
}

function geocodeStructured(name, apiKey) {
  const params = new URLSearchParams({
    "api-version": GEOCODE_API_VERSION,
    addressLine: ampersand(name),
    locality: "Vancouver",
    adminDistrict: "BC",
    countryRegion: "CA",
    top: "1",
    "subscription-key": apiKey,
  });
  return fetchGeocode(params);
}

function geocodeFreeform(name, apiKey) {
  const params = new URLSearchParams({
    "api-version": GEOCODE_API_VERSION,
    query: `${ampersand(name)}, Vancouver, BC`,
    coordinates: BIAS_COORDINATES,
    top: "1",
    "subscription-key": apiKey,
  });
  return fetchGeocode(params);
}

async function geocode(pool) {
  const apiKey = requireEnv("AZURE_MAPS_KEY");

  const { rows } = await pool.query(
    `SELECT id, name FROM vancouver_camera_sites WHERE lat IS NULL AND location_source IS DISTINCT FROM 'manual'`,
  );
  console.log(`Geocoding ${rows.length} site(s) with no location...`);

  let matched = 0;
  let unmatched = 0;
  for (const site of rows) {
    // Structured first; the freeform form is the fallback, not the primary — §4 step 2.1
    // measured the union gaining 6 sites over either form alone.
    const hit = (await geocodeStructured(site.name, apiKey)) ?? (await geocodeFreeform(site.name, apiKey));
    if (hit) {
      await pool.query(
        `UPDATE vancouver_camera_sites SET lat = $1, lng = $2, location_source = 'azure', location_note = $3 WHERE id = $4`,
        [hit.lat, hit.lng, hit.note, site.id],
      );
      matched++;
    } else {
      console.warn(`  no match: ${site.name}`);
      unmatched++;
    }
  }

  console.log("");
  console.log("=== Geocode summary ===");
  console.log(`Matched: ${matched}, unmatched: ${unmatched} (left NULL — fix manually, see §4 step 2.3)`);
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
  const step = process.argv[2];
  if (step && step !== "crawl" && step !== "geocode") {
    console.error("Usage: node sync-vancouver-cameras.mjs [crawl|geocode]");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: requireEnv("DATABASE_URL") });
  try {
    if (!step || step === "crawl") await crawl(pool);
    if (!step || step === "geocode") await geocode(pool);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
