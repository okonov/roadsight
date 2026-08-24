import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { signInWithMicrosoft } from "@/lib/sign-in";

export default async function Home() {
  const session = await auth();
  if (session?.user) {
    redirect("/routes");
  }

  return (
    <div className="mx-auto mt-24 max-w-xl px-4 text-center">
      <h1 className="text-3xl font-semibold">RoadSight</h1>
      <p className="mt-4 text-foreground/60">
        Create named routes and, soon, check traffic camera images along the way.
      </p>
      <div className="mt-8 flex justify-center">
        <form action={signInWithMicrosoft.bind(null, "/routes")}>
          <button type="submit" className="rounded bg-foreground px-4 py-2 text-background">
            Sign in with Microsoft
          </button>
        </form>
      </div>
    </div>
  );
}
