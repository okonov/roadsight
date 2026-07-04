import { ResolvedPlace } from "@/lib/routes/types";

export interface ResolvedEndpoints {
  origin: ResolvedPlace;
  destination: ResolvedPlace;
}

export interface RouteResolver {
  /** Returns null when the description cannot be resolved into two places. */
  resolve(description: string): Promise<ResolvedEndpoints | null>;
}
