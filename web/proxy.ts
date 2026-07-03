import { NextResponse } from "next/server";
import { auth } from "@/auth";

export default auth((req) => {
  if (!req.auth) {
    if (req.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const signInUrl = new URL("/sign-in", req.nextUrl.origin);
    return NextResponse.redirect(signInUrl);
  }
});

export const config = {
  matcher: ["/routes/:path*", "/api/routes/:path*"],
};
