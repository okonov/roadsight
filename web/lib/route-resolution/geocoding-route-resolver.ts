import { Geocoder } from "@/lib/geocoding/geocoder";
import { ResolvedEndpoints, RouteResolver } from "./route-resolver";
import { RouteDescriptionParser } from "./route-description-parser";

/**
 * Full resolution in two steps: an LLM names the endpoints, a geocoder pins them to
 * coordinates. Both happen during `resolve` so the review step shows the coordinates the
 * route will actually be planned from — see §5.2 of docs/add-route-design.md.
 */
export class GeocodingRouteResolver implements RouteResolver {
  constructor(
    private readonly parser: RouteDescriptionParser,
    private readonly geocoder: Geocoder,
  ) {}

  async resolve(description: string): Promise<ResolvedEndpoints | null> {
    const labels = await this.parser.parse(description);
    if (!labels) return null;

    const [origin, destination] = await Promise.all([
      this.geocoder.geocode(labels.origin),
      this.geocoder.geocode(labels.destination),
    ]);
    // A label the geocoder cannot place is a description problem, not an outage: null
    // becomes a 422 and the wizard offers a reword.
    if (!origin || !destination) return null;

    return { origin, destination };
  }
}
