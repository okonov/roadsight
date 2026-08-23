import NextAuth from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";

// Sign-in goes through the "roadsight" app registration in Microsoft Entra External ID.
// The tenant is a CIAM tenant, so the issuer must be the *.ciamlogin.com authority, not
// login.microsoftonline.com: customer (local) accounts exist only at the CIAM endpoint and
// get AADSTS500208 anywhere else. Use the tenant-GUID subdomain form specifically — the
// friendly <name>.ciamlogin.com host serves a discovery document whose `issuer` is the GUID
// form, and the OAuth client rejects that mismatch.
export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    MicrosoftEntraID({
      clientId: process.env.AUTH_MICROSOFT_ENTRA_ID_ID,
      clientSecret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET,
      issuer: process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER,
      // The provider defaults also ask for User.Read and spend a Microsoft Graph call per
      // sign-in fetching an avatar we never render. The ID token alone has all we need —
      // and Graph scopes aren't issued to CIAM tenants anyway, so asking would fail.
      authorization: { params: { scope: "openid profile email" } },
      profile: (profile) => ({
        // Note this `id` does NOT become session.user.id — Auth.js overwrites that with a
        // random UUID and keeps this value as account.providerAccountId. The id the app
        // actually stores is derived from the ID token claims in the jwt callback below.
        id: profile.oid,
        name: profile.name,
        // `email` is only present when the tenant emits it as an optional claim; upn /
        // preferred_username is always there for members.
        email: profile.email ?? profile.preferred_username,
      }),
    }),
  ],
  session: { strategy: "jwt" },
  // Errors land back on our own page (as ?error=<code>) instead of the Auth.js default.
  pages: { signIn: "/sign-in", error: "/sign-in" },
  trustHost: true,
  callbacks: {
    jwt({ token, profile }) {
      // `profile` is only populated on the sign-in call; later calls just carry the token
      // forward. Deliberately NOT using `user.id`: for OAuth providers Auth.js replaces it
      // with a fresh crypto.randomUUID() on every sign-in, so the same person would get a
      // new user_id each time and lose every route they had already created.
      if (profile) {
        // oid is the immutable per-tenant object id. sub is a per-application pairwise id
        // and is guaranteed present in any OIDC token, so it is a safe last resort.
        const id = profile.oid ?? profile.sub;
        if (typeof id !== "string") {
          throw new Error("Entra ID token carried neither an 'oid' nor a 'sub' claim");
        }
        token.id = id;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },
});
