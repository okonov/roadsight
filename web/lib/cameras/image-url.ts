import { Camera } from "./types";

const IMAGE_BASE = "https://www.drivebc.ca/images";
const VANCOUVER_IMAGE_BASE = "https://trafficcams.vancouver.ca";

/** Width of the city cameras' `?t=` clock bucket; see `clockBucketedUrl`. */
const CLOCK_BUCKET_MS = 60 * 1000;

/**
 * Live frame for a camera, from whichever source publishes it.
 *
 * `nowMs` must be one server-side timestamp for the whole render, passed down to the client:
 * a city camera's URL depends on it, and the card is a client component, so a clock read in the
 * browser would produce different HTML from the server's and fail hydration.
 */
export function cameraImageUrl(camera: Camera, nowMs: number): string {
  switch (camera.source) {
    case "drivebc":
      return driveBcImageUrl(camera);
    case "vancouver":
      return clockBucketedUrl(`${VANCOUVER_IMAGE_BASE}/${camera.sourceKey}`, nowMs);
    case "surrey":
      // Already a full URL on the City's blob host, case preserved (docs/add-surrey-cameras.md §2).
      return clockBucketedUrl(camera.sourceKey, nowMs);
  }
}

/**
 * A DriveBC frame.
 *
 * Hotlinked rather than proxied: unlike the Azure Maps static image, this URL carries no
 * secret, DriveBC serves it with `access-control-allow-origin: *`, and putting up to forty
 * JPEGs per page view through our own server would buy nothing while breaking the conditional
 * requests that make them cheap. DriveBC sends `cache-control: no-cache` with an `ETag` and
 * answers `If-None-Match` with a 304, which is exactly right for a feed that changes every
 * fifteen minutes — so nothing here should try to cache harder than that.
 *
 * `?t=` is keyed on the camera's own last update rather than on the clock: it stays put while
 * the picture is unchanged, so a re-render is a memory-cache hit, and it changes when the
 * picture does. Deliberately not DriveBC's own `links.imageDisplay`, whose `t` is stamped at
 * the time of the *API call* and so would churn on every catalogue refresh.
 *
 * NOTE: a camera with `isOn: false` still answers 200 here, with a black frame. Callers must
 * check the flag rather than waiting for an error that will not come.
 */
function driveBcImageUrl(camera: Camera): string {
  const url = `${IMAGE_BASE}/${camera.sourceKey}.jpg`;
  if (!camera.lastUpdated) return url;

  const updatedAtMs = Date.parse(camera.lastUpdated);
  if (Number.isNaN(updatedAtMs)) return url;

  return `${url}?t=${Math.floor(updatedAtMs / 1000)}`;
}

/**
 * A City of Vancouver or City of Surrey frame. Hotlinked for the same reasons as DriveBC's, and
 * never proxied — the terms positions in docs/add-trafficcams-vancouver.md §8.1 and
 * docs/add-surrey-cameras.md §9.1 rest on the viewer's browser fetching straight from the City.
 *
 * Neither city publishes a per-camera timestamp, so `?t=` is clock-bucketed to the minute:
 * short enough that the next page view picks up a one-to-five-minute refresh, long enough that
 * a re-render within the minute is a memory-cache hit. The cost is that a new bucket is a new
 * URL, so the cities' `ETag`s never get used and each page view re-downloads the frame.
 */
function clockBucketedUrl(url: string, nowMs: number): string {
  return `${url}?t=${Math.floor(nowMs / CLOCK_BUCKET_MS)}`;
}
