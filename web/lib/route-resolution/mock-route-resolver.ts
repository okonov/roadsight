import { ResolvedPlace } from "@/lib/routes/types";
import { ResolvedEndpoints, RouteResolver } from "./route-resolver";

interface KnownPlace extends ResolvedPlace {
  aliases: string[];
}

// Real BC places with real coordinates so demo routes look plausible on a map.
// The spec's example "Lougheed Mall to Squamish waterfall" resolves verbatim.
const KNOWN_PLACES: KnownPlace[] = [
  {
    label: "Lougheed Town Centre, Burnaby, BC",
    lat: 49.2486,
    lng: -122.8969,
    aliases: ["lougheed mall", "lougheed town centre", "lougheed"],
  },
  {
    label: "Shannon Falls Provincial Park, Squamish, BC",
    lat: 49.6702,
    lng: -123.1567,
    aliases: ["squamish waterfall", "shannon falls", "squamish falls"],
  },
  {
    label: "Metropolis at Metrotown, Burnaby, BC",
    lat: 49.2276,
    lng: -123.0076,
    aliases: ["metrotown", "metropolis"],
  },
  {
    label: "University of British Columbia, Vancouver, BC",
    lat: 49.2606,
    lng: -123.246,
    aliases: ["ubc", "university of british columbia"],
  },
  {
    label: "Stanley Park, Vancouver, BC",
    lat: 49.3017,
    lng: -123.1417,
    aliases: ["stanley park"],
  },
  {
    label: "Whistler Village, Whistler, BC",
    lat: 50.1163,
    lng: -122.9574,
    aliases: ["whistler village", "whistler"],
  },
  {
    label: "Horseshoe Bay, West Vancouver, BC",
    lat: 49.3733,
    lng: -123.2716,
    aliases: ["horseshoe bay"],
  },
  {
    label: "Grouse Mountain, North Vancouver, BC",
    lat: 49.3804,
    lng: -123.0827,
    aliases: ["grouse mountain", "grouse"],
  },
  {
    label: "Downtown Vancouver, BC",
    lat: 49.2827,
    lng: -123.1207,
    aliases: ["downtown vancouver", "vancouver downtown", "downtown"],
  },
  {
    label: "Simon Fraser University, Burnaby, BC",
    lat: 49.2781,
    lng: -122.9199,
    aliases: ["sfu", "simon fraser university", "simon fraser"],
  },
];

function matchPlace(text: string): ResolvedPlace | null {
  let best: { place: KnownPlace; aliasLength: number } | null = null;
  for (const place of KNOWN_PLACES) {
    for (const alias of place.aliases) {
      if (text.includes(alias) && (!best || alias.length > best.aliasLength)) {
        best = { place, aliasLength: alias.length };
      }
    }
  }
  if (!best) return null;
  const { label, lat, lng } = best.place;
  return { label, lat, lng };
}

export class MockRouteResolver implements RouteResolver {
  async resolve(description: string): Promise<ResolvedEndpoints | null> {
    // Artificial delay so the UI's "Resolving…" state is visible in demos.
    await new Promise((r) => setTimeout(r, 300 + Math.random() * 500));

    let text = description.trim().toLowerCase();
    if (text.startsWith("from ")) text = text.slice(5);

    const parts = text.split(/\s+to\s+|→/).map((p) => p.trim());
    if (parts.length !== 2 || !parts[0] || !parts[1]) return null;

    const origin = matchPlace(parts[0]);
    const destination = matchPlace(parts[1]);
    if (!origin || !destination) return null;

    return { origin, destination };
  }
}
