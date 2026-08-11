import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { routeRepository } from "@/lib/routes/repository";
import { RoutePatch } from "@/lib/routes/route-repository";

const patchRouteSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    description: z.string().trim().min(1).max(200).optional(),
  })
  .refine((data) => data.name !== undefined || data.description !== undefined, {
    message: "At least one of name or description is required",
  });

type RouteParams = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = patchRouteSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { id } = await params;
  const current = await routeRepository.get(session.user.id, id);
  if (!current) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const patch: RoutePatch = {};
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (
    parsed.data.description !== undefined &&
    parsed.data.description !== current.description
  ) {
    // Derived data must not survive a description change: reset to draft.
    patch.description = parsed.data.description;
    patch.status = "draft";
    patch.origin = null;
    patch.destination = null;
    patch.polyline = null;
    patch.distanceMeters = null;
    patch.durationSeconds = null;
    // Keep the auto-derived title in sync too, unless the user has since
    // renamed it explicitly (name no longer matches the auto-derived value).
    if (parsed.data.name === undefined && current.name === current.description.slice(0, 100)) {
      patch.name = parsed.data.description.slice(0, 100);
    }
  }

  const updated = await routeRepository.update(session.user.id, id, patch);
  if (!updated) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const removed = await routeRepository.remove(session.user.id, id);
  if (!removed) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return new NextResponse(null, { status: 204 });
}
