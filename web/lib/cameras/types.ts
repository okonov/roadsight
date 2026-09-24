import { GeoPoint } from "@/lib/routes/types";

/** Where a camera's metadata and picture come from. */
export type CameraSourceName = "drivebc" | "vancouver";

/**
 * One traffic camera, in this app's shape rather than any upstream's.
 *
 * DriveBC's record carries ~38 fields, most of them about weather stations and their own map's
 * grouping; the City of Vancouver publishes no record at all, only pages to crawl. Mapping both
 * to a narrow type here means a change to either cannot reach the UI. The shape is DriveBC's in
 * spirit — fields with no meaning for a City camera are empty strings, which the card hides.
 */
export interface Camera {
  /**
   * Source-prefixed and unique across sources — "drivebc:123", "vancouver:45". Both upstreams
   * number from 1, and this is a React key.
   */
  id: string;
  source: CameraSourceName;
  /**
   * The upstream's own handle for the picture: DriveBC's numeric id as a string, or the City's
   * image path ("cameraimages/Boundary1stSNorth.jpg"). Only `image-url.ts` reads it.
   */
  sourceKey: string;
  /** "Coquihalla Great Bear Snowshed - N" */
  name: string;
  /** "Highway 5 at the Great Bear Snowshed, looking north." */
  caption: string;
  /** Highway number as published, e.g. "5". Not always numeric. */
  highway: string;
  highwayDescription: string;
  regionName: string;
  /**
   * Which way the camera looks. Compass letters for DriveBC ("NW"); the City's label as
   * published for Vancouver ("North", "South Main", "West exit"). Displayed for context; never
   * used to filter.
   */
  orientation: string;
  /**
   * The site this camera belongs to. DriveBC mounts up to four cameras on one interchange —
   * "Capilano - N/E/S/W" are four ids sharing one group — and 895 of 1062 cameras are in a
   * group with at least one sibling. Matching by proximity alone therefore returns the same
   * junction several times over, so selection spreads across groups before it takes a second
   * angle of any one of them. For Vancouver, the intersection. Source-prefixed like `id`.
   */
  group: string;
  location: GeoPoint;
  /**
   * False means the camera is dark. Always true for Vancouver, which publishes no liveness at
   * all (docs/add-trafficcams-vancouver.md §5). DriveBC still answers its image URL with **200 and a
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
  /**
   * Attribution. Usually empty for DriveBC, in which case `dbcMark` is what gets displayed;
   * "City of Vancouver" for the City's cameras.
   */
  credit: string;
  /** "DriveBC.ca"; empty for Vancouver. */
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
  /** When the list was fetched, or generated for the snapshot. Oldest member's, if composite. */
  fetchedAt: string;
  /**
   * Where this list came from. The UI says so when it is serving a snapshot, because a stale
   * camera *list* is worth disclosing even though the images themselves are still live.
   */
  origin: "live" | "snapshot";
}
