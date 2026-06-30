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
      <div style={{ minHeight: "100vh", background: "#05070d", display: "flex", alignItems: "center", justifyContent: "center", color: "#6e7681", fontFamily: "'JetBrains Mono', 'Fira Code', monospace", fontSize: "12px" }}>
        ⏳ Loading…
      </div>
    );
  }

  return (
    <div className="login-wrap">
      {/* Animated backdrop layers */}
      <div className="bg-gradient" />
      <div className="bg-grid" />
      <div className="bg-glow glow-a" />
      <div className="bg-glow glow-b" />

      {/* Floating binary/code particles */}
      <div className="particles">
        {["0", "1", "{", "}", "<>", "01", "10", "git", "0", "1", "[]", "1"].map((ch, i) => (
          <span key={i} className={`particle p${i}`}>{ch}</span>
        ))}
      </div>

      {/* Centerpiece pipeline animation: ZIP box -> extract -> push to GitHub */}
      <div className="pipeline">
        <div className="stage stage-zip">
          <div className="zip-box">📦</div>
          <div className="stage-label">ZIP</div>
        </div>

        <div className="conduit conduit-1">
          <span className="dot d1" /><span className="dot d2" /><span className="dot d3" />
        </div>

        <div className="stage stage-extract">
          <div className="file-burst">
            <span className="file f1">📄</span>
            <span className="file f2">📄</span>
            <span className="file f3">📄</span>
            <span className="file f4">📄</span>
          </div>
          <div className="stage-label">Extract</div>
        </div>

        <div className="conduit conduit-2">
          <span className="dot d1" /><span className="dot d2" /><span className="dot d3" />
        </div>

        <div className="stage stage-push">
          <div className="push-icon">⬆️🐙</div>
          <div className="stage-label">Push → GitHub</div>
        </div>
      </div>

      {/* Login card */}
      <div className="login-card">
        <div className="login-icon">📦</div>
        <div className="login-title">ZIP → GitHub Pusher</div>
        <div className="login-sub">Login karo apne Google account se</div>
        <button className="google-btn" onClick={() => signIn("google", { callbackUrl: "/" })}>
          <svg width="18" height="18" viewBox="0 0 18 18" style={{ flexShrink: 0 }}>
            <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92a8.78 8.78 0 0 0 2.68-6.62z" />
            <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86a5.16 5.16 0 0 1-4.86-3.58H1.13v2.34A9 9 0 0 0 9 18z" />
            <path fill="#FBBC05" d="M4.14 10.84a5.4 5.4 0 0 1 0-3.68V4.82H1.13a9 9 0 0 0 0 8.36l3-2.34z" />
            <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.46 3.44 1.35l2.58-2.58A8.97 8.97 0 0 0 9 0 9 9 0 0 0 1.13 4.82l3 2.34A5.16 5.16 0 0 1 9 3.58z" />
          </svg>
          Login with Google
        </button>
        <div className="login-footnote">Tumhare files, tumhara GitHub — sirf push automate hota hai yahaan se.</div>
      </div>

      <style jsx>{`
        .login-wrap {
          position: relative;
          min-height: 100vh;
          width: 100%;
          max-width: 100vw;
          overflow-x: hidden;
          background: #05070d;
          color: #c9d1d9;
          font-family: 'JetBrains Mono', 'Fira Code', monospace;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 16px;
          box-sizing: border-box;
        }

        .bg-gradient {
          position: absolute;
          inset: 0;
          background: radial-gradient(circle at 30% 20%, #0d1f3c 0%, #05070d 55%),
                      radial-gradient(circle at 80% 80%, #0d1f17 0%, transparent 50%);
          z-index: 0;
        }

        .bg-grid {
          position: absolute;
          inset: 0;
          background-image:
            linear-gradient(rgba(88,166,255,0.06) 1px, transparent 1px),
            linear-gradient(90deg, rgba(88,166,255,0.06) 1px, transparent 1px);
          background-size: 36px 36px;
          mask-image: radial-gradient(circle at center, #000 0%, transparent 75%);
          -webkit-mask-image: radial-gradient(circle at center, #000 0%, transparent 75%);
          z-index: 0;
        }

        .bg-glow {
          position: absolute;
          width: 420px;
          height: 420px;
          border-radius: 50%;
          filter: blur(90px);
          opacity: 0.35;
          z-index: 0;
          animation: floatGlow 12s ease-in-out infinite;
        }
        .glow-a { background: #1f6feb; top: -10%; left: -8%; }
        .glow-b { background: #2ea043; bottom: -12%; right: -8%; animation-delay: -6s; }

        @keyframes floatGlow {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(30px, -20px) scale(1.1); }
        }

        .particles {
          position: absolute;
          inset: 0;
          z-index: 1;
          pointer-events: none;
          overflow: hidden;
        }
        .particle {
          position: absolute;
          bottom: -10%;
          font-size: 13px;
          color: rgba(88,166,255,0.35);
          font-weight: 700;
          animation-name: drift;
          animation-timing-function: linear;
          animation-iteration-count: infinite;
        }
        .p0 { left: 4%; animation-duration: 16s; animation-delay: 0s; }
        .p1 { left: 12%; animation-duration: 21s; animation-delay: -3s; color: rgba(46,160,67,0.35); }
        .p2 { left: 20%; animation-duration: 14s; animation-delay: -7s; }
        .p3 { left: 30%; animation-duration: 24s; animation-delay: -1s; color: rgba(46,160,67,0.3); }
        .p4 { left: 42%; animation-duration: 18s; animation-delay: -10s; }
        .p5 { left: 55%; animation-duration: 20s; animation-delay: -4s; color: rgba(46,160,67,0.3); }
        .p6 { left: 65%; animation-duration: 15s; animation-delay: -8s; }
        .p7 { left: 75%; animation-duration: 23s; animation-delay: -12s; color: rgba(46,160,67,0.35); }
        .p8 { left: 84%; animation-duration: 17s; animation-delay: -2s; }
        .p9 { left: 90%; animation-duration: 19s; animation-delay: -9s; }
        .p10 { left: 96%; animation-duration: 22s; animation-delay: -5s; color: rgba(46,160,67,0.3); }
        .p11 { left: 50%; animation-duration: 25s; animation-delay: -14s; }

        @keyframes drift {
          0% { transform: translateY(0) rotate(0deg); opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { transform: translateY(-115vh) rotate(25deg); opacity: 0; }
        }

        /* Pipeline animation — sits behind the login card, faded so it doesn't
           fight the form for attention, but stays alive and visible. */
        .pipeline {
          position: absolute;
          z-index: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          width: min(92vw, 640px);
          opacity: 0.5;
          top: 12%;
          left: 50%;
          transform: translateX(-50%);
          filter: drop-shadow(0 0 18px rgba(31,111,235,0.15));
        }
        @media (max-height: 740px) {
          .pipeline { top: 7%; transform: translateX(-50%) scale(0.82); }
        }

        .stage {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
          flex-shrink: 0;
        }
        .stage-label {
          font-size: 9.5px;
          letter-spacing: 0.04em;
          color: #6e7681;
          font-weight: 700;
          white-space: nowrap;
        }

        .zip-box {
          font-size: 30px;
          animation: pulseBox 2.6s ease-in-out infinite;
        }
        @keyframes pulseBox {
          0%, 100% { transform: scale(1) rotate(0deg); }
          50% { transform: scale(1.12) rotate(-4deg); }
        }

        .file-burst {
          position: relative;
          width: 56px;
          height: 34px;
        }
        .file {
          position: absolute;
          font-size: 16px;
          top: 6px;
          left: 20px;
          animation-name: burstOut;
          animation-duration: 2.6s;
          animation-iteration-count: infinite;
          animation-timing-function: ease-in-out;
        }
        .f1 { animation-delay: 0s; --tx: -22px; --ty: -8px; }
        .f2 { animation-delay: 0.15s; --tx: -8px; --ty: 10px; }
        .f3 { animation-delay: 0.3s; --tx: 8px; --ty: -10px; }
        .f4 { animation-delay: 0.45s; --tx: 22px; --ty: 8px; }
        @keyframes burstOut {
          0% { transform: translate(0, 0) scale(0.4); opacity: 0; }
          35% { opacity: 1; transform: translate(var(--tx), var(--ty)) scale(1); }
          75% { opacity: 1; transform: translate(var(--tx), var(--ty)) scale(1); }
          100% { transform: translate(calc(var(--tx) * 1.3), calc(var(--ty) * 1.3)) scale(0.5); opacity: 0; }
        }

        .push-icon {
          font-size: 26px;
          animation: pushUp 1.8s ease-in-out infinite;
        }
        @keyframes pushUp {
          0%, 100% { transform: translateY(0); opacity: 0.85; }
          50% { transform: translateY(-6px); opacity: 1; }
        }

        .conduit {
          position: relative;
          width: 54px;
          height: 2px;
          background: linear-gradient(90deg, rgba(88,166,255,0.15), rgba(88,166,255,0.4), rgba(88,166,255,0.15));
          border-radius: 2px;
          flex-shrink: 0;
        }
        .dot {
          position: absolute;
          top: 50%;
          left: 0;
          width: 5px;
          height: 5px;
          margin-top: -2.5px;
          border-radius: 50%;
          background: #58a6ff;
          box-shadow: 0 0 6px #58a6ff;
          animation-name: flowDot;
          animation-duration: 1.8s;
          animation-iteration-count: infinite;
          animation-timing-function: linear;
        }
        .conduit-2 .dot { background: #3fb950; box-shadow: 0 0 6px #3fb950; }
        .d1 { animation-delay: 0s; }
        .d2 { animation-delay: 0.6s; }
        .d3 { animation-delay: 1.2s; }
        @keyframes flowDot {
          0% { left: 0; opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { left: 100%; opacity: 0; }
        }

        /* Login card */
        .login-card {
          position: relative;
          z-index: 2;
          box-sizing: border-box;
          width: 100%;
          max-width: 320px;
          background: rgba(13, 17, 23, 0.72);
          border: 1px solid rgba(48, 54, 61, 0.9);
          border-radius: 16px;
          padding: 32px 26px 24px;
          text-align: center;
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
          box-shadow: 0 20px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(88,166,255,0.04);
          animation: cardIn 0.6s ease both;
        }
        @keyframes cardIn {
          from { opacity: 0; transform: translateY(14px) scale(0.97); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }

        .login-icon {
          font-size: 34px;
          margin-bottom: 10px;
          filter: drop-shadow(0 0 10px rgba(88,166,255,0.35));
        }
        .login-title {
          font-size: 16px;
          font-weight: 700;
          color: #f0f6fc;
          margin-bottom: 6px;
        }
        .login-sub {
          font-size: 11.5px;
          color: #8b949e;
          margin-bottom: 22px;
        }

        .google-btn {
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          padding: 11px 18px;
          background: #fff;
          color: #1f1f1f;
          border: 1px solid #2ea043;
          border-radius: 8px;
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          font-family: inherit;
          transition: transform 0.15s ease, box-shadow 0.15s ease;
        }
        .google-btn:hover {
          transform: translateY(-1px);
          box-shadow: 0 6px 18px rgba(46,160,67,0.25);
        }
        .google-btn:active { transform: translateY(0); }

        .login-footnote {
          margin-top: 16px;
          font-size: 9.5px;
          color: #484f58;
          line-height: 1.5;
        }
      `}</style>
    </div>
  );
}
