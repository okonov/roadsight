// Direction parsing for a Vancouver camera image — see docs/add-trafficcams-vancouver.md §1
// ("Direction is in the alt, not the filename") for the measurements this is built from.

const COMPASS_SUFFIX = /(north|south|east|west)(?=\.[a-z0-9]+$)/i;

/**
 * The published direction label for one `<img>`, plus the compass heading derived from it.
 *
 * The label is the free-text alt suffix after the last ` - ` (`South Main`, `West exit`,
 * `Seymour`) — that is what a driver reads, so it is stored verbatim. Five images across the
 * whole site have no ` - ` in their alt at all; those fall back to the filename's trailing
 * `North|South|East|West`, which recovers all five (measured).
 *
 * `heading` is a best-effort compass reduction of the label, for a future ranking step that
 * prefers cameras facing the direction of travel. It is `null` whenever the label is not
 * (or does not start with) a compass word, e.g. `Seymour` or `Howe` — those are real, not a
 * parse failure.
 */
export function parseDirection(alt, imagePath) {
  const dashIndex = alt.lastIndexOf("-");
  if (dashIndex !== -1) {
    const label = alt.slice(dashIndex + 1).trim();
    if (label) return { directionLabel: label, heading: headingFromLabel(label) };
  }

  const filename = imagePath.split("/").pop() ?? "";
  const match = filename.match(COMPASS_SUFFIX);
  const label = match ? match[1][0].toUpperCase() + match[1].slice(1).toLowerCase() : "";
  return { directionLabel: label, heading: headingFromLabel(label) };
}

function headingFromLabel(label) {
  const words = label.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;

  const [first, second] = words;
  if (first === "northeast") return "NE";
  if (first === "southeast") return "SE";
  if (first === "southwest") return "SW";
  if (first === "northwest") return "NW";
  if (first === "north") return second === "east" ? "NE" : second === "west" ? "NW" : "N";
  if (first === "south") return second === "east" ? "SE" : second === "west" ? "SW" : "S";
  if (first === "east") return "E";
  if (first === "west") return "W";
  return null;
}
