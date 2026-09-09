import { Camera } from "./types";

const IMAGE_BASE = "https://www.drivebc.ca/images";

/**
 * Live frame for a camera.
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
export function cameraImageUrl(camera: Camera): string {
  const url = `${IMAGE_BASE}/${camera.id}.jpg`;
  if (!camera.lastUpdated) return url;

  const updatedAtMs = Date.parse(camera.lastUpdated);
  if (Number.isNaN(updatedAtMs)) return url;

  return `${url}?t=${Math.floor(updatedAtMs / 1000)}`;
}
