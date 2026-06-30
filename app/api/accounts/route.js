import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../lib/auth";
import { adminDb } from "../../../lib/firebaseAdmin";

// GET /api/accounts — logged-in user ke saved accounts Firestore se laata hai
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.uid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const snap = await adminDb.collection("users").doc(session.uid).get();
  if (!snap.exists) {
    return NextResponse.json({ accounts: null, activeId: null });
  }
  const data = snap.data();
  return NextResponse.json({ accounts: data.accounts || [], activeId: data.activeId || null });
}

// POST /api/accounts — logged-in user ke accounts Firestore mein save karta hai
export async function POST(request) {
  const session = await getServerSession(authOptions);
  if (!session?.uid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const accounts = Array.isArray(body?.accounts) ? body.accounts : [];
  const activeId = body?.activeId ?? null;

  await adminDb.collection("users").doc(session.uid).set(
    { accounts, activeId, updatedAt: Date.now() },
    { merge: true }
  );

  return NextResponse.json({ ok: true });
}
