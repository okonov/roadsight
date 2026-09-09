// Regenerates lib/cameras/drivebc-snapshot.json — the camera list the app falls back to when
// DriveBC is unreachable on a cold start.
//
//   node scripts/fetch-camera-snapshot.mjs
//
// Run it by hand every few months. Plain ESM against Node's global fetch so it needs no
// dependency and no TypeScript runner.
//
// The snapshot holds *raw* DriveBC records, trimmed to the fields the app reads, so it is
// parsed back through exactly the same schema and mapper as the live feed — there is no second
// copy of the mapping to keep in step. FIELDS below must stay in step with the schema in
// drivebc-camera-source.ts.

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const WEBCAMS_URL = "https://www.drivebc.ca/api/webcams/";
const OUTPUT = fileURLToPath(new URL("../lib/cameras/drivebc-snapshot.json", import.meta.url));

const FIELDS = [
  "id",
  "location",
  "name",
  "name_override",
  "caption",
  "caption_override",
  "highway",
  "highway_description",
  "region_name",
  "orientation",
  "group",
  "is_on",
  "should_appear",
  "marked_stale",
  "marked_delayed",
  "last_update_modified",
  "update_period_mean",
  "credit",
  "dbc_mark",
];

const res = await fetch(WEBCAMS_URL);
if (!res.ok) throw new Error(`DriveBC returned ${res.status}`);

const raw = await res.json();
if (!Array.isArray(raw) || raw.length === 0) throw new Error("expected a non-empty array");

const cameras = raw.map((camera) =>
  Object.fromEntries(FIELDS.filter((field) => field in camera).map((field) => [field, camera[field]])),
);

// `last_update_modified` is deliberately kept even though it is instantly stale: the UI needs
// it to say how old a frame is, and a snapshot in use is already flagged as a snapshot.
await writeFile(OUTPUT, `${JSON.stringify({ fetchedAt: new Date().toISOString(), cameras })}\n`);

console.log(`Wrote ${cameras.length} cameras to ${OUTPUT}`);
