"use server";

import { signIn } from "@/auth";

// Both entry points (the landing page CTA and /sign-in) hand off to Entra the same way;
// keeping the provider id and the default landing route in one place stops them drifting.
// Bind the destination at the call site — a form action is invoked with FormData, so this
// must never be passed to `action` unbound or the redirect target would be a FormData.
export async function signInWithMicrosoft(redirectTo: string | undefined) {
  await signIn("microsoft-entra-id", { redirectTo: redirectTo ?? "/routes" });
}
