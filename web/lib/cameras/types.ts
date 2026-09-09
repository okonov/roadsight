import { GeoPoint } from "@/lib/routes/types";

/**
 * One DriveBC highway camera, in this app's shape rather than DriveBC's.
 *
 * The upstream record carries ~38 fields, most of them about weather stations and their own
 * map's grouping. Mapping to a narrow type here means a change to any of the rest cannot reach
 * the UI.
 */
export interface Camera {
  id: number;
  /** "Coquihalla Great Bear Snowshed - N" */
  name: string;
  /** "Highway 5 at the Great Bear Snowshed, looking north." */
  caption: string;
  /** Highway number as published, e.g. "5". Not always numeric. */
  highway: string;
  highwayDescription: string;
  regionName: string;
  /** Compass letters, e.g. "NW". Displayed for context; never used to filter. */
  orientation: string;
  /**
   * The site this camera belongs to. DriveBC mounts up to four cameras on one interchange —
   * "Capilano - N/E/S/W" are four ids sharing one group — and 895 of 1062 cameras are in a
   * group with at least one sibling. Matching by proximity alone therefore returns the same
   * junction several times over, so selection spreads across groups before it takes a second
   * angle of any one of them.
   */
  group: number;
  location: GeoPoint;
  /**
   * False means the camera is dark. DriveBC still answers its image URL with **200 and a
   * JPEG** — a black frame with a red bar — so this flag is the only way to know. Never infer
   * liveness from the image response.
   */
  isOn: boolean;
  isStale: boolean;
  isDelayed: boolean;
  /** ISO-8601 with offset, or null when DriveBC has never recorded an update. */
  lastUpdated: string | null;
  /** Typical seconds between new frames; ~928 in practice. */
  updatePeriodSeconds: number | null;
  /** Attribution. Usually empty, in which case `dbcMark` is what gets displayed. */
  credit: string;
  /** "DriveBC.ca" */
  dbcMark: string;
}

/** A camera matched to a route, with where it sits relative to that route. */
export interface RouteCamera extends Camera {
  /** Perpendicular metres from the route path; within the corridor by construction. */
  distanceFromRouteMeters: number;
  /** Metres travelled from the origin to the camera's closest point on the path. */
  distanceAlongRouteMeters: number;
}

export interface CameraCatalogue {
  cameras: Camera[];
  /** When the list was fetched from DriveBC, or generated for the snapshot. */
  fetchedAt: string;
  /**
   * Where this list came from. The UI says so when it is serving a snapshot, because a stale
   * camera *list* is worth disclosing even though the images themselves are still live.
   */
  origin: "live" | "snapshot";
}
