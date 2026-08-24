import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { routeRepository } from "@/lib/routes/repository";
import { staticMapUrl } from "@/lib/maps/static-map";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * Static map of the route's endpoints, for the review step.
 *
 * Proxied rather than linked directly from the browser because the static image URL carries
 * the Azure Maps subscription key, which must never reach the client. Callers should append
 * a `?v=<updatedAt>` cache buster: the response is cached hard, and re-resolving a route
 * changes its endpoints without changing this URL.
 */
export async function GET(_req: NextRequest, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const route = await routeRepository.get(session.user.id, id);
  if (!route?.origin || !route.destination) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Absent in local setups running the mock resolver without an Azure Maps account. The
  // review step treats it like any other failure and hides the map rather than breaking.
  const mapsKey = process.env.AZURE_MAPS_KEY;
  if (!mapsKey) {
    return NextResponse.json({ error: "Map rendering not configured" }, { status: 404 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(staticMapUrl(route.origin, route.destination, mapsKey));
  } catch {
    return NextResponse.json({ error: "Map service unavailable" }, { status: 502 });
  }
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: "Map service unavailable" }, { status: 502 });
  }

  return new NextResponse(upstream.body, {
    headers: {
      "Content-Type": upstream.headers.get("Content-Type") ?? "image/png",
      // Deterministic for a given pair of endpoints, and user-scoped: never shared caches.
      "Cache-Control": "private, max-age=86400, immutable",
    },
  });
}
