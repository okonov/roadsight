import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createUser, findUser } from "@/lib/users/user-store";

const registerSchema = z.object({
  email: z.email().trim(),
  password: z.string().min(1).max(200),
  name: z.string().trim().max(100).optional(),
});

export async function POST(req: NextRequest) {
  const parsed = registerSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  if (findUser(parsed.data.email)) {
    return NextResponse.json({ error: "User already exists" }, { status: 409 });
  }

  const user = createUser(parsed.data);
  return NextResponse.json({ id: user.id, email: user.email, name: user.name }, { status: 201 });
}
