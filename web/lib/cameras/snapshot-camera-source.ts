import { CameraSource } from "./camera-source";
import { parseCameras } from "./drivebc-camera-source";
import snapshot from "./drivebc-snapshot.json";
import { CameraCatalogue } from "./types";

/**
 * The camera list committed to the repo, for when DriveBC cannot be reached on a cold start.
 *
 * Statically imported rather than read with `fs`: the bundler then traces the file into the
 * build, which a runtime path lookup would not survive under a standalone output.
 *
 * It holds raw DriveBC records, so `parseCameras` validates it exactly as it validates the
 * live feed — a hand-edited snapshot degrades to an empty list rather than crashing a page.
 * Regenerate with `node scripts/fetch-camera-snapshot.mjs`.
 */
export class SnapshotCameraSource implements CameraSource {
  private catalogue: CameraCatalogue | null = null;

  async load(): Promise<CameraCatalogue> {
    // Parsed on first use, not at module load: most requests never reach the fallback, and
    // this walks a thousand records.
    this.catalogue ??= {
      cameras: parseCameras(snapshot.cameras) ?? [],
      fetchedAt: snapshot.fetchedAt,
      origin: "snapshot",
    };
    return this.catalogue;
  }
}
