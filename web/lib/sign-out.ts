"use server";

import { redirect } from "next/navigation";
import { signOut } from "@/auth";

// Auth.js `signOut` only drops our own session cookie — the Entra session on
// *.ciamlogin.com survives it, so the next sign-in is granted silently and the user
// appears never to have signed out. A real sign-out has to end both, which means
// handing the browser to the CIAM end_session endpoint afterwards.
export async function federatedSignOut() {
  await signOut({ redirect: false });

  const issuer = process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER;
  const appUrl = process.env.NEXTAUTH_URL;
  if (!issuer || !appUrl) {
    throw new Error("AUTH_MICROSOFT_ENTRA_ID_ISSUER and NEXTAUTH_URL are required to sign out");
  }

  // The issuer is the …/v2.0 authority; the logout endpoint hangs off the authority root.
  const logoutUrl = new URL(`${issuer.replace(/\/v2\.0\/?$/, "")}/oauth2/v2.0/logout`);
  // Entra validates this against the app registration's redirect URI list (there is no
  // separate post-logout list) and strands the user on its own generic signed-out page if
  // it doesn't match exactly — trailing slash included.
  logoutUrl.searchParams.set("post_logout_redirect_uri", new URL("/", appUrl).toString());

  redirect(logoutUrl.toString());
}
