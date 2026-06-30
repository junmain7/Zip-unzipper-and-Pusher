"use client";

import { signIn, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function LoginPage() {
  const { status } = useSession();
  const router = useRouter();

  // Agar user pehle se logged in hai to login page dikhna hi nahi chahiye —
  // seedha home par bhej do, taaki bina logout kiye login page access na ho.
  useEffect(() => {
    if (status === "authenticated") router.replace("/");
  }, [status, router]);

  if (status === "authenticated" || status === "loading") {
    return (
      <div style={{ minHeight: "100vh", background: "#0d1117", display: "flex", alignItems: "center", justifyContent: "center", color: "#6e7681", fontFamily: "'JetBrains Mono', 'Fira Code', monospace", fontSize: "12px" }}>
        ⏳ Loading…
      </div>
    );
  }

  return (
    <div style={{
      minHeight: "100vh",
      background: "#0d1117",
      color: "#c9d1d9",
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "16px",
    }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: "40px", marginBottom: "12px" }}>📦</div>
        <div style={{ fontSize: "16px", fontWeight: 700, color: "#f0f6fc", marginBottom: "6px" }}>
          ZIP → GitHub Pusher
        </div>
        <div style={{ fontSize: "12px", color: "#8b949e", marginBottom: "24px" }}>
          Login karo apne Google account se
        </div>
        <button
          onClick={() => signIn("google", { callbackUrl: "/" })}
          style={{
            padding: "12px 24px",
            background: "#fff",
            color: "#1f1f1f",
            border: "1px solid #2ea043",
            borderRadius: "8px",
            fontSize: "14px",
            fontWeight: 700,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          🔐 Login with Google
        </button>
      </div>
    </div>
  );
}
