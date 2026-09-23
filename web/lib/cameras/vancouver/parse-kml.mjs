// See docs/add-trafficcams-vancouver.md §2: the KML behind the root page's "Find the
// intersection's pin on the map" link is the geolocation source. It carries no image URLs —
// it is a list of sites, not cameras — so the crawl (parse-root-page.mjs +
// parse-intersection-page.mjs) is still required for everything below the site level.

const PLACEMARK = /<Placemark id="([^"]*)">([\s\S]*?)<\/Placemark>/g;
const DESCRIPTION = /<description>([\s\S]*?)<\/description>/;
const COORDINATES = /<coordinates>([\s\S]*?)<\/coordinates>/;
const NAME_IN_DESCRIPTION = /<h5>([^<]*)<\/h5>/;
const PAGE_LINK = /href=['"]([^'"]*trafficcams\.vancouver\.ca[^'"]*)['"]/;

const ENTITIES = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'", "#39": "'" };

function decodeEntities(text) {
  return text.replace(/&(lt|gt|amp|quot|apos|#39);/g, (_, name) => ENTITIES[name]);
}

/**
 * One placemark from the KML: `{ kmlId, name, pagePath, lat, lng }`.
 *
 * `pagePath` is `null` for the rare placemark with no link to a `trafficcams.vancouver.ca`
 * page (measured: one, in a snapshot that otherwise had 219 placemarks for 216 pages) — there
 * is then no natural key to upsert a `vancouver_camera_sites` row against, so callers should
 * log and skip rather than invent one. `name` is the KML's own label (from the popup's
 * `<h5>`), kept as a fallback for exactly that case; the page's own `<h1>` is the source of
 * truth whenever a page exists, per the `vancouver_camera_sites.name` column.
 */
export function parseKml(xml) {
  const placemarks = [];
  for (const match of xml.matchAll(PLACEMARK)) {
    const [, kmlId, body] = match;

    const descriptionMatch = body.match(DESCRIPTION);
    const description = descriptionMatch ? decodeEntities(descriptionMatch[1]) : "";
    const name = description.match(NAME_IN_DESCRIPTION)?.[1]?.trim() ?? null;
    const link = description.match(PAGE_LINK)?.[1];
    const pagePath = link ? new URL(link).pathname.trim().toLowerCase() : null;

    const coordinates = body.match(COORDINATES)?.[1]?.trim();
    const [lng, lat] = (coordinates ?? "").split(",").map(Number);

    placemarks.push({
      kmlId,
      name,
      pagePath,
      lat: Number.isFinite(lat) ? lat : null,
      lng: Number.isFinite(lng) ? lng : null,
    });
  }
  return placemarks;
}
