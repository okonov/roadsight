import { CameraSource } from "./camera-source";
import { Camera, CameraCatalogue } from "./types";

/**
 * Several sources presented as one catalogue.
 *
 * Loads them concurrently and concatenates. Ids are source-prefixed, so nothing here needs to
 * dedupe or re-key. `origin` is the weakest member's — one source on a saved copy makes the
 * whole list partly saved — and `fetchedAt` is the oldest, which is the date that disclosure
 * needs to show.
 *
 * Members contract not to throw; `allSettled` is so that one breaking that contract costs its
 * own cameras rather than everyone's.
 */
export class CompositeCameraSource implements CameraSource {
  constructor(private readonly sources: CameraSource[]) {}

  async load(): Promise<CameraCatalogue> {
    const results = await Promise.allSettled(this.sources.map((source) => source.load()));

    const cameras: Camera[] = [];
    let origin: CameraCatalogue["origin"] = "live";
    let fetchedAt: string | null = null;
    for (const result of results) {
      if (result.status === "rejected") {
        console.warn("Camera source failed:", result.reason);
        continue;
      }
      const catalogue = result.value;
      cameras.push(...catalogue.cameras);
      if (catalogue.origin === "snapshot") origin = "snapshot";
      if (fetchedAt === null || Date.parse(catalogue.fetchedAt) < Date.parse(fetchedAt)) {
        fetchedAt = catalogue.fetchedAt;
      }
    }

    return { cameras, fetchedAt: fetchedAt ?? new Date().toISOString(), origin };
  }
}
