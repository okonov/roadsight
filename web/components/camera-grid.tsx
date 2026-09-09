import { CORRIDOR_METERS } from "@/lib/cameras/along-route";
import { CameraCatalogue, RouteCamera } from "@/lib/cameras/types";
import { CameraCard } from "./camera-card";

interface CameraGridProps {
  cameras: RouteCamera[];
  /** Null when DriveBC could not be reached at all and there was no snapshot to fall back on. */
  catalogue: CameraCatalogue | null;
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="rounded border border-foreground/10 px-3 py-6 text-center text-sm text-foreground/50">{children}</p>;
}

export function CameraGrid({ cameras, catalogue }: CameraGridProps) {
  if (!catalogue) {
    return <Note>Camera information is unavailable right now.</Note>;
  }

  const corridorKm = (CORRIDOR_METERS / 1000).toFixed(0);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-foreground/50">
        {cameras.length === 0
          ? `No DriveBC cameras within ${corridorKm} km of this route.`
          : `${cameras.length} ${cameras.length === 1 ? "camera" : "cameras"} within ${corridorKm} km, in travel order.`}
      </p>

      {catalogue.origin === "snapshot" && (
        <p className="rounded border border-amber-600/40 px-3 py-2 text-xs text-amber-600">
          DriveBC is unreachable, so this list was taken from a saved copy
          {` (${new Date(catalogue.fetchedAt).toLocaleDateString()})`}. Cameras added or removed
          since then are missing, but the pictures themselves still come straight from DriveBC.
        </p>
      )}

      {cameras.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {cameras.map((camera, index) => (
            <CameraCard key={camera.id} camera={camera} ordinal={index + 1} />
          ))}
        </ul>
      )}
    </div>
  );
}

/** Same box as a real card, so nothing shifts when the cameras arrive. */
export function CameraGridSkeleton() {
  return (
    <ul className="grid animate-pulse gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }, (_, i) => (
        <li key={i} className="overflow-hidden rounded border border-foreground/10">
          <div className="aspect-video bg-foreground/5" />
          <div className="flex flex-col gap-2 p-3">
            <div className="h-3 w-2/3 rounded bg-foreground/10" />
            <div className="h-3 w-full rounded bg-foreground/5" />
          </div>
        </li>
      ))}
    </ul>
  );
}
