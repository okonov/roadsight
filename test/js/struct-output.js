import OpenAI from "openai";
import { fileURLToPath } from "node:url";
import path from "node:path";

process.loadEnvFile(path.join(path.dirname(fileURLToPath(import.meta.url)), ".env"));

const endpoint = "https://roadsight-foundry.services.ai.azure.com/openai/v1";
const deploymentName = "gpt-oss-120b";
// const deploymentName = "gpt-4o-mini";
const apiKey = process.env.AZURE_FOUNDRY_API_KEY;

const systemPrompt =
  "You are a route-parsing assistant for a road-trip planning app limited to the province of " +
  "British Columbia, with possible extension to Washington State. Given a casual, possibly vague " +
  "natural-language route description, resolve the origin and destination to the most specific " +
  "real-world place name you can infer (landmark, city, or neighborhood). Never merge origin and " +
  "destination into one field, and never invent a destination that is not implied by the input.";

const responseFormat = {
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

const testCases = [
  { name: "clearLandmarks", content: "Lougheed Mall to Squamish waterfall" },
  { name: "vagueNoConnector", content: "heading out from downtown Vancouver up toward the mountains near Whistler" },
  { name: "ambiguousSingleLocation", content: "just want to drive around Squamish for a bit" },
];

const openai = new OpenAI({
  baseURL: endpoint,
  apiKey: apiKey,
});

async function extractRouteEndpoints(content) {
  const completion = await openai.chat.completions.create({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content },
    ],
    model: deploymentName,
    response_format: responseFormat,
    store: true,
  });

  return completion.choices[0].message.content;
}

async function main() {
  for (const { name, content } of testCases) {
    const result = await extractRouteEndpoints(content);
    console.log(`\n[${name}] "${content}"`);
    console.log(result);
  }
}

main();
