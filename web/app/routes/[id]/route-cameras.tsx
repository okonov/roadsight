import { camerasAlongRoute } from "@/lib/cameras/along-route";
import { cameraCatalogue } from "@/lib/cameras/catalogue";
import { CameraCatalogue } from "@/lib/cameras/types";
import { RoutePolyline } from "@/lib/routes/types";
import { CameraGrid } from "@/components/camera-grid";

interface RouteCamerasProps {
  polyline: RoutePolyline;
}

/**
 * The cameras section, awaited separately from the rest of the page.
 *
 * Kept as its own async component so the page can wrap just this in `<Suspense>`: the route
 * header and its map paint immediately, and a slow or unreachable source costs the reader a
 * spinner in one panel rather than the whole page.
 *
 * Matching happens here rather than in the browser because the catalogue is a thousand cameras
 * and the answer is forty of them.
 */
export async function RouteCameras({ polyline }: RouteCamerasProps) {
  let catalogue: CameraCatalogue | null = null;
  try {
    catalogue = await cameraCatalogue.load();
  } catch (error) {
    // The source contracts not to throw, so this is belt-and-braces: a camera failure must
    // never be the reason a route page 500s.
    console.warn("Camera catalogue unavailable:", error);
  }

  const cameras = catalogue ? camerasAlongRoute(polyline, catalogue.cameras) : [];
  // Read once, here on the server, so the image URLs that depend on it are identical in the
  // server HTML and the hydrated client. The purity rule is aimed at components that re-render;
  // this is an async server component that renders once per request, so "impure" is the point.
  // eslint-disable-next-line react-hooks/purity
  const renderedAtMs = Date.now();
  return <CameraGrid cameras={cameras} catalogue={catalogue} renderedAtMs={renderedAtMs} />;
}
