import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../lib/auth";
import { adminDb } from "../../../lib/firebaseAdmin";

// Vercel accounts ab per-GitHub-account key se save hote hain, taaki ek GitHub
// account switch karne par dusre GitHub account ka linked Vercel account na
// ud jaaye — har GitHub account apna alag Vercel connection yaad rakhta hai.
// "accountId" query/body param GitHub account ki id hai (AccountsTab wali).
// Agar abhi tak koi GitHub account select nahi hua, "_default" key use hoti hai.
const DEFAULT_KEY = "_default";
function keyFor(accountId) {
  return accountId ? String(accountId) : DEFAULT_KEY;
}

// GET /api/vercel-account?accountId=xxx — us GitHub account se linked Vercel account laata hai
export async function GET(request) {
  const session = await getServerSession(authOptions);
  if (!session?.uid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const accountId = url.searchParams.get("accountId");
  const key = keyFor(accountId);

  const snap = await adminDb.collection("users").doc(session.uid).get();
  if (!snap.exists) {
    return NextResponse.json({ vercelAccount: null });
  }
  const data = snap.data();
  const map = data.vercelAccounts || {};

  // Backward-compat: purane single vercelAccount ko default key ke roop mein use kar lo
  // agar naya map abhi khaali hai.
  if (!map[key] && key === DEFAULT_KEY && data.vercelAccount) {
    return NextResponse.json({ vercelAccount: data.vercelAccount });
  }

  return NextResponse.json({ vercelAccount: map[key] || null });
}

// POST /api/vercel-account — { accountId, vercelAccount } ko GitHub account ke against save karta hai
export async function POST(request) {
  const session = await getServerSession(authOptions);
  if (!session?.uid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const vercelAccount = body?.vercelAccount ?? null;
  const key = keyFor(body?.accountId);

  const userRef = adminDb.collection("users").doc(session.uid);
  await userRef.set(
    { vercelAccounts: { [key]: vercelAccount }, updatedAt: Date.now() },
    { merge: true }
  );

  return NextResponse.json({ ok: true });
}

// DELETE /api/vercel-account?accountId=xxx — sirf us GitHub account ka Vercel link hataata hai
export async function DELETE(request) {
  const session = await getServerSession(authOptions);
  if (!session?.uid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const accountId = url.searchParams.get("accountId");
  const key = keyFor(accountId);

  const userRef = adminDb.collection("users").doc(session.uid);
  await userRef.set(
    { vercelAccounts: { [key]: null }, updatedAt: Date.now() },
    { merge: true }
  );

  return NextResponse.json({ ok: true });
}
