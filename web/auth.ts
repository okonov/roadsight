import NextAuth from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";

// Sign-in goes through the "roadsight" app registration in Microsoft Entra ID. The
// registration is single-tenant ("My organization only"), so the issuer must name the
// directory (tenant) ID — the default /common/ issuer would let any Microsoft account in
// and then fail at the token exchange.
export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    MicrosoftEntraID({
      clientId: process.env.AUTH_MICROSOFT_ENTRA_ID_ID,
      clientSecret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET,
      issuer: process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER,
      // The provider defaults also ask for User.Read and spend a Microsoft Graph call per
      // sign-in fetching an avatar we never render. The ID token alone has all we need.
      authorization: { params: { scope: "openid profile email" } },
      profile: (profile) => ({
        // oid is the immutable per-tenant user id and is what routes.user_id stores. sub
        // (the provider default) is per-application, so it would break if the app ever
        // moved to a different registration.
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
    jwt({ token, user }) {
      if (user) token.id = user.id;
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
