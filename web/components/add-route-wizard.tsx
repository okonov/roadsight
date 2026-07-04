"use client";

import { useEffect, useState } from "react";
import { Route } from "@/lib/routes/types";

interface AddRouteWizardProps {
  /** Existing draft/resolved route to resume; null starts a fresh describe step. */
  initialRoute?: Route | null;
  /** Called whenever the route changes on the server (created, resolved, confirmed). */
  onRouteChanged: (route: Route) => void;
  onRouteDeleted: (id: string) => void;
  /** Called when the wizard finishes (confirmed + reset) or the draft is discarded. */
  onFinished?: () => void;
}

type WizardState =
  | { step: "describe"; route: Route | null }
  | { step: "resolving" }
  | { step: "review"; route: Route }
  | { step: "confirming"; route: Route }
  | { step: "done"; route: Route }
  | { step: "error"; route: Route | null; message: string; retry: "reword" | "confirm" | null };

function initialState(route: Route | null | undefined): WizardState {
  if (route?.status === "resolved") return { step: "review", route };
  if (route) return { step: "describe", route };
  return { step: "describe", route: null };
}

export function AddRouteWizard({
  initialRoute,
  onRouteChanged,
  onRouteDeleted,
  onFinished,
}: AddRouteWizardProps) {
  const [state, setState] = useState<WizardState>(() => initialState(initialRoute));
  const [description, setDescription] = useState(initialRoute?.description ?? "");

  useEffect(() => {
    if (state.step !== "done") return;
    const timer = setTimeout(() => {
      setState({ step: "describe", route: null });
      setDescription("");
      onFinished?.();
    }, 1600);
    return () => clearTimeout(timer);
  }, [state.step, onFinished]);

  async function resolveRoute(route: Route) {
    setState({ step: "resolving" });
    try {
      const res = await fetch(`/api/routes/${route.id}/resolve`, { method: "POST" });
      if (res.status === 422) {
        setState({
          step: "error",
          route,
          message: "Couldn't identify origin and destination — try rewording.",
          retry: "reword",
        });
        return;
      }
      if (!res.ok) throw new Error();
      const resolved: Route = await res.json();
      onRouteChanged(resolved);
      setState({ step: "review", route: resolved });
    } catch {
      setState({
        step: "error",
        route,
        message: "Something went wrong while resolving. Try again.",
        retry: "reword",
      });
    }
  }

  async function handleDescribeSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = description.trim();
    if (!text) return;
    const existing = state.step === "describe" ? state.route : null;

    setState({ step: "resolving" });
    try {
      let route: Route;
      if (existing) {
        if (text === existing.description) {
          route = existing;
        } else {
          const res = await fetch(`/api/routes/${existing.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ description: text }),
          });
          if (!res.ok) throw new Error();
          route = await res.json();
        }
      } else {
        const res = await fetch("/api/routes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ description: text }),
        });
        if (!res.ok) throw new Error();
        route = await res.json();
      }
      onRouteChanged(route);
      await resolveRoute(route);
    } catch {
      setState({
        step: "error",
        route: existing,
        message: "Something went wrong. Try again.",
        retry: null,
      });
    }
  }

  async function handleConfirm(route: Route) {
    setState({ step: "confirming", route });
    try {
      const res = await fetch(`/api/routes/${route.id}/confirm`, { method: "POST" });
      if (res.status === 502) {
        setState({
          step: "error",
          route,
          message: "Route service unavailable.",
          retry: "confirm",
        });
        return;
      }
      if (!res.ok) throw new Error();
      const confirmed: Route = await res.json();
      onRouteChanged(confirmed);
      setState({ step: "done", route: confirmed });
    } catch {
      setState({
        step: "error",
        route,
        message: "Something went wrong while fetching the route. Try again.",
        retry: "confirm",
      });
    }
  }

  async function handleDiscard(route: Route) {
    const res = await fetch(`/api/routes/${route.id}`, { method: "DELETE" });
    if (res.ok || res.status === 404) {
      onRouteDeleted(route.id);
      setState({ step: "describe", route: null });
      setDescription("");
      onFinished?.();
    }
  }

  function backToDescribe(route: Route | null) {
    setDescription(route?.description ?? description);
    setState({ step: "describe", route });
  }

  if (state.step === "describe") {
    return (
      <form onSubmit={handleDescribeSubmit} className="flex flex-col gap-2">
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g. 'Lougheed Mall to Squamish waterfall'"
          required
          maxLength={200}
          rows={2}
          className="rounded border border-foreground/20 bg-foreground/5 px-3 py-2 text-sm text-foreground placeholder:text-foreground/40"
        />
        <div className="flex items-center gap-3">
          <button
            type="submit"
            className="rounded bg-foreground px-3 py-2 text-sm text-background disabled:opacity-50"
          >
            {state.route ? "Update & resolve" : "Add route"}
          </button>
          {state.route && (
            <button type="button" onClick={() => handleDiscard(state.route!)} className="text-sm underline">
              Discard draft
            </button>
          )}
        </div>
      </form>
    );
  }

  if (state.step === "resolving" || state.step === "confirming") {
    return (
      <p className="text-sm text-foreground/60">
        {state.step === "resolving" ? "Resolving…" : "Fetching route…"}
      </p>
    );
  }

  if (state.step === "review") {
    const { route } = state;
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-foreground/60">
          Check the resolved origin and destination, then confirm:
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          {[
            { title: "Origin", place: route.origin },
            { title: "Destination", place: route.destination },
          ].map(({ title, place }) => (
            <div key={title} className="flex-1 rounded border border-foreground/10 px-3 py-2">
              <div className="text-xs font-medium uppercase text-foreground/50">{title}</div>
              <div className="text-sm">{place?.label}</div>
              <div className="text-xs text-foreground/50">
                {place && `${place.lat.toFixed(4)}, ${place.lng.toFixed(4)}`}
              </div>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => handleConfirm(route)}
            className="rounded bg-foreground px-3 py-2 text-sm text-background"
          >
            Confirm route
          </button>
          <button type="button" onClick={() => backToDescribe(route)} className="text-sm underline">
            Edit description
          </button>
          <button type="button" onClick={() => handleDiscard(route)} className="text-sm underline">
            Discard
          </button>
        </div>
      </div>
    );
  }

  if (state.step === "done") {
    return (
      <p className="text-sm text-green-600">
        Route saved: {state.route.name}
      </p>
    );
  }

  // error
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-red-600">{state.message}</p>
      <div className="flex items-center gap-3">
        {state.retry === "confirm" && state.route && (
          <>
            <button
              type="button"
              onClick={() => handleConfirm(state.route!)}
              className="rounded bg-foreground px-3 py-2 text-sm text-background"
            >
              Retry
            </button>
            <button
              type="button"
              onClick={() => setState({ step: "review", route: state.route! })}
              className="text-sm underline"
            >
              Back
            </button>
          </>
        )}
        {state.retry !== "confirm" && (
          <button type="button" onClick={() => backToDescribe(state.route)} className="text-sm underline">
            Edit description
          </button>
        )}
        {state.retry !== "confirm" && state.route && (
          <button type="button" onClick={() => handleDiscard(state.route!)} className="text-sm underline">
            Discard
          </button>
        )}
      </div>
    </div>
  );
}
