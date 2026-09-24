import { CameraCatalogue } from "./types";

export interface CameraSource {
  /**
   * Every camera this source currently publishes.
   *
   * Implementations must not throw. A route page without a live DriveBC catalogue falls back to
   * the committed snapshot, one without the City's cameras simply shows fewer, and one without
   * any catalogue renders an empty state — none is a reason to fail the page, which still has a
   * map and a route on it.
   */
  load(): Promise<CameraCatalogue>;
}
