"use client";

import { useState } from "react";

interface ConfirmDeleteButtonProps {
  onConfirm: () => Promise<void>;
}

export function ConfirmDeleteButton({ onConfirm }: ConfirmDeleteButtonProps) {
  const [armed, setArmed] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (deleting) {
    return <span className="text-sm text-foreground/50">Deleting…</span>;
  }

  if (armed) {
    return (
      <span className="flex items-center gap-2 text-sm">
        <span>Delete this route?</span>
        <button
          type="button"
          onClick={async () => {
            setDeleting(true);
            await onConfirm();
          }}
          className="text-red-600 underline"
        >
          Confirm
        </button>
        <button type="button" onClick={() => setArmed(false)} className="underline">
          Cancel
        </button>
      </span>
    );
  }

  return (
    <button type="button" onClick={() => setArmed(true)} className="text-sm text-red-600 underline">
      Delete
    </button>
  );
}
