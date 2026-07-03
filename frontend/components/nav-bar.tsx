"use client";

import Link from "next/link";
import { useSession, signOut } from "next-auth/react";

export function NavBar() {
  const { data: session, status } = useSession();

  return (
    <header className="flex items-center justify-between border-b border-black/10 px-6 py-4">
      <Link href="/" className="font-semibold">
        RoadSight
      </Link>
      <nav className="flex items-center gap-4 text-sm">
        {status === "authenticated" ? (
          <>
            <Link href="/routes" className="underline">
              My routes
            </Link>
            <span className="text-black/60">{session.user?.email}</span>
            <button type="button" onClick={() => signOut({ callbackUrl: "/" })} className="underline">
              Sign out
            </button>
          </>
        ) : (
          <>
            <Link href="/sign-in" className="underline">
              Sign in
            </Link>
            <Link href="/sign-up" className="underline">
              Sign up
            </Link>
          </>
        )}
      </nav>
    </header>
  );
}
