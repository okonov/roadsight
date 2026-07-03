"use client";

import { useState } from "react";
import { Route } from "@/lib/routes/types";
import { RouteForm } from "@/components/route-form";
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";

interface RouteListProps {
  initialRoutes: Route[];
}

export function RouteList({ initialRoutes }: RouteListProps) {
  const [routes, setRoutes] = useState<Route[]>(initialRoutes);
  const [editingId, setEditingId] = useState<string | null>(null);

  async function handleCreate(name: string) {
    const res = await fetch("/api/routes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) throw new Error("Failed to create route");
    const created: Route = await res.json();
    setRoutes((prev) => [...prev, created]);
  }

  async function handleUpdate(id: string, name: string) {
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
    setRoutes((prev) => prev.filter((r) => r.id !== id));
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="mb-2 text-sm font-medium text-foreground/60">Add a route</h2>
        <RouteForm submitLabel="Add" onSubmit={handleCreate} />
      </div>

      <ul className="flex flex-col gap-2">
        {routes.length === 0 && <li className="text-sm text-foreground/50">No routes yet.</li>}
        {routes.map((route) => (
          <li key={route.id} className="flex items-center justify-between gap-4 rounded border border-foreground/10 px-3 py-2">
            {editingId === route.id ? (
              <RouteForm
                initialName={route.name}
                submitLabel="Save"
                onSubmit={(name) => handleUpdate(route.id, name)}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <>
                <span>{route.name}</span>
                <span className="flex items-center gap-3">
                  <button type="button" onClick={() => setEditingId(route.id)} className="text-sm underline">
                    Edit
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
