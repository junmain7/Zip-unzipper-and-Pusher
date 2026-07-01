import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../lib/auth";
import { adminDb } from "../../../lib/firebaseAdmin";

const DURATIONS = {
  "1d": 1 * 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
  permanent: null, // no expiry — sirf ek baar use hone tak valid
};

// GET /api/invite — owner ka current active invite link laata hai (agar hai)
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.uid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const snap = await adminDb.collection("userInvites").doc(session.uid).get();
  if (!snap.exists) return NextResponse.json({ invite: null });

  const data = snap.data();
  if (!data.token) return NextResponse.json({ invite: null });
  if (data.expiresAt !== null && data.expiresAt < Date.now()) {
    return NextResponse.json({ invite: null });
  }
  return NextResponse.json({ invite: { token: data.token, expiresAt: data.expiresAt, duration: data.duration || null } });
}

// POST /api/invite — naya invite link generate karta hai (purana revoke karke)
// body: { duration: "1d" | "7d" | "30d" | "permanent" }
export async function POST(request) {
  const session = await getServerSession(authOptions);
  if (!session?.uid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let duration = "7d";
  try {
    const body = await request.json();
    if (body?.duration && Object.prototype.hasOwnProperty.call(DURATIONS, body.duration)) {
      duration = body.duration;
    }
  } catch {}

  // purana active invite (agar hai) revoke karo
  const oldSnap = await adminDb.collection("userInvites").doc(session.uid).get();
  if (oldSnap.exists && oldSnap.data()?.token) {
    await adminDb.collection("invites").doc(oldSnap.data().token).delete().catch(() => {});
  }

  const token = crypto.randomUUID().replace(/-/g, "");
  const createdAt = Date.now();
  const ttl = DURATIONS[duration];
  const expiresAt = ttl === null ? null : createdAt + ttl;
  const ownerName = session.user?.name || session.user?.email || "Someone";

  await adminDb.collection("invites").doc(token).set({
    ownerUid: session.uid,
    ownerName,
    createdAt,
    expiresAt,
    duration,
  });
  await adminDb.collection("userInvites").doc(session.uid).set({
    token,
    createdAt,
    expiresAt,
    duration,
  });

  return NextResponse.json({ invite: { token, expiresAt, duration } });
}

// DELETE /api/invite — current invite link revoke karta hai
export async function DELETE() {
  const session = await getServerSession(authOptions);
  if (!session?.uid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const snap = await adminDb.collection("userInvites").doc(session.uid).get();
  if (snap.exists && snap.data()?.token) {
    await adminDb.collection("invites").doc(snap.data().token).delete().catch(() => {});
  }
  await adminDb.collection("userInvites").doc(session.uid).delete().catch(() => {});

  return NextResponse.json({ ok: true });
}

