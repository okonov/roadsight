import { signIn } from "@/auth";

// Auth.js bounces failed sign-ins back here with ?error=<code>. Only the codes a user can
// realistically hit get their own wording; everything else falls through to the generic one.
const ERROR_MESSAGES: Record<string, string> = {
  AccessDenied: "That account isn't allowed to use RoadSight.",
  Configuration: "Sign-in isn't configured correctly. Check the Entra ID settings.",
  Verification: "That sign-in link has expired. Try again.",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; callbackUrl?: string }>;
}) {
  const { error, callbackUrl } = await searchParams;

  return (
    <div className="mx-auto mt-16 max-w-sm px-4">
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <p className="mt-2 text-sm text-foreground/60">
        RoadSight uses your Microsoft work or school account.
      </p>
      {error && (
        <p className="mt-4 text-sm text-red-600">
          {ERROR_MESSAGES[error] ?? "Sign in failed. Please try again."}
        </p>
      )}
      <form
        action={async () => {
          "use server";
          await signIn("microsoft-entra-id", { redirectTo: callbackUrl ?? "/routes" });
        }}
        className="mt-6"
      >
        <button
          type="submit"
          className="w-full rounded bg-foreground px-4 py-2 text-background"
        >
          Sign in with Microsoft
        </button>
      </form>
    </div>
  );
}
