"use client";

import { useCallback, useState } from "react";
import { Route, RouteStatus } from "@/lib/routes/types";
import { AddRouteWizard } from "@/components/add-route-wizard";
import { RouteForm } from "@/components/route-form";
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";
import { RouteMap } from "@/components/route-map";

interface RouteListProps {
  initialRoutes: Route[];
}

const statusStyles: Record<RouteStatus, string> = {
  draft: "border-foreground/20 text-foreground/50",
  resolved: "border-amber-600/40 text-amber-600",
  confirmed: "border-green-600/40 text-green-600",
};

function formatDistance(meters: number): string {
  return `${(meters / 1000).toFixed(1)} km`;
}

function formatDuration(seconds: number): string {
  const totalMinutes = Math.round(seconds / 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

export function RouteList({ initialRoutes }: RouteListProps) {
  const [routes, setRoutes] = useState<Route[]>(initialRoutes);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [resuming, setResuming] = useState<Route | null>(null);

  const upsertRoute = useCallback((route: Route) => {
    setRoutes((prev) =>
      prev.some((r) => r.id === route.id)
        ? prev.map((r) => (r.id === route.id ? route : r))
        : [...prev, route],
    );
  }, []);

  const removeRoute = useCallback((id: string) => {
    setRoutes((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const finishWizard = useCallback(() => {
    setResuming(null);
  }, []);

  async function handleRename(id: string, name: string) {
    const res = await fetch(`/api/routes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) throw new Error("Failed to update route");
    const updated: Route = await res.json();
    setRoutes((prev) => prev.map((r) => (r.id === id ? updated : r)));
    setEditingId(null);
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/routes/${id}`, { method: "DELETE" });
    if (!res.ok && res.status !== 204) throw new Error("Failed to delete route");
    removeRoute(id);
    if (resuming?.id === id) setResuming(null);
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="mb-2 text-sm font-medium text-foreground/60">Add a route</h2>
        <AddRouteWizard
          key={resuming?.id ?? "new"}
          initialRoute={resuming}
          onRouteChanged={upsertRoute}
          onRouteDeleted={removeRoute}
          onFinished={finishWizard}
        />
      </div>

      <ul className="flex flex-col gap-2">
        {routes.length === 0 && <li className="text-sm text-foreground/50">No routes yet.</li>}
        {routes.map((route) => (
          <li key={route.id} className="flex items-center justify-between gap-4 rounded border border-foreground/10 px-3 py-2">
            {editingId === route.id ? (
              <RouteForm
                initialName={route.name}
                submitLabel="Save"
                onSubmit={(name) => handleRename(route.id, name)}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <>
                {/* Nothing to draw until the route resolves, so drafts keep the plain row. */}
                <RouteMap route={route} size="thumbnail" className="w-24 shrink-0 sm:w-32" />
                <span className="flex min-w-0 grow flex-col">
                  <span className="flex items-center gap-2">
                    <span className="truncate">{route.name}</span>
                    <span
                      className={`shrink-0 rounded border px-1.5 py-0.5 text-xs ${statusStyles[route.status]}`}
                    >
                      {route.status}
                    </span>
                  </span>
                  {route.origin && route.destination && (
                    <span className="truncate text-xs text-foreground/60">
                      {route.origin.label} → {route.destination.label}
                    </span>
                  )}
                  {route.status === "confirmed" &&
                    route.distanceMeters !== null &&
                    route.durationSeconds !== null && (
                      <span className="text-xs text-foreground/50">
                        {formatDistance(route.distanceMeters)} · {formatDuration(route.durationSeconds)}
                      </span>
                    )}
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  {route.status !== "confirmed" && (
                    <button type="button" onClick={() => setResuming(route)} className="text-sm underline">
                      Resume
                    </button>
                  )}
                  <button type="button" onClick={() => setEditingId(route.id)} className="text-sm underline">
                    Rename
                  </button>
                  <ConfirmDeleteButton onConfirm={() => handleDelete(route.id)} />
                </span>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
