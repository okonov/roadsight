import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { routeRepository } from "@/lib/routes/repository";
import { routePlanner } from "@/lib/routing/planner";

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const route = await routeRepository.get(session.user.id, id);
  if (!route) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (route.status !== "resolved" || !route.origin || !route.destination) {
    return NextResponse.json(
      { error: "Route must be resolved before it can be confirmed" },
      { status: 409 },
    );
  }

  let plan;
  try {
    plan = await routePlanner.plan(route.origin, route.destination);
  } catch {
    plan = null;
  }
  if (!plan) {
    // Route stays resolved; the client can retry confirm.
    return NextResponse.json(
      { error: "Route planning service unavailable" },
      { status: 502 },
    );
  }

  const updated = await routeRepository.update(session.user.id, id, {
    polyline: plan.polyline,
    distanceMeters: plan.distanceMeters,
    durationSeconds: plan.durationSeconds,
    status: "confirmed",
  });
  if (!updated) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(updated);
}
