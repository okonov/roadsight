import { RoutePlanner } from "./route-planner";
import { MockRoutePlanner } from "./mock-route-planner";

// Dev-mode module reloads can otherwise reset this singleton mid-session; stash it on
// globalThis so `npm run dev` keeps one instance across Fast Refresh.
const globalForPlanner = globalThis as unknown as {
  routePlanner?: RoutePlanner;
};

export const routePlanner: RoutePlanner =
  globalForPlanner.routePlanner ?? new MockRoutePlanner();

if (process.env.NODE_ENV !== "production") {
  globalForPlanner.routePlanner = routePlanner;
}

// Later: swap to `new AzureMapsRoutePlanner(...)` — no other file changes.
