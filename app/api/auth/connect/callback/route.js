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
      payload.type === "gh-connect-success" ? "Connected! Closing…" : "Failed: " + (payload.message || "")
    )};
    setTimeout(() => window.close(), 600);
  `);
}

// GET /api/auth/connect/callback
// Exchanges the OAuth `code` for an access token, fetches the GitHub
// profile, then hands both back to the opener window via postMessage.
// NOTE: a GitHub OAuth App access token (unlike fine-grained PATs) does
// NOT expire by default — it stays valid until the user revokes app
// access, which is exactly the "permanent token" behaviour requested.
export async function GET(request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");
  const cookieState = request.cookies.get("gh_connect_state")?.value;

  if (errorParam) {
    return postAndClose({ type: "gh-connect-error", message: errorParam });
  }
  if (!code || !state || !cookieState || state !== cookieState) {
    return postAndClose({ type: "gh-connect-error", message: "Invalid state, try again" });
  }

  const clientId = process.env.GITHUB_CONNECT_ID;
  const clientSecret = process.env.GITHUB_CONNECT_SECRET;
  const redirectUri = `${url.origin}/api/auth/connect/callback`;

  try {
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
    });
    const tokenData = await tokenRes.json();

    if (!tokenData.access_token) {
      return postAndClose({ type: "gh-connect-error", message: tokenData.error_description || "Token exchange failed" });
    }

    const userRes = await fetch("https://api.github.com/user", {
      headers: { Authorization: `token ${tokenData.access_token}`, Accept: "application/vnd.github.v3+json" },
    });
    if (!userRes.ok) {
      return postAndClose({ type: "gh-connect-error", message: "Profile fetch failed" });
    }
    const user = await userRes.json();

    const res = postAndClose({
      type: "gh-connect-success",
      token: tokenData.access_token,
      login: user.login,
      name: user.name || user.login,
      avatar: user.avatar_url,
    });
    res.cookies.delete("gh_connect_state");
    return res;
  } catch (e) {
    return postAndClose({ type: "gh-connect-error", message: "Unexpected error" });
  }
}
