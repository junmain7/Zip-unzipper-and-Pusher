import { NextResponse } from "next/server";

// GET /api/auth/connect/start
// Kicks off a SEPARATE GitHub OAuth flow (independent of next-auth's main
// session) so the user can "connect" any number of GitHub accounts inside
// a popup window, without disturbing their existing logged-in session.
export async function GET(request) {
  const url = new URL(request.url);
  const origin = url.origin;

  const clientId = process.env.GITHUB_ID;
  if (!clientId) {
    return new NextResponse("GITHUB_ID env var missing", { status: 500 });
  }

  // Random state value to prevent CSRF — stored in a short-lived cookie
  // and re-checked in the callback route.
  const state = crypto.randomUUID();

  const redirectUri = `${origin}/api/auth/connect/callback`;
  const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("scope", "read:user repo");
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("allow_signup", "true");

  const res = NextResponse.redirect(authorizeUrl.toString());
  res.cookies.set("gh_connect_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 60 * 10, // 10 minutes
    path: "/",
  });
  return res;
}
