export interface EndpointLabels {
  origin: string;
  destination: string;
}

export interface RouteDescriptionParser {
  /** Returns null when the description cannot be split into two named places. */
  parse(description: string): Promise<EndpointLabels | null>;
}
