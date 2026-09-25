"use client";

import Image from "next/image";
import { useState } from "react";
import { cameraImageUrl } from "@/lib/cameras/image-url";
import { RouteCamera } from "@/lib/cameras/types";
import { useNow } from "./use-now";

/**
 * DriveBC and City of Surrey frames are 800x450; the City of Vancouver's are 720x480 (3:2).
 * Requesting a fixed 16:9 box and cropping to it keeps the grid from reflowing between them.
 */
const IMAGE_WIDTH = 480;
const IMAGE_HEIGHT = 270;

/** Past this multiple of a camera's own update period, its picture is called out as stale. */
const STALE_PERIOD_MULTIPLE = 2;

/** Fallback for a camera that never reports an update period; DriveBC's typical one is ~15 min. */
const DEFAULT_UPDATE_PERIOD_S = 15 * 60;

interface CameraCardProps {
  camera: RouteCamera;
  /** Position along the route, 1-based — the thing that makes this a drive rather than a gallery. */
  ordinal: number;
  /** Server render time, for the image URL; see `cameraImageUrl`. */
  renderedAtMs: number;
}

function formatAlong(meters: number): string {
  return `km ${(meters / 1000).toFixed(1)}`;
}

function formatOffset(meters: number): string {
  return meters < 250 ? "on route" : `${Math.round(meters / 10) * 10} m off route`;
}

function formatAge(updatedAtMs: number, nowMs: number): string {
  const minutes = Math.round((nowMs - updatedAtMs) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

export function CameraCard({ camera, ordinal, renderedAtMs }: CameraCardProps) {
  const [imageFailed, setImageFailed] = useState(false);

  // Null until mounted, so the age is only ever computed against the browser's clock. Also
  // ticks, which keeps "updated 4 min ago" honest on a page left open.
  const nowMs = useNow();

  const updatedAtMs = camera.lastUpdated ? Date.parse(camera.lastUpdated) : NaN;
  const hasTimestamp = !Number.isNaN(updatedAtMs);

  const ageSeconds = hasTimestamp && nowMs !== null ? (nowMs - updatedAtMs) / 1000 : null;
  const overdue =
    ageSeconds !== null &&
    ageSeconds >
      STALE_PERIOD_MULTIPLE * (camera.updatePeriodSeconds ?? DEFAULT_UPDATE_PERIOD_S);

  // DriveBC's own flags lag, so an overdue timestamp counts as stale too.
  const stale = camera.isStale || camera.isDelayed || overdue;

  // A dark camera still answers 200, with a black frame and a red bar — `onError` would never
  // fire for it. Not requesting the picture at all is the only way to avoid showing it.
  const showImage = camera.isOn && !imageFailed;

  return (
    <li className="flex flex-col overflow-hidden rounded border border-foreground/10">
      <div className="relative aspect-video bg-foreground/5">
        {showImage ? (
          <Image
            src={cameraImageUrl(camera, renderedAtMs)}
            alt={
              camera.caption ||
              (camera.orientation ? `${camera.name} - ${camera.orientation}` : camera.name)
            }
            width={IMAGE_WIDTH}
            height={IMAGE_HEIGHT}
            // Straight from the source. DriveBC sends `cache-control: no-cache` with an ETag and
            // answers conditional requests with a 304. Next's optimizer would cache the frame
            // for at least its 4-hour minimum with no way to invalidate it — four hours of a
            // picture that changes every five to fifteen minutes.
            unoptimized
            onError={() => setImageFailed(true)}
            className="h-full w-full object-cover"
          />
        ) : (
          <p className="flex h-full items-center justify-center text-xs text-foreground/40">
            {camera.isOn ? "Image unavailable" : "Camera offline"}
          </p>
        )}
        <span className="absolute left-0 top-0 rounded-br bg-background/85 px-1.5 py-0.5 text-xs tabular-nums text-foreground/70">
          {ordinal} · {formatAlong(camera.distanceAlongRouteMeters)}
        </span>
        {stale && camera.isOn && (
          <span className="absolute right-1 top-1 rounded border border-amber-600/40 bg-background/85 px-1.5 py-0.5 text-xs text-amber-600">
            {camera.isDelayed ? "Delayed" : "Stale"}
          </span>
        )}
      </div>

      <div className="flex grow flex-col gap-1 p-3">
        <p className="truncate text-sm font-medium" title={camera.name}>
          {camera.name}
        </p>
        {camera.caption && (
          <p className="line-clamp-2 text-xs text-foreground/60">{camera.caption}</p>
        )}

        <p className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 pt-1 text-xs text-foreground/50">
          {camera.highway && (
            <span className="rounded border border-foreground/15 px-1.5 py-0.5">
              Hwy {camera.highway}
            </span>
          )}
          {camera.orientation && <span>{camera.orientation}</span>}
          <span>{formatOffset(camera.distanceFromRouteMeters)}</span>
        </p>

        <p className="flex items-center justify-between gap-2 text-xs text-foreground/40">
          {/* `title` carries the absolute time; the relative one appears once the clock is the
              browser's. Rendering nothing beforehand avoids a hydration mismatch — and that
              goes for the title too: `toLocaleString` formats in the server's locale and time
              zone during SSR, and React does not patch a mismatched attribute afterwards. */}
          <span
            title={
              hasTimestamp && nowMs !== null ? new Date(updatedAtMs).toLocaleString() : undefined
            }
          >
            {hasTimestamp && nowMs !== null ? `updated ${formatAge(updatedAtMs, nowMs)}` : ""}
          </span>
          <span className="shrink-0">{camera.credit || camera.dbcMark}</span>
        </p>
      </div>
    </li>
  );
}
