import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../lib/auth";
import { adminDb } from "../../../lib/firebaseAdmin";

// GET /api/vercel-account — logged-in user ka connected Vercel account laata hai
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.uid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const snap = await adminDb.collection("users").doc(session.uid).get();
  if (!snap.exists) {
    return NextResponse.json({ vercelAccount: null });
  }
  const data = snap.data();
  return NextResponse.json({ vercelAccount: data.vercelAccount || null });
}

// POST /api/vercel-account — connected Vercel account Firestore mein save karta hai
export async function POST(request) {
  const session = await getServerSession(authOptions);
  if (!session?.uid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const vercelAccount = body?.vercelAccount ?? null;

  await adminDb.collection("users").doc(session.uid).set(
    { vercelAccount, updatedAt: Date.now() },
    { merge: true }
  );

  return NextResponse.json({ ok: true });
}

// DELETE /api/vercel-account — disconnect
export async function DELETE() {
  const session = await getServerSession(authOptions);
  if (!session?.uid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await adminDb.collection("users").doc(session.uid).set(
    { vercelAccount: null, updatedAt: Date.now() },
    { merge: true }
  );

  return NextResponse.json({ ok: true });
}
