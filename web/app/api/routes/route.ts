import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { routeRepository } from "@/lib/routes/repository";

const createRouteSchema = z.object({ description: z.string().trim().min(1).max(200) });

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const routes = await routeRepository.list(session.user.id);
  return NextResponse.json(routes);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = createRouteSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { description } = parsed.data;
  const route = await routeRepository.create(session.user.id, {
    name: description.slice(0, 100), // auto-derived; user renames later via PATCH
    description,
  });
  return NextResponse.json(route, { status: 201 });
}
