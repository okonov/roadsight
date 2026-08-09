import { ResolvedPlace } from "@/lib/routes/types";

export interface Geocoder {
  /** Returns null when the query matches no place confidently enough to route to. */
  geocode(query: string): Promise<ResolvedPlace | null>;
}
