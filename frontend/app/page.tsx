import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";

export default async function Home() {
  const session = await auth();
  if (session?.user) {
    redirect("/routes");
  }

  return (
    <div className="mx-auto mt-24 max-w-xl px-4 text-center">
      <h1 className="text-3xl font-semibold">RoadSight</h1>
      <p className="mt-4 text-black/60">
        Create named routes and, soon, check traffic camera images along the way.
      </p>
      <div className="mt-8 flex justify-center gap-4">
        <Link href="/sign-in" className="rounded bg-black px-4 py-2 text-white">
          Sign in
        </Link>
        <Link href="/sign-up" className="rounded border border-black/20 px-4 py-2">
          Sign up
        </Link>
      </div>
    </div>
  );
}
