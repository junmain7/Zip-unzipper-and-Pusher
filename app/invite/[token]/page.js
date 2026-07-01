"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

export default function InvitePage() {
  const params = useParams();
  const token = params?.token;
  const [status, setStatus] = useState("loading"); // loading | valid | invalid
  const [ownerName, setOwnerName] = useState("");

  useEffect(() => {
    if (!token) return;
    fetch(`/api/invite/${token}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.valid) {
          setOwnerName(data.ownerName || "Someone");
          setStatus("valid");
        } else {
          setStatus("invalid");
        }
      })
      .catch(() => setStatus("invalid"));
  }, [token]);

  const wrap = {
    minHeight: "100vh",
    background: "#0d1117",
    color: "#c9d1d9",
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "20px",
    boxSizing: "border-box",
  };

  const card = {
    background: "#161b22",
    border: "1px solid #30363d",
    borderRadius: "12px",
    padding: "28px 22px",
    width: "100%",
    maxWidth: "380px",
    textAlign: "center",
  };

  if (status === "loading") {
    return (
      <div style={wrap}>
        <div style={{ fontSize: "13px", color: "#8b949e" }}>Checking invite link…</div>
      </div>
    );
  }

  if (status === "invalid") {
    return (
      <div style={wrap}>
        <div style={card}>
          <div style={{ fontSize: "36px", marginBottom: "10px" }}>❌</div>
          <div style={{ fontSize: "15px", fontWeight: 700, color: "#f85149", marginBottom: "6px" }}>
            Invalid ya Expired Link
          </div>
          <div style={{ fontSize: "12px", color: "#8b949e" }}>
            Yeh invite link kaam nahi kar raha. Jisne bheja hai unse naya link maango.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={wrap}>
      <div style={card}>
        <div style={{ fontSize: "36px", marginBottom: "10px" }}>🐙</div>
        <div style={{ fontSize: "15px", fontWeight: 700, color: "#f0f6fc", marginBottom: "6px" }}>
          GitHub Account Connect Karo
        </div>
        <div style={{ fontSize: "12px", color: "#8b949e", marginBottom: "20px", lineHeight: 1.5 }}>
          <strong style={{ color: "#58a6ff" }}>{ownerName}</strong> ne aapko invite kiya hai apna GitHub
          account connect karne ke liye. Ek click mein authorize karo — aapka password ya token kahin
          share nahi hota.
        </div>
        <a
          href={`/api/auth/invite/start?token=${token}`}
          style={{
            display: "block",
            width: "100%",
            boxSizing: "border-box",
            padding: "12px",
            borderRadius: "8px",
            fontSize: "13px",
            fontWeight: 700,
            background: "#238636",
            color: "#fff",
            border: "1px solid #2ea043",
            textDecoration: "none",
          }}
        >
          🔗 Connect with GitHub
        </a>
        <div style={{ fontSize: "10px", color: "#484f58", marginTop: "14px" }}>
          Secure OAuth authorization via GitHub · No password shared
        </div>
      </div>
    </div>
  );
}
