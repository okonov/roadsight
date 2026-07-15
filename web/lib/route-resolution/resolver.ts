import { RouteResolver } from "./route-resolver";
import { MockRouteResolver } from "./mock-route-resolver";
import { AzureFoundryRouteResolver } from "./azure-foundry-route-resolver";

// Dev-mode module reloads can otherwise reset this singleton mid-session; stash it on
// globalThis so `npm run dev` keeps one instance across Fast Refresh.
const globalForResolver = globalThis as unknown as {
  routeResolver?: RouteResolver;
};

// Without AZURE_FOUNDRY_API_KEY set, falls back to the mock resolver — same
// env-gated pattern as the Postgres swap in lib/routes/repository.ts.
function createRouteResolver(): RouteResolver {
  const apiKey = process.env.AZURE_FOUNDRY_API_KEY;
  if (!apiKey) return new MockRouteResolver();

  const endpoint = process.env.AZURE_FOUNDRY_ENDPOINT ?? "https://roadsight-foundry.services.ai.azure.com";
  const deploymentName = process.env.AZURE_FOUNDRY_DEPLOYMENT ?? "gpt-oss-120b";
  return new AzureFoundryRouteResolver(endpoint, apiKey, deploymentName);
}

export const routeResolver: RouteResolver = globalForResolver.routeResolver ?? createRouteResolver();

if (process.env.NODE_ENV !== "production") {
  globalForResolver.routeResolver = routeResolver;
}
