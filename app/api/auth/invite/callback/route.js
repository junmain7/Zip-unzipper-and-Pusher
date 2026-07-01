import { NextResponse } from "next/server";
import { adminDb } from "../../../../../lib/firebaseAdmin";

function page(title, message, ok) {
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

// GET /api/auth/invite/callback
// GitHub se code exchange karke, invite token se owner dhoondh ke, us owner
// ke Firestore accounts array mein yeh naya GitHub account add karta hai.
export async function GET(request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");

  const cookieState = request.cookies.get("gh_invite_state")?.value;
  const inviteToken = request.cookies.get("gh_invite_token")?.value;

  if (errorParam) {
    return page("Cancelled", "Aapne GitHub authorization cancel kar diya.", false);
  }
  if (!code || !state || !cookieState || state !== cookieState || !inviteToken) {
    return page("Invalid Request", "Link expire ho gaya ya invalid hai. Naya invite link maango.", false);
  }

  // invite token verify karo
  const inviteSnap = await adminDb.collection("invites").doc(inviteToken).get();
  if (!inviteSnap.exists) {
    return page("Invalid Invite", "Yeh invite link valid nahi hai ya revoke ho chuka hai.", false);
  }
  const invite = inviteSnap.data();
  if (invite.expiresAt !== null && (!invite.expiresAt || invite.expiresAt < Date.now())) {
    return page("Link Expired", "Yeh invite link expire ho chuka hai. Naya link maango.", false);
  }
  const ownerUid = invite.ownerUid;
  if (!ownerUid) {
    return page("Invalid Invite", "Invite se owner nahi mila.", false);
  }

  const clientId = process.env.GITHUB_CONNECT_ID;
  const clientSecret = process.env.GITHUB_CONNECT_SECRET;
  const redirectUri = `${url.origin}/api/auth/invite/callback`;

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
      return page("Failed", tokenData.error_description || "Token exchange failed. Dobara try karo.", false);
    }

    const userRes = await fetch("https://api.github.com/user", {
      headers: { Authorization: `token ${tokenData.access_token}`, Accept: "application/vnd.github.v3+json" },
    });
    if (!userRes.ok) {
      return page("Failed", "GitHub profile fetch nahi ho paya.", false);
    }
    const ghUser = await userRes.json();

    // owner ke Firestore doc mein account upsert karo (read-modify-write)
    const ownerRef = adminDb.collection("users").doc(ownerUid);
    const ownerSnap = await ownerRef.get();
    const existingAccounts = ownerSnap.exists ? (ownerSnap.data().accounts || []) : [];

    // owner ne invite generate karte waqt jo timer chuna tha, wahi accessExpiresAt
    // ban ke account ke saath save hota hai — isse owner ko switch-accounts mein
    // countdown dikhta hai ki yeh access kab tak valid hai
    const accessExpiresAt = invite.expiresAt ?? null;

    const existing = existingAccounts.find((a) => a.login === ghUser.login);
    let updatedAccounts;
    if (existing) {
      updatedAccounts = existingAccounts.map((a) =>
        a.login === ghUser.login
          ? { ...a, pat: tokenData.access_token, avatar: ghUser.avatar_url, viaInvite: true, accessExpiresAt }
          : a
      );
    } else {
      const newAccount = {
        id: Math.random().toString(36).slice(2),
        label: ghUser.name || ghUser.login,
        login: ghUser.login,
        avatar: ghUser.avatar_url,
        pat: tokenData.access_token,
        viaInvite: true,
        accessExpiresAt,
      };
      updatedAccounts = [...existingAccounts, newAccount];
    }

    const activeId = ownerSnap.exists ? ownerSnap.data().activeId || null : null;
    await ownerRef.set(
      { accounts: updatedAccounts, activeId, updatedAt: Date.now() },
      { merge: true }
    );

    // one-time use: connect hote hi invite link ko turant invalid kar do
    await adminDb.collection("invites").doc(inviteToken).delete().catch(() => {});
    const ownerInviteRef = adminDb.collection("userInvites").doc(ownerUid);
    const ownerInviteSnap = await ownerInviteRef.get();
    if (ownerInviteSnap.exists && ownerInviteSnap.data()?.token === inviteToken) {
      await ownerInviteRef.delete().catch(() => {});
    }

    const res = page(
      "Connected!",
      `Aapka GitHub account (@${ghUser.login}) ${invite.ownerName || "owner"} ke app mein safaltapoorvak connect ho gaya hai. Ab aap yeh tab band kar sakte hain.`,
      true
    );
    res.cookies.delete("gh_invite_state");
    res.cookies.delete("gh_invite_token");
    return res;
  } catch (e) {
    return page("Error", "Kuch galat ho gaya. Dobara try karo.", false);
  }
}
