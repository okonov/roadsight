import { z } from "zod";
import { ResolvedPlace } from "@/lib/routes/types";
import { Geocoder } from "./geocoder";

const GEOCODE_URL = "https://atlas.microsoft.com/geocode";
const API_VERSION = "2026-01-01";

// Geobias toward the Lower Mainland, which is what disambiguates the many duplicated
// place names in the Pacific Northwest ("Vancouver" -> BC, not WA). Format: lon,lat.
//
// Deliberately no `bbox`: measured against the live service, adding a BC+WA bounding box
// makes landmark queries *worse*, not better. "Simon Fraser University" returns the
// correct HigherEducationFacility at High confidence with coordinates alone, but
// degrades to Low-confidence junk ("Fraser, CO") once a bbox is present. `countryRegion`
// is not an option either — it cannot be combined with a freeform `query`, and it would
// break the Washington extension. Out-of-area matches are handled by the confidence gate
// below instead, which is where the live results show they get filtered anyway.
const BIAS_COORDINATES = "-123.1,49.3";

// A GeoJSON position is [lon, lat] with an optional third altitude element, so this
// cannot be a plain 2-tuple.
const pointSchema = z.object({
  coordinates: z.tuple([z.number(), z.number()]).rest(z.number()),
});

const featureSchema = z.object({
  geometry: pointSchema,
  properties: z.object({
    address: z.object({ formattedAddress: z.string().optional() }).optional(),
    confidence: z.enum(["High", "Medium", "Low"]).optional(),
    geocodePoints: z
      .array(
        z.object({
          geometry: pointSchema,
          usageTypes: z.array(z.string()).optional(),
        }),
      )
      .optional(),
  }),
});

const responseSchema = z.object({
  features: z.array(featureSchema),
});

type Feature = z.infer<typeof featureSchema>;

/**
 * A feature carries a `Display` point (visual centre of a park or building) and often a
 * separate `Route` point (a vehicle-accessible entrance). Routing wants the latter.
 */
function routingCoordinates(feature: Feature): [number, number, ...number[]] {
  const routePoint = feature.properties.geocodePoints?.find((p) =>
    p.usageTypes?.includes("Route"),
  );
  return routePoint?.geometry.coordinates ?? feature.geometry.coordinates;
}

export class AzureMapsGeocoder implements Geocoder {
  constructor(private readonly subscriptionKey: string) {}

  async geocode(query: string): Promise<ResolvedPlace | null> {
    const params = new URLSearchParams({
      "api-version": API_VERSION,
      query,
      coordinates: BIAS_COORDINATES,
      top: "1",
      "subscription-key": this.subscriptionKey,
    });

    const res = await fetch(`${GEOCODE_URL}?${params}`);
    if (!res.ok) {
      throw new Error(`Azure Maps geocode failed: ${res.status} ${await res.text()}`);
    }

    const parsed = responseSchema.safeParse(await res.json());
    if (!parsed.success) return null;

    // Get Geocoding prioritizes correctness over guessing: a 200 with no features is the
    // normal "no match" signal, not a failure. `Ambiguous` matches are kept — they mean
    // several candidates existed and this is the top-ranked one.
    const feature = parsed.data.features[0];
    if (!feature || feature.properties.confidence === "Low") return null;

    const [lng, lat] = routingCoordinates(feature);
    return {
      // The geocoder's own label, not the caller's query: if the service rolled up to a
      // coarser place, the review step must show where the route will actually go.
      label: feature.properties.address?.formattedAddress ?? query,
      lat,
      lng,
    };
  }
}
