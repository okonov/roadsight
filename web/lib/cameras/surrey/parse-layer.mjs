// Normalisation for the City of Surrey's camera layer — see docs/add-surrey-cameras.md §2 for
// the measurements every rule below comes from, and §6 step 2 for where this sits in the sync.
// Pure: no I/O, so it can be run against fixtures/layer-sample.json without the live service.

// Surrey's own image hosts. Anything else (www.drivebc.ca, images.drivebc.ca) is a provincial
// camera already covered by the DriveBC source. Filtering on the host rather than OWNER is
// deliberate: three of the provincial records have OWNER null.
const SURREY_IMAGE_HOSTS = new Set(["stcameleonprod.blob.core.windows.net", "cosmos.surrey.ca"]);

// The trailing `_cam1`, `_pano`, `_quadN`, `_cam1S`… of CAMERA_NAME: what kind of frame it is
// (§2 "What a camera is"), and for a single direction of a quad or twin camera, which way.
const NAME_SUFFIX = /_(cam\d+(v|[nesw])?|pano|quad([nesw])?)$/i;

/**
 * Features from either layer's `query?…&f=json` → one record per unique Surrey camera:
 * `{ cameraKey, cameraName, location, siteKey, kind, heading, imageUrl, nvr, lat, lng }`.
 *
 * Accepts both field sets. The operational layer has CAMERA_NAME, OWNER and NVR; the open-data
 * copy (the fallback) has only LOCATION and IMAGE, so there the name comes from the image
 * filename (`enc_<name>.jpg`) and the NVR from its folder — the same values in every record
 * checked. Also returns counts of what was dropped, for the sync's summary.
 */
export function parseLayer(features) {
  const byKey = new Map();
  const dropped = { noImage: 0, badImage: 0, notSurrey: 0, noGeometry: 0, duplicate: 0 };

  for (const feature of features) {
    const attributes = feature.attributes ?? {};
    // Trim, never lower-case: the blob is case-sensitive (`enc_83A_140_cam1.jpg`), and one
    // published value ends in "\n ".
    const imageUrl = attributes.IMAGE?.trim();
    if (!imageUrl) {
      dropped.noImage++;
      continue;
    }

    let url;
    try {
      url = new URL(imageUrl);
    } catch {
      dropped.badImage++;
      continue;
    }
    if (!SURREY_IMAGE_HOSTS.has(url.host)) {
      dropped.notSurrey++;
      continue;
    }

    const lat = feature.geometry?.y;
    const lng = feature.geometry?.x;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      dropped.noGeometry++;
      continue;
    }

    const cameraName = attributes.CAMERA_NAME?.trim() || nameFromImage(url);
    const cameraKey = cameraName.toLowerCase();
    const location = attributes.LOCATION?.trim() ?? "";
    const { kind, heading } = parseSuffix(cameraName);

    const record = {
      cameraKey,
      cameraName,
      location,
      siteKey: location ? siteKeyFromLocation(location) : siteKeyFromName(cameraName),
      kind,
      heading,
      imageUrl,
      nvr: attributes.NVR?.trim() || nvrFromImage(url),
      lat,
      lng,
      owner: attributes.OWNER ?? null,
    };

    // Five cameras appear twice, once with OWNER='Surrey' and once with OWNER null, points up
    // to 150 m apart. Keep the 'Surrey' one; otherwise the first seen.
    const existing = byKey.get(cameraKey);
    if (existing) {
      dropped.duplicate++;
      if (existing.owner !== "Surrey" && record.owner === "Surrey") byKey.set(cameraKey, record);
      continue;
    }
    byKey.set(cameraKey, record);
  }

  // `owner` only mattered for the dedupe above.
  const cameras = [...byKey.values()];
  for (const camera of cameras) delete camera.owner;
  return { cameras, dropped };
}

/**
 * The grouping key for `Camera.group` (§2 "Grouping cameras into sites"): lower-case, `and`
 * → `&`, `blk` → `block`, whitespace collapsed, and the two street names sorted, so that
 * `96 Ave And 195 St` and `195 St & 96 Ave` land on the same site. 510 sites from 643 cameras,
 * measured. A location that isn't an intersection (`McBride Ave Railway Crossing`) is just
 * normalised.
 */
export function siteKeyFromLocation(location) {
  const normalised = location
    .toLowerCase()
    .replace(/\band\b/g, "&")
    .replace(/\bblk\b/g, "block")
    .replace(/\s+/g, " ")
    .trim();
  return normalised
    .split("&")
    .map((street) => street.trim())
    .filter(Boolean)
    .sort()
    .join(" & ");
}

/** The fallback when LOCATION is null (one camera, `26_168_pano`): the name minus its suffix. */
export function siteKeyFromName(cameraName) {
  return cameraName.toLowerCase().replace(NAME_SUFFIX, "");
}

/**
 * `kind` and `heading` from the CAMERA_NAME suffix. `pano` is a 360° fisheye, a bare `quad` is
 * four views in one frame, and everything else is one conventional view — with a heading only
 * when the suffix names one (`quadN`, `cam1S`). `cam1v` is a view with no direction.
 */
export function parseSuffix(cameraName) {
  const match = cameraName.match(NAME_SUFFIX);
  if (!match) return { kind: "view", heading: null };

  const suffix = match[1].toLowerCase();
  if (suffix === "pano") return { kind: "pano", heading: null };
  if (suffix === "quad") return { kind: "quad", heading: null };

  const direction = (match[3] ?? match[2])?.toUpperCase();
  return { kind: "view", heading: ["N", "E", "S", "W"].includes(direction) ? direction : null };
}

// `…/TMCNVR11/enc_100_whalley_cam1.jpg` → `100_whalley_cam1`
function nameFromImage(url) {
  const filename = decodeURIComponent(url.pathname.split("/").pop() ?? "");
  return filename.replace(/\.[^.]*$/, "").replace(/^enc_/i, "").trim();
}

// `…/prodcameleon-blob/TMCNVR11/enc_….jpg` → `TMCNVR11`; null on the cosmos host.
function nvrFromImage(url) {
  return url.pathname.match(/\/(TMCNVR\d+)\//i)?.[1] ?? null;
}
