"use client";

import { useSyncExternalStore } from "react";

/** Camera frames change every ~15 minutes, so a minute's granularity is as fine as it needs. */
const TICK_MS = 60_000;

let now = Date.now();
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  // First subscriber on this page resets the clock: the module may have been loaded long
  // before, on an earlier client-side navigation.
  if (listeners.size === 0) now = Date.now();
  listeners.add(onChange);

  timer ??= setInterval(() => {
    now = Date.now();
    for (const listener of listeners) listener();
  }, TICK_MS);

  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/**
 * The current time on the *client*, or null while rendering on the server.
 *
 * Relative timestamps cannot be rendered on the server: it would bake its own clock into HTML
 * that the browser then hydrates against a different one. Returning null until mounted lets a
 * caller render nothing for that first pass and the real age immediately after.
 *
 * One interval is shared by every caller, so a page of forty cameras keeps one timer rather
 * than forty, and they all agree on what "now" means.
 */
export function useNow(): number | null {
  return useSyncExternalStore(
    subscribe,
    () => now,
    () => null,
  );
}
