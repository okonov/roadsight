import { RouteResolver } from "./route-resolver";
import { MockRouteResolver } from "./mock-route-resolver";

// Dev-mode module reloads can otherwise reset this singleton mid-session; stash it on
// globalThis so `npm run dev` keeps one instance across Fast Refresh.
const globalForResolver = globalThis as unknown as {
  routeResolver?: RouteResolver;
};

export const routeResolver: RouteResolver =
  globalForResolver.routeResolver ?? new MockRouteResolver();

if (process.env.NODE_ENV !== "production") {
  globalForResolver.routeResolver = routeResolver;
}

// Later: swap to `new AzureFoundryRouteResolver(...)` — no other file changes.
