"use client";

import { useState } from "react";

interface RouteFormProps {
  initialName?: string;
  submitLabel: string;
  onSubmit: (name: string) => Promise<void>;
  onCancel?: () => void;
}

export function RouteForm({ initialName = "", submitLabel, onSubmit, onCancel }: RouteFormProps) {
  const [name, setName] = useState(initialName);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(name.trim());
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2">
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Route name"
        required
        maxLength={100}
        className="rounded border border-black/20 px-3 py-2 text-sm"
      />
      <button
        type="submit"
        disabled={submitting}
        className="rounded bg-black px-3 py-2 text-sm text-white disabled:opacity-50"
      >
        {submitLabel}
      </button>
      {onCancel && (
        <button type="button" onClick={onCancel} className="text-sm underline">
          Cancel
        </button>
      )}
      {error && <span className="text-sm text-red-600">{error}</span>}
    </form>
  );
}
