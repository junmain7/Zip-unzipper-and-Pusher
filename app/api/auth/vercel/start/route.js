import { NextResponse } from "next/server";

// GET /api/auth/vercel/start
// Kicks off the Vercel Integration OAuth install flow in a popup window.
// Requires a Vercel Integration created in the Integrations Console with:
//   - Redirect URL = https://<your-domain>/api/auth/vercel/callback
//   - Scopes: Project (Read/Write) + Environment Variables (Read/Write)
export async function GET() {
  const slug = process.env.VERCEL_INTEGRATION_SLUG;
  if (!slug) {
    return new NextResponse("VERCEL_INTEGRATION_SLUG env var missing", { status: 500 });
  }

  // Vercel's install flow doesn't accept a custom redirect_uri query param —
  // the redirect URL is fixed in the Integration's console settings. We still
  // set a short-lived marker cookie so the popup<->opener handshake stays sane.
  const state = crypto.randomUUID();
  const installUrl = `https://vercel.com/integrations/${slug}/new`;

  const res = NextResponse.redirect(installUrl);
  res.cookies.set("vercel_connect_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 60 * 10,
    path: "/",
  });
  return res;
}
