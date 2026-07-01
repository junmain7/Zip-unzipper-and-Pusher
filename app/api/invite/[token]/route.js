import { NextResponse } from "next/server";
import { adminDb } from "../../../../lib/firebaseAdmin";

// GET /api/invite/[token] — public: invite valid hai ya nahi check karta hai
export async function GET(request, { params }) {
  const { token } = params;
  if (!token) return NextResponse.json({ valid: false });

  const snap = await adminDb.collection("invites").doc(token).get();
  if (!snap.exists) return NextResponse.json({ valid: false });

  const data = snap.data();
  if (data.expiresAt !== null && (!data.expiresAt || data.expiresAt < Date.now())) {
    return NextResponse.json({ valid: false });
  }

  return NextResponse.json({ valid: true, ownerName: data.ownerName || "Someone" });
}
