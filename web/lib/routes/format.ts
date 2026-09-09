import { RouteStatus } from "./types";

/** Badge styling per status, shared so the list and the detail page cannot drift apart. */
export const statusStyles: Record<RouteStatus, string> = {
  draft: "border-foreground/20 text-foreground/50",
  resolved: "border-amber-600/40 text-amber-600",
  confirmed: "border-green-600/40 text-green-600",
};

export function formatDistance(meters: number): string {
  return `${(meters / 1000).toFixed(1)} km`;
}

export function formatDuration(seconds: number): string {
  const totalMinutes = Math.round(seconds / 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}
