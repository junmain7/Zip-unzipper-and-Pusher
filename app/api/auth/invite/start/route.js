import { NextResponse } from "next/server";

// GET /api/auth/invite/start?token=xxx
// Invite link se aane wale visitor (jo logged in nahi hai) ko GitHub OAuth
// authorize page pe bhejta hai. Invite token ek cookie mein save hota hai
// taaki callback mein pata chale yeh kaunse invite se aaya tha.
export async function GET(request) {
  const url = new URL(request.url);
  const origin = url.origin;
  const token = url.searchParams.get("token");

  if (!token) {
    return new NextResponse("Invalid invite link", { status: 400 });
  }

  const clientId = process.env.GITHUB_CONNECT_ID;
  if (!clientId) {
    return new NextResponse("GITHUB_CONNECT_ID env var missing", { status: 500 });
  }

  const state = crypto.randomUUID();
  const redirectUri = `${origin}/api/auth/invite/callback`;

  const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("scope", "read:user repo");
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("allow_signup", "true");

  const res = NextResponse.redirect(authorizeUrl.toString());
  res.cookies.set("gh_invite_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 60 * 10,
    path: "/",
  });
  res.cookies.set("gh_invite_token", token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 60 * 10,
    path: "/",
  });
  return res;
}
