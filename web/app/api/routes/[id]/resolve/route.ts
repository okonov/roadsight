import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { routeRepository } from "@/lib/routes/repository";
import { routeResolver } from "@/lib/route-resolution/resolver";

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
  if (route.status === "confirmed") {
    return NextResponse.json(
      { error: "Route is already confirmed" },
      { status: 409 },
    );
  }

  const endpoints = await routeResolver.resolve(route.description);
  if (!endpoints) {
    return NextResponse.json(
      { error: "Could not identify origin and destination from the description" },
      { status: 422 },
    );
  }

  const updated = await routeRepository.update(session.user.id, id, {
    origin: endpoints.origin,
    destination: endpoints.destination,
    status: "resolved",
  });
  if (!updated) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(updated);
}
