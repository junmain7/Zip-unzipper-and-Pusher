import { NextResponse } from "next/server";

function htmlResponse(scriptBody) {
  return new NextResponse(
    `<!DOCTYPE html><html><head><meta charset="utf-8" /></head><body style="background:#0d1117;color:#c9d1d9;font-family:monospace;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
      <div id="msg">Connecting…</div>
      <script>${scriptBody}</script>
    </body></html>`,
    { headers: { "Content-Type": "text/html" } }
  );
}

function postAndClose(payload) {
  return htmlResponse(`
    try {
      if (window.opener) {
        window.opener.postMessage(${JSON.stringify(payload)}, window.location.origin);
      }
    } catch (e) {}
    document.getElementById('msg').textContent = ${JSON.stringify(
      payload.type === "vercel-connect-success" ? "Connected! Closing…" : "Failed: " + (payload.message || "")
    )};
    setTimeout(() => window.close(), 600);
  `);
}

// GET /api/auth/vercel/callback
// Exchanges the install `code` for a long-lived access token, fetches the
// Vercel profile, then hands both back to the opener window via postMessage.
export async function GET(request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const teamId = url.searchParams.get("teamId") || null;
  const errorParam = url.searchParams.get("error");

  if (errorParam) {
    return postAndClose({ type: "vercel-connect-error", message: errorParam });
  }
  if (!code) {
    return postAndClose({ type: "vercel-connect-error", message: "Missing code, try again" });
  }

  const clientId = process.env.VERCEL_CONNECT_CLIENT_ID;
  const clientSecret = process.env.VERCEL_CONNECT_CLIENT_SECRET;
  const redirectUri = `${url.origin}/api/auth/vercel/callback`;

  try {
    const tokenRes = await fetch("https://api.vercel.com/v2/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
    });
    const tokenData = await tokenRes.json();

    if (!tokenData.access_token) {
      return postAndClose({ type: "vercel-connect-error", message: tokenData.error_description || tokenData.error || "Token exchange failed" });
    }

    const userRes = await fetch("https://api.vercel.com/v2/user", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    if (!userRes.ok) {
      return postAndClose({ type: "vercel-connect-error", message: "Profile fetch failed" });
    }
    const userData = await userRes.json();
    const user = userData.user || userData;

    const res = postAndClose({
      type: "vercel-connect-success",
      token: tokenData.access_token,
      teamId: tokenData.team_id || teamId,
      login: user.username || user.name || "vercel-user",
      name: user.name || user.username,
      avatar: user.avatar ? `https://vercel.com/api/www/avatar/${user.avatar}` : "",
    });
    res.cookies.delete("vercel_connect_state");
    return res;
  } catch (e) {
    return postAndClose({ type: "vercel-connect-error", message: "Unexpected error" });
  }
}
