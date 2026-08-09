import { AzureMapsGeocoder } from "@/lib/geocoding/azure-maps-geocoder";
import { RouteResolver } from "./route-resolver";
import { MockRouteResolver } from "./mock-route-resolver";
import { AzureFoundryDescriptionParser } from "./azure-foundry-description-parser";
import { GeocodingRouteResolver } from "./geocoding-route-resolver";

// Dev-mode module reloads can otherwise reset this singleton mid-session; stash it on
// globalThis so `npm run dev` keeps one instance across Fast Refresh.
const globalForResolver = globalThis as unknown as {
  routeResolver?: RouteResolver;
};

// Both keys are required for the real path: the parser only produces place names, and a
// review step without coordinates is worthless. Missing either falls back to the mock
// resolver, whose dictionary already carries real coordinates — same env-gated pattern as
// the Postgres swap in lib/routes/repository.ts.
function createRouteResolver(): RouteResolver {
  const foundryKey = process.env.AZURE_FOUNDRY_API_KEY;
  const mapsKey = process.env.AZURE_MAPS_KEY;
  if (!foundryKey || !mapsKey) return new MockRouteResolver();

  const endpoint = process.env.AZURE_FOUNDRY_ENDPOINT ?? "https://roadsight-foundry.services.ai.azure.com";
  const deploymentName = process.env.AZURE_FOUNDRY_DEPLOYMENT ?? "gpt-oss-120b";
  return new GeocodingRouteResolver(
    new AzureFoundryDescriptionParser(endpoint, foundryKey, deploymentName),
    new AzureMapsGeocoder(mapsKey),
  );
}

export const routeResolver: RouteResolver = globalForResolver.routeResolver ?? createRouteResolver();

if (process.env.NODE_ENV !== "production") {
  globalForResolver.routeResolver = routeResolver;
}
