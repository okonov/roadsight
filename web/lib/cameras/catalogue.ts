import { getPool } from "../db";
import { CameraSource } from "./camera-source";
import { CompositeCameraSource } from "./composite-camera-source";
import { DriveBcCameraSource } from "./drivebc-camera-source";
import { SnapshotCameraSource } from "./snapshot-camera-source";
import { VancouverCameraSource } from "./vancouver-camera-source";

// Dev-mode module reloads can otherwise reset this singleton mid-session; stash it on
// globalThis so `npm run dev` keeps one instance across Fast Refresh. That matters more here
// than for the other swap points: this is what holds the hour-long cache, and without it every
// file save would re-download the whole catalogue.
const globalForCameras = globalThis as unknown as {
  cameraCatalogue?: CameraSource;
};

// Same swap-point shape as the planner, resolver and repository, but gated differently:
// DriveBC is public, so there is no key whose absence means "use the mock". The live source
// already falls back to the snapshot on its own when DriveBC is unreachable; the env var is
// only for pinning the committed list deliberately, e.g. to demo with no network at all — and
// pins DriveBC alone, since the City's cameras need a database.
//
// The City's cameras live in Postgres (synced by scripts/sync-vancouver-cameras.mjs), so they
// are gated on DATABASE_URL exactly as the route repository is: without one, `npm run dev`
// shows DriveBC only rather than logging a failed query per hour.
function createCameraSource(): CameraSource {
  const snapshot = new SnapshotCameraSource();
  if (process.env.CAMERA_SOURCE === "snapshot") return snapshot;

  const driveBc = new DriveBcCameraSource(snapshot);
  if (!process.env.DATABASE_URL) return driveBc;

  return new CompositeCameraSource([driveBc, new VancouverCameraSource(getPool())]);
}

export const cameraCatalogue: CameraSource =
  globalForCameras.cameraCatalogue ?? createCameraSource();

if (process.env.NODE_ENV !== "production") {
  globalForCameras.cameraCatalogue = cameraCatalogue;
}
