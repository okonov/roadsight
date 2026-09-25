import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { auth } from "@/auth";
import { routeRepository } from "@/lib/routes/repository";
import { formatDistance, formatDuration, statusStyles } from "@/lib/routes/format";
import { CameraGridSkeleton } from "@/components/camera-grid";
import { RouteMap } from "@/components/route-map";
import { RouteCameras } from "./route-cameras";

type RouteParams = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: RouteParams) {
  const session = await auth();
  if (!session?.user) return { title: "Route" };

  const { id } = await params;
  const route = await routeRepository.get(session.user.id, id);
  return { title: route ? `${route.name} · RoadSight` : "Route" };
}

export default async function RouteDetailPage({ params }: RouteParams) {
  const session = await auth();
  if (!session?.user) {
    redirect("/sign-in");
  }

  const { id } = await params;
  const route = await routeRepository.get(session.user.id, id);
  // Every repository call is scoped to the signed-in user, so someone else's route id is
  // indistinguishable from one that does not exist — which is the right thing to disclose.
  if (!route) notFound();

  return (
    <div className="mx-auto mt-12 max-w-4xl px-4">
      <Link href="/routes" className="text-sm text-foreground/60 underline">
        ← Back to routes
      </Link>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{route.name}</h1>
        <span
          className={`rounded border px-1.5 py-0.5 text-xs ${statusStyles[route.status]}`}
        >
          {route.status}
        </span>
      </div>

      {route.origin && route.destination && (
        <p className="mt-1 text-sm text-foreground/60">
          {route.origin.label} → {route.destination.label}
        </p>
      )}
      {route.distanceMeters !== null && route.durationSeconds !== null && (
        <p className="text-sm text-foreground/50">
          {formatDistance(route.distanceMeters)} · {formatDuration(route.durationSeconds)}
        </p>
      )}

      <div className="mt-6">
        <RouteMap route={route} />
      </div>

      <h2 className="mt-10 text-lg font-medium">Cameras along this route</h2>
      <div className="mt-3">
        {route.polyline ? (
          <Suspense fallback={<CameraGridSkeleton />}>
            <RouteCameras polyline={route.polyline} />
          </Suspense>
        ) : (
          // Reachable by URL or a stale bookmark: a draft or resolved route has endpoints but
          // no path yet, and there is nothing to hang cameras off.
          <p className="rounded border border-foreground/10 px-3 py-6 text-center text-sm text-foreground/50">
            Cameras appear once the route is confirmed.{" "}
            <Link href="/routes" className="underline">
              Back to routes
            </Link>
          </p>
        )}
      </div>

      {/*
        Two attributions, because two instruments apply. The camera *metadata* comes from the
        DriveBC HighwayCams dataset under the Open Government Licence – British Columbia, which
        requires the provider's own attribution statement (rendered per card from `credit` /
        `dbcMark`) and, where none is specified, the second sentence below **verbatim**, with a
        link to the licence. The pictures themselves are served by drivebc.ca under the
        province's site copyright, hence the first line naming the Province.
        See docs/route-cameras-design.md §9.1.

        The City of Vancouver's intersection cameras carry no licence of their own — the site
        points at the City's general Terms of Use — so the third line credits the City and
        links the site the pictures are hotlinked from (docs/add-trafficcams-vancouver.md
        §8.1). Shown unconditionally, like the DriveBC lines: the footer names the page's
        sources, not this route's.

        The City of Surrey's camera list is in its open-data catalogue, under the Open
        Government License – City of Surrey. The last line is that licence's own attribution
        statement, verbatim (its spelling, not ours), linked to the catalogue's licence page
        (docs/add-surrey-cameras.md §7, §9.1).
      */}
      <footer className="mt-10 text-xs text-foreground/40">
        <p>
          Camera images © Province of British Columbia, via{" "}
          <a href="https://www.drivebc.ca/" className="underline">
            DriveBC.ca
          </a>
          .
        </p>
        <p className="mt-1">
          Contains information licensed under the{" "}
          <a
            href="https://www2.gov.bc.ca/gov/content/data/policy-standards/data-policies/open-data/open-government-licence-bc"
            className="underline"
          >
            Open Government Licence – British Columbia
          </a>
          .
        </p>
        <p className="mt-1">
          Intersection camera images © City of Vancouver, via{" "}
          <a href="https://trafficcams.vancouver.ca/" className="underline">
            trafficcams.vancouver.ca
          </a>
          .
        </p>
        <p className="mt-1">
          Intersection camera images © City of Surrey. Contains information licensed under the{" "}
          <a
            href="https://opendata-surrey.hub.arcgis.com/pages/55089a19491a4fe59a41e059fd8af708"
            className="underline"
          >
            Open Government License – City of Surrey
          </a>
          .
        </p>
      </footer>
    </div>
  );
}
