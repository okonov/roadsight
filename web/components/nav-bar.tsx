"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { federatedSignOut } from "@/lib/sign-out";

export function NavBar() {
  const { data: session, status } = useSession();

  return (
    <header className="flex items-center justify-between border-b border-foreground/10 px-6 py-4">
      <Link href="/" className="font-semibold">
        RoadSight
      </Link>
      <nav className="flex items-center gap-4 text-sm">
        {status === "authenticated" ? (
          <>
            <Link href="/routes" className="underline">
              My routes
            </Link>
            <span className="text-foreground/60">{session.user?.email}</span>
            <form action={federatedSignOut}>
              <button type="submit" className="underline">
                Sign out
              </button>
            </form>
          </>
        ) : (
          <Link href="/sign-in" className="underline">
            Sign in
          </Link>
        )}
      </nav>
    </header>
  );
}
