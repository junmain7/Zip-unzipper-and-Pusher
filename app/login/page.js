"use client";

import { signIn } from "next-auth/react";

export default function LoginPage() {
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
        <div style={{ fontSize: "40px", marginBottom: "12px" }}>🐙</div>
        <div style={{ fontSize: "16px", fontWeight: 700, color: "#f0f6fc", marginBottom: "6px" }}>
          ZIP → GitHub Pusher
        </div>
        <div style={{ fontSize: "12px", color: "#8b949e", marginBottom: "24px" }}>
          Login karo apne GitHub account se
        </div>
        <button
          onClick={() => signIn("github", { callbackUrl: "/" })}
          style={{
            padding: "12px 24px",
            background: "#238636",
            color: "#fff",
            border: "1px solid #2ea043",
            borderRadius: "8px",
            fontSize: "14px",
            fontWeight: 700,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          🔐 Login with GitHub
        </button>
      </div>
    </div>
  );
}
