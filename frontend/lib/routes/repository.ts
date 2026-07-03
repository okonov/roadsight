import { RouteRepository } from "./route-repository";
import { InMemoryRouteRepository } from "./in-memory-route-repository";

// Dev-mode module reloads can otherwise reset this singleton mid-session; stash it on
// globalThis so `npm run dev` keeps in-memory data across Fast Refresh.
const globalForRoutes = globalThis as unknown as {
  routeRepository?: RouteRepository;
};

export const routeRepository: RouteRepository =
  globalForRoutes.routeRepository ?? new InMemoryRouteRepository();

if (process.env.NODE_ENV !== "production") {
  globalForRoutes.routeRepository = routeRepository;
}

// Later: swap to `new HttpRouteRepository(process.env.ROUTES_API_BASE_URL!)` — no other file changes.
