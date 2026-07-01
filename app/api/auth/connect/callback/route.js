import { NextResponse } from "next/server";
import { adminDb } from "../../../../../lib/firebaseAdmin";

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

function invitePage(title, message, ok) {
  return new NextResponse(
    `<!DOCTYPE html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title></head>
    <body style="background:#0d1117;color:#c9d1d9;font-family:'JetBrains Mono','Fira Code',monospace;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;padding:20px;box-sizing:border-box;">
      <div style="text-align:center;max-width:340px;">
        <div style="font-size:40px;margin-bottom:12px;">${ok ? "✅" : "❌"}</div>
        <div style="font-size:15px;font-weight:700;color:${ok ? "#3fb950" : "#f85149"};margin-bottom:8px;">${title}</div>
        <div style="font-size:13px;color:#8b949e;line-height:1.5;">${message}</div>
      </div>
    </body></html>`,
    { headers: { "Content-Type": "text/html" } }
  );
}

// GET /api/auth/connect/callback
// Do flows isi ek registered redirect_uri se handle hote hain (GitHub OAuth
// Apps sirf ek hi callback URL allow karte hain):
//   1) Normal "Connect with GitHub" — popup window, khud ke account add karna
//      (gh_connect_state cookie se pehchana jaata hai) — postMessage se opener
//      ko wapas bhejta hai.
//   2) "Invite link" flow — kisi doosre insaan ka GitHub account is app ke
//      owner ke accounts list mein add karna (gh_invite_token/gh_invite_state
//      cookie se pehchana jaata hai) — full-page success/error dikhata hai,
//      koi opener nahi hota kyunki yeh alag device/browser se aaya hota hai.
export async function GET(request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");

  const inviteToken = request.cookies.get("gh_invite_token")?.value;
  const inviteState = request.cookies.get("gh_invite_state")?.value;
  const connectState = request.cookies.get("gh_connect_state")?.value;

  const isInviteFlow = Boolean(inviteToken && inviteState);

  // ── Error from GitHub (user ne cancel kiya) ──
  if (errorParam) {
    return isInviteFlow
      ? invitePage("Cancelled", "You cancelled GitHub authorization.", false)
      : postAndClose({ type: "gh-connect-error", message: errorParam });
  }

  const clientId = process.env.GITHUB_CONNECT_ID;
  const clientSecret = process.env.GITHUB_CONNECT_SECRET;
  const redirectUri = `${url.origin}/api/auth/connect/callback`;

  // ══════════════════ INVITE FLOW ══════════════════
  if (isInviteFlow) {
    if (!code || !state || state !== inviteState) {
      return invitePage("Invalid Link", "This link is invalid or expired.", false);
    }

    const inviteSnap = await adminDb.collection("invites").doc(inviteToken).get();
    if (!inviteSnap.exists) {
      return invitePage("Invalid Link", "This invite link is no longer valid.", false);
    }
    const invite = inviteSnap.data();
    if (invite.expiresAt !== null && (!invite.expiresAt || invite.expiresAt < Date.now())) {
      return invitePage("Link Expired", "This invite link has expired.", false);
    }
    const ownerUid = invite.ownerUid;
    if (!ownerUid) {
      return invitePage("Invalid Link", "Could not find the invite owner.", false);
    }

    try {
      const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri }),
      });
      const tokenData = await tokenRes.json();
      if (!tokenData.access_token) {
        return invitePage("Failed", "Authorization failed. Please try again.", false);
      }

      const userRes = await fetch("https://api.github.com/user", {
        headers: { Authorization: `token ${tokenData.access_token}`, Accept: "application/vnd.github.v3+json" },
      });
      if (!userRes.ok) {
        return invitePage("Failed", "Could not fetch GitHub profile.", false);
      }
      const ghUser = await userRes.json();

      const ownerRef = adminDb.collection("users").doc(ownerUid);
      const ownerSnap = await ownerRef.get();
      const existingAccounts = ownerSnap.exists ? (ownerSnap.data().accounts || []) : [];

      const existing = existingAccounts.find((a) => a.login === ghUser.login);
      let updatedAccounts;
      if (existing) {
        updatedAccounts = existingAccounts.map((a) =>
          a.login === ghUser.login
            ? { ...a, pat: tokenData.access_token, avatar: ghUser.avatar_url, viaInvite: true }
            : a
        );
      } else {
        updatedAccounts = [
          ...existingAccounts,
          {
            id: Math.random().toString(36).slice(2),
            label: ghUser.name || ghUser.login,
            login: ghUser.login,
            avatar: ghUser.avatar_url,
            pat: tokenData.access_token,
            viaInvite: true,
          },
        ];
      }

      const activeId = ownerSnap.exists ? ownerSnap.data().activeId || null : null;
      await ownerRef.set({ accounts: updatedAccounts, activeId, updatedAt: Date.now() }, { merge: true });

      // one-time use: connect hote hi invite link ko turant invalid kar do
      await adminDb.collection("invites").doc(inviteToken).delete().catch(() => {});
      const ownerInviteRef = adminDb.collection("userInvites").doc(ownerUid);
      const ownerInviteSnap = await ownerInviteRef.get();
      if (ownerInviteSnap.exists && ownerInviteSnap.data()?.token === inviteToken) {
        await ownerInviteRef.delete().catch(() => {});
      }

      const res = invitePage(
        "Connected!",
        `@${ghUser.login} is now connected. You can close this tab.`,
        true
      );
      res.cookies.delete("gh_invite_state");
      res.cookies.delete("gh_invite_token");
      return res;
    } catch (e) {
      return invitePage("Error", "Something went wrong. Please try again.", false);
    }
  }

  // ══════════════════ NORMAL CONNECT FLOW (popup) ══════════════════
  if (!code || !state || !connectState || state !== connectState) {
    return postAndClose({ type: "gh-connect-error", message: "Invalid state, try again" });
  }

  try {
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri }),
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
