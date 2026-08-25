import { RoutePlanner } from "./route-planner";
import { MockRoutePlanner } from "./mock-route-planner";
import { AzureMapsRoutePlanner } from "./azure-maps-route-planner";

// Dev-mode module reloads can otherwise reset this singleton mid-session; stash it on
// globalThis so `npm run dev` keeps one instance across Fast Refresh.
const globalForPlanner = globalThis as unknown as {
  routePlanner?: RoutePlanner;
};

// Same env-gated pattern as the resolver and repository swaps: without a key the mock keeps
// the whole flow demoable. Planning needs only the Maps key — a route confirmed on mock
// endpoints still gets a real road path, because the mock resolver's dictionary carries real
// coordinates.
function createRoutePlanner(): RoutePlanner {
  const mapsKey = process.env.AZURE_MAPS_KEY;
  return mapsKey ? new AzureMapsRoutePlanner(mapsKey) : new MockRoutePlanner();
}

export const routePlanner: RoutePlanner = globalForPlanner.routePlanner ?? createRoutePlanner();

if (process.env.NODE_ENV !== "production") {
  globalForPlanner.routePlanner = routePlanner;
}
