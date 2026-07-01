import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../lib/auth";
import { adminDb } from "../../../lib/firebaseAdmin";

// GET /api/agent — owner ke saare agent links list karta hai
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const snap = await adminDb.collection("agentLinks").where("ownerUid", "==", session.uid).get();
  const links = snap.docs.map((d) => ({ token: d.id, ...d.data() }));
  return NextResponse.json({ links });
}

// POST /api/agent — ek account+repo ke liye naya agent read-link banata hai
// body: { accountId, owner, repo }
export async function POST(request) {
  const session = await getServerSession(authOptions);
  if (!session?.uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const { accountId, owner, repo } = body || {};
  if (!accountId || !owner || !repo) {
    return NextResponse.json({ error: "accountId, owner, repo required" }, { status: 400 });
  }

  // account verify karo — owner ke paas yeh account hona chahiye
  const userSnap = await adminDb.collection("users").doc(session.uid).get();
  const acc = (userSnap.exists ? userSnap.data().accounts || [] : []).find((a) => a.id === accountId);
  if (!acc) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  const token = crypto.randomUUID().replace(/-/g, "");
  const createdAt = Date.now();
  await adminDb.collection("agentLinks").doc(token).set({
    ownerUid: session.uid,
    accountId,
    accountLabel: acc.label,
    owner,
    repo,
    createdAt,
  });

  return NextResponse.json({ link: { token, accountId, owner, repo, createdAt } });
}

// DELETE /api/agent — link revoke karta hai. body: { token }
export async function DELETE(request) {
  const session = await getServerSession(authOptions);
  if (!session?.uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const token = body?.token;
  if (!token) return NextResponse.json({ error: "token required" }, { status: 400 });

  const snap = await adminDb.collection("agentLinks").doc(token).get();
  if (snap.exists && snap.data()?.ownerUid === session.uid) {
    await adminDb.collection("agentLinks").doc(token).delete();
  }
  return NextResponse.json({ ok: true });
}
