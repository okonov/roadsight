import { CameraCatalogue } from "./types";

export interface CameraSource {
  /**
   * Every camera DriveBC currently publishes.
   *
   * Implementations must not throw. A route page without a live catalogue falls back to the
   * committed snapshot, and one without any catalogue renders an empty state — neither is a
   * reason to fail the page, which still has a map and a route on it.
   */
  load(): Promise<CameraCatalogue>;
}
