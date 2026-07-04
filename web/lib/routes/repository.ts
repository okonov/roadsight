import { RouteRepository } from "./route-repository";
import { InMemoryRouteRepository } from "./in-memory-route-repository";
import { PostgresRouteRepository } from "./postgres-route-repository";
import { getPool } from "../db";

// Dev-mode module reloads can otherwise reset this singleton mid-session; stash it on
// globalThis so `npm run dev` keeps in-memory data across Fast Refresh.
const globalForRoutes = globalThis as unknown as {
  routeRepository?: RouteRepository;
};

// DATABASE_URL gates Postgres vs in-memory so `npm run dev` works without a DB running.
function createRepository(): RouteRepository {
  return process.env.DATABASE_URL
    ? new PostgresRouteRepository(getPool())
    : new InMemoryRouteRepository();
}

export const routeRepository: RouteRepository =
  globalForRoutes.routeRepository ?? createRepository();

if (process.env.NODE_ENV !== "production") {
  globalForRoutes.routeRepository = routeRepository;
}

// Later: swap to `new HttpRouteRepository(process.env.ROUTES_API_BASE_URL!)` if routes
// move behind a .NET service — no other file changes.
