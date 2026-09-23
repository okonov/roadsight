// See docs/add-trafficcams-vancouver.md §1. Confirmed on every sampled page: an
// `<h1 class="display-2">` title and one `<img src="cameraimages/…" alt="…">` per camera, in
// that attribute order. No HTML parser dependency — the markup is this consistent.

import { parseDirection } from "./parse-direction.mjs";

const TITLE = /<h1 class="display-2">([^<]*)<\/h1>/;
// Scoped to `cameraimages/…`: the page also has a `<img>` for the City's header logo, which
// is not a camera and has no direction to parse.
const IMAGE = /<img\s+src="(cameraimages\/[^"]*)"\s+alt="([^"]*)"/g;

/**
 * One intersection page: its title and every camera on it.
 *
 * `image.imagePath` is kept exactly as published (`cameraimages/Boundary1stSNorth.jpg`) — the
 * natural key in `vancouver_cameras`, and the only thing needed to build the live image URL
 * later, since all 832 images live flat in that one folder.
 */
export function parseIntersectionPage(html) {
  const name = TITLE.exec(html)?.[1]?.trim() ?? null;

  const images = [];
  for (const match of html.matchAll(IMAGE)) {
    const [, imagePath, alt] = match;
    const trimmedPath = imagePath.trim();
    const trimmedAlt = alt.trim();
    const { directionLabel, heading } = parseDirection(trimmedAlt, trimmedPath);
    images.push({ imagePath: trimmedPath, alt: trimmedAlt, directionLabel, heading });
  }

  return { name, images };
}
