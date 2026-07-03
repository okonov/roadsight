import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { routeRepository } from "@/lib/routes/repository";
import { RouteList } from "./route-list";

export default async function RoutesPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/sign-in");
  }

  const routes = await routeRepository.list(session.user.id);

  return (
    <div className="mx-auto mt-12 max-w-2xl px-4">
      <h1 className="text-2xl font-semibold">Your routes</h1>
      <p className="mt-1 text-sm text-foreground/60">Signed in as {session.user.email}</p>
      <div className="mt-8">
        <RouteList initialRoutes={routes} />
      </div>
    </div>
  );
}
