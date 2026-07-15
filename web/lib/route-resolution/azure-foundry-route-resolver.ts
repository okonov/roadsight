import { z } from "zod";
import { ResolvedPlace } from "@/lib/routes/types";
import { ResolvedEndpoints, RouteResolver } from "./route-resolver";

const SYSTEM_PROMPT =
  "You are a route-parsing assistant for a road-trip planning app limited to the province of " +
  "British Columbia, with possible extension to Washington State. Given a casual, possibly vague " +
  "natural-language route description, resolve the origin and destination to the most specific " +
  "real-world place name you can infer (landmark, city, or neighborhood). Never merge origin and " +
  "destination into one field, and never invent a destination that is not implied by the input.";

const RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "route_endpoints",
    schema: {
      type: "object",
      properties: {
        origin: {
          type: "string",
          description: "Resolved name of the route's starting location",
        },
        destination: {
          type: "string",
          description: "Resolved name of the route's ending location",
        },
        confidence: {
          type: "string",
          enum: ["high", "medium", "low"],
          description: "Confidence that origin/destination were correctly separated from the input",
        },
      },
      required: ["origin", "destination", "confidence"],
      additionalProperties: false,
    },
    strict: true,
  },
};

const completionContentSchema = z.object({
  origin: z.string().trim().min(1),
  destination: z.string().trim().min(1),
  confidence: z.enum(["high", "medium", "low"]),
});

// TODO(Phase 3): geocode label -> real lat/lng via Azure Maps. Until then this
// is a placeholder so the resolved endpoints are still displayable/persistable.
function toResolvedPlace(label: string): ResolvedPlace {
  return { label, lat: 0, lng: 0 };
}

export class AzureFoundryRouteResolver implements RouteResolver {
  constructor(
    private readonly endpoint: string,
    private readonly apiKey: string,
    private readonly deploymentName: string,
  ) {}

  async resolve(description: string): Promise<ResolvedEndpoints | null> {
    const res = await fetch(`${this.endpoint}/openai/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: description },
        ],
        response_format: RESPONSE_FORMAT,
        model: this.deploymentName,
      }),
    });

    if (!res.ok) {
      throw new Error(`Azure Foundry request failed: ${res.status} ${await res.text()}`);
    }

    const completion = await res.json();
    const rawContent = completion.choices?.[0]?.message?.content;
    if (typeof rawContent !== "string") return null;

    let parsedContent: unknown;
    try {
      parsedContent = JSON.parse(rawContent);
    } catch {
      return null;
    }

    const parsed = completionContentSchema.safeParse(parsedContent);
    if (!parsed.success || parsed.data.confidence === "low") return null;

    return {
      origin: toResolvedPlace(parsed.data.origin),
      destination: toResolvedPlace(parsed.data.destination),
    };
  }
}
