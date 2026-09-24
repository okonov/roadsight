"use client";

import { useState } from "react";
import { CORRIDOR_METERS } from "@/lib/cameras/along-route";
import { CameraCatalogue, RouteCamera } from "@/lib/cameras/types";
import { CameraCard } from "./camera-card";

interface CameraGridProps {
  /** Matched at the widest corridor choice; narrower choices below filter this in the browser. */
  cameras: RouteCamera[];
  /** Null when DriveBC could not be reached at all and there was no snapshot to fall back on. */
  catalogue: CameraCatalogue | null;
  /** Server render time, handed to every card for its image URL; see `cameraImageUrl`. */
  renderedAtMs: number;
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="rounded border border-foreground/10 px-3 py-6 text-center text-sm text-foreground/50">{children}</p>;
}

/**
 * Corridor widths the reader can narrow to without a refetch.
 *
 * `cameras` is always matched server-side at `CORRIDOR_METERS`, the widest choice here, so
 * picking a smaller one is a client-side filter over `distanceFromRouteMeters` rather than a
 * new request — every narrower choice is a subset of what already arrived.
 */
const CORRIDOR_CHOICES: number[] = [CORRIDOR_METERS, 500, 200];

function formatCorridor(meters: number): string {
  return meters % 1000 === 0 ? `${meters / 1000} km` : `${meters} m`;
}

export function CameraGrid({ cameras, catalogue, renderedAtMs }: CameraGridProps) {
  const [corridorMeters, setCorridorMeters] = useState<number>(CORRIDOR_METERS);

  if (!catalogue) {
    return <Note>Camera information is unavailable right now.</Note>;
  }

  const filtered = cameras.filter((camera) => camera.distanceFromRouteMeters <= corridorMeters);

  return (
    <div className="flex flex-col gap-3">
      <p className="flex flex-wrap items-center gap-x-1 text-sm text-foreground/50">
        <span>
          {filtered.length === 0
            ? "No cameras within"
            : `${filtered.length} ${filtered.length === 1 ? "camera" : "cameras"} within`}
        </span>
        <select
          value={corridorMeters}
          onChange={(event) => setCorridorMeters(Number(event.target.value))}
          aria-label="Camera search corridor width"
          // Explicit background/text colors, not the translucent `text-foreground/50` the rest
          // of this line uses: the dropdown's option list renders with OS chrome outside our
          // dark-mode CSS, so a translucent color that reads fine on the page background goes
          // near-invisible on the popup's own background. `var(--background)` /
          // `var(--foreground)` are opaque and already flip with the same media query, so the
          // popup stays legible in both themes.
          className="rounded border border-foreground/20 px-1 text-sm"
          style={{ backgroundColor: "var(--background)", color: "var(--foreground)" }}
        >
          {CORRIDOR_CHOICES.map((meters) => (
            <option
              key={meters}
              value={meters}
              style={{ backgroundColor: "var(--background)", color: "var(--foreground)" }}
            >
              {formatCorridor(meters)}
            </option>
          ))}
        </select>
        <span>{filtered.length === 0 ? "of this route." : ", in travel order."}</span>
      </p>

      {catalogue.origin === "snapshot" && (
        <p className="rounded border border-amber-600/40 px-3 py-2 text-xs text-amber-600">
          DriveBC is unreachable, so its cameras were taken from a saved copy
          {` (${new Date(catalogue.fetchedAt).toLocaleDateString()})`}. Cameras added or removed
          since then are missing, but the pictures themselves still come straight from DriveBC.
        </p>
      )}

      {filtered.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((camera, index) => (
            <CameraCard
              key={camera.id}
              camera={camera}
              ordinal={index + 1}
              renderedAtMs={renderedAtMs}
            />
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
