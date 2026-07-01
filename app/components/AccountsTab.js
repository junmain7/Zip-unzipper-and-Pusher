"use client";

import { useState, useEffect, useRef } from "react";
import { saveAccounts, saveActiveId, maskPat } from "../../lib/storage";

// ── Expiry helpers (invite se aaye account ka access kitni der valid hai) ──
function formatRemaining(ms) {
  if (ms <= 0) return "Expired";
  const mins = Math.floor(ms / 60000);
  const days = Math.floor(mins / 1440);
  const hrs = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (days > 0) return `${days}d ${hrs}h left`;
  if (hrs > 0) return `${hrs}h ${m}m left`;
  return `${m}m left`;
}

// Live-updating countdown badge — sirf viaInvite accounts jinke paas accessExpiresAt hai unpar dikhta hai
function ExpiryBadge({ expiresAt }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);
  if (!expiresAt) return null;
  const remaining = expiresAt - now;
  const expired = remaining <= 0;
  return (
    <span style={{ fontSize: "9px", background: expired ? "#3d1f1f" : "#3d3319", color: expired ? "#f85149" : "#e3b341", borderRadius: "4px", padding: "1px 5px" }}>
      ⏱ {formatRemaining(remaining)}
    </span>
  );
}

export default function AccountsTab({ activeAccountId, setActiveAccountId, accounts, setAccounts }) {
  const [showAdd, setShowAdd] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [showAgent, setShowAgent] = useState(false);
  const [label, setLabel] = useState("");
  const [pat, setPat] = useState("");
  const [patVisible, setPatVisible] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  const inp = { width: "100%", boxSizing: "border-box", background: "#161b22", border: "1px solid #30363d", color: "#c9d1d9", borderRadius: "6px", padding: "9px 12px", fontSize: "12px", outline: "none", fontFamily: "inherit" };

  const handleTest = async () => {
    if (!pat.trim()) return;
    setTesting(true); setTestResult(null);
    try {
      const res = await fetch("https://api.github.com/user", { headers: { Authorization: `token ${pat.trim()}`, Accept: "application/vnd.github.v3+json" } });
      if (!res.ok) throw new Error("Invalid");
      const d = await res.json();
      setTestResult({ ok: true, login: d.login, name: d.name, avatar: d.avatar_url });
    } catch { setTestResult({ ok: false }); }
    finally { setTesting(false); }
  };

  const handleAdd = () => {
    if (!label.trim() || !pat.trim() || !testResult?.ok) return;
    const newAcc = { id: Math.random().toString(36).slice(2), label: label.trim(), pat: pat.trim(), login: testResult.login, avatar: testResult.avatar };
    const updated = [...accounts, newAcc];
    saveAccounts(updated); setAccounts(updated);
    if (!activeAccountId) { saveActiveId(newAcc.id); setActiveAccountId(newAcc.id); }
    setLabel(""); setPat(""); setTestResult(null); setShowAdd(false); setPatVisible(false);
  };

  const handleDelete = (id) => {
    const updated = accounts.filter(a => a.id !== id);
    saveAccounts(updated); setAccounts(updated);
    if (activeAccountId === id) { const n = updated[0]?.id || null; saveActiveId(n || ""); setActiveAccountId(n); }
    setDeleteConfirm(null);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <div style={{ fontSize: "11px", color: "#8b949e" }}>PAT se multiple accounts — switch karte waqt sirf label dikhega, PAT nahi.</div>

      {accounts.length === 0 && !showAdd && (
        <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: "8px", padding: "24px", textAlign: "center" }}>
          <div style={{ fontSize: "28px", marginBottom: "8px" }}>👤</div>
          <div style={{ fontSize: "12px", color: "#6e7681" }}>Koi account nahi — add karo</div>
        </div>
      )}

      {accounts.map(acc => {
        const isActive = acc.id === activeAccountId;
        const expired = acc.viaInvite && acc.accessExpiresAt && acc.accessExpiresAt <= Date.now();
        return (
          <div key={acc.id} style={{ background: "#161b22", border: `1px solid ${isActive ? "#2ea043" : "#30363d"}`, borderRadius: "8px", padding: "12px", display: "flex", alignItems: "center", gap: "10px", opacity: expired ? 0.55 : 1 }}>
            <div style={{ width: "36px", height: "36px", borderRadius: "50%", background: "#30363d", flexShrink: 0, overflow: "hidden", border: `2px solid ${isActive ? "#2ea043" : "#30363d"}` }}>
              {acc.avatar && <img src={acc.avatar} alt="" style={{ width: "100%", height: "100%" }} />}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: "13px", fontWeight: 700, color: "#f0f6fc", display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                {acc.label}
                {isActive && <span style={{ fontSize: "9px", background: "#238636", color: "#fff", borderRadius: "4px", padding: "1px 5px" }}>ACTIVE</span>}
                {acc.viaInvite && <span style={{ fontSize: "9px", background: "#1f6feb", color: "#fff", borderRadius: "4px", padding: "1px 5px" }}>via invite</span>}
                {acc.viaInvite && acc.accessExpiresAt && <ExpiryBadge expiresAt={acc.accessExpiresAt} />}
              </div>
              <div style={{ fontSize: "10px", color: "#6e7681" }}>@{acc.login} · {maskPat(acc.pat)}</div>
            </div>
            <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
              {!isActive && (
                <button onClick={() => { saveActiveId(acc.id); setActiveAccountId(acc.id); }} disabled={expired} style={{ background: expired ? "#21262d" : "#238636", border: "none", color: expired ? "#6e7681" : "#fff", borderRadius: "6px", padding: "5px 10px", fontSize: "11px", cursor: expired ? "not-allowed" : "pointer", fontFamily: "inherit", fontWeight: 600 }}>Switch</button>
              )}
              {deleteConfirm === acc.id ? (
                <>
                  <button onClick={() => handleDelete(acc.id)} style={{ background: "#da3633", border: "none", color: "#fff", borderRadius: "6px", padding: "5px 8px", fontSize: "11px", cursor: "pointer", fontFamily: "inherit" }}>Haan</button>
                  <button onClick={() => setDeleteConfirm(null)} style={{ background: "#30363d", border: "none", color: "#c9d1d9", borderRadius: "6px", padding: "5px 8px", fontSize: "11px", cursor: "pointer", fontFamily: "inherit" }}>Nahi</button>
                </>
              ) : (
                <button onClick={() => setDeleteConfirm(acc.id)} style={{ background: "none", border: "1px solid #30363d", color: "#6e7681", borderRadius: "6px", padding: "5px 8px", fontSize: "11px", cursor: "pointer", fontFamily: "inherit" }}>🗑️</button>
              )}
            </div>
          </div>
        );
      })}

      {showAdd ? (
        <div style={{ background: "#161b22", border: "1px solid #388bfd", borderRadius: "8px", padding: "14px", display: "flex", flexDirection: "column", gap: "10px" }}>
          <div style={{ fontSize: "12px", fontWeight: 700, color: "#58a6ff" }}>➕ Naya Account</div>
          <div>
            <div style={{ fontSize: "11px", color: "#8b949e", marginBottom: "4px" }}>🏷️ Label (e.g. "Work", "Personal")</div>
            <input type="text" value={label} onChange={e => setLabel(e.target.value)} placeholder="My Work Account" style={inp} />
          </div>
          <div>
            <div style={{ fontSize: "11px", color: "#8b949e", marginBottom: "4px" }}>
              🔑 GitHub PAT &nbsp;
              <a href="https://github.com/settings/tokens/new?scopes=repo" target="_blank" rel="noopener noreferrer" style={{ color: "#58a6ff", textDecoration: "none" }}>Generate karo ↗</a>
            </div>
            <div style={{ position: "relative" }}>
              <input type={patVisible ? "text" : "password"} value={pat} onChange={e => { setPat(e.target.value); setTestResult(null); }} placeholder="ghp_xxxxxxxxxxxx" style={{ ...inp, paddingRight: "60px" }} />
              <button onClick={() => setPatVisible(p => !p)} style={{ position: "absolute", right: "8px", top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#6e7681", cursor: "pointer", fontSize: "11px", fontFamily: "inherit" }}>
                {patVisible ? "Hide" : "Show"}
              </button>
            </div>
          </div>
          {testResult && (
            <div style={{ background: testResult.ok ? "#0d1f0d" : "#1f0d0d", border: `1px solid ${testResult.ok ? "#2ea043" : "#da3633"}`, borderRadius: "6px", padding: "8px 10px", fontSize: "11px", display: "flex", alignItems: "center", gap: "8px" }}>
              {testResult.ok ? (
                <><img src={testResult.avatar} alt="" style={{ width: "20px", height: "20px", borderRadius: "50%" }} /><span style={{ color: "#3fb950" }}>✅ Valid! @{testResult.login} ({testResult.name})</span></>
              ) : <span style={{ color: "#f85149" }}>❌ Invalid token</span>}
            </div>
          )}
          <div style={{ display: "flex", gap: "8px" }}>
            <button onClick={handleTest} disabled={testing || !pat.trim()} style={{ flex: 1, padding: "9px", borderRadius: "6px", fontSize: "12px", fontFamily: "inherit", fontWeight: 600, cursor: testing || !pat.trim() ? "not-allowed" : "pointer", background: testing || !pat.trim() ? "#0d1117" : "#1f6feb", color: testing || !pat.trim() ? "#6e7681" : "#fff", border: "1px solid #388bfd" }}>
              {testing ? "⏳..." : "🔍 Test Karo"}
            </button>
            <button onClick={handleAdd} disabled={!testResult?.ok || !label.trim()} style={{ flex: 1, padding: "9px", borderRadius: "6px", fontSize: "12px", fontFamily: "inherit", fontWeight: 600, cursor: !testResult?.ok || !label.trim() ? "not-allowed" : "pointer", background: !testResult?.ok || !label.trim() ? "#0d1117" : "#238636", color: !testResult?.ok || !label.trim() ? "#6e7681" : "#fff", border: "1px solid #2ea043" }}>
              ✅ Add Karo
            </button>
          </div>
          <button onClick={() => { setShowAdd(false); setLabel(""); setPat(""); setTestResult(null); setPatVisible(false); }} style={{ background: "none", border: "none", color: "#6e7681", fontSize: "11px", cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
        </div>
      ) : (
        <button onClick={() => setShowAdd(true)} style={{ width: "100%", padding: "12px", borderRadius: "8px", fontSize: "13px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", background: "#161b22", color: "#58a6ff", border: "1px dashed #388bfd" }}>
          ➕ Account Add Karo
        </button>
      )}

      <button onClick={() => setShowInvite(true)} style={{ width: "100%", padding: "12px", borderRadius: "8px", fontSize: "13px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", background: "#161b22", color: "#a5a5f5", border: "1px dashed #6e7cc4" }}>
        🔗 Invite Link Banao (kisi aur ka account add karwao)
      </button>

      {showInvite && <InviteLinkModal onClose={() => setShowInvite(false)} />}

      <div style={{ fontSize: "10px", color: "#484f58", textAlign: "center" }}>PAT localStorage mein save hota hai · Scope chahiye: <code>repo</code></div>
    </div>
  );
}


// ── Add Account Modal ────────────────────────────────────
export function AddAccountModal({ onClose, accounts, setAccounts, setActiveAccountId, activeAccountId }) {
  const [label, setLabel] = useState("");
  const [pat, setPat] = useState("");
  const [patVisible, setPatVisible] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState("");
  const popupRef = useRef(null);

  const inp = { width: "100%", boxSizing: "border-box", background: "#0d1117", border: "1px solid #30363d", color: "#c9d1d9", borderRadius: "6px", padding: "9px 12px", fontSize: "12px", outline: "none", fontFamily: "inherit" };

  const upsertAccount = ({ login, name, avatar, pat }) => {
    const existing = accounts.find(a => a.login === login);
    let updated;
    let id;
    if (existing) {
      id = existing.id;
      updated = accounts.map(a => a.id === existing.id ? { ...a, pat, avatar, label: a.label || name || login } : a);
    } else {
      id = Math.random().toString(36).slice(2);
      updated = [...accounts, { id, label: name || login, pat, login, avatar }];
    }
    saveAccounts(updated); setAccounts(updated);
    if (!activeAccountId) { saveActiveId(id); setActiveAccountId(id); }
    return id;
  };

  // ── Connect with GitHub (OAuth popup) ──────────────────
  // Opens GitHub's authorize page in a popup. No manual token copy-paste —
  // the popup posts the access token + profile back here once authorized.
  // This token is a permanent OAuth App token (doesn't expire by default).
  useEffect(() => {
    const handleMessage = (e) => {
      if (e.origin !== window.location.origin) return;
      const data = e.data;
      if (!data || (data.type !== "gh-connect-success" && data.type !== "gh-connect-error")) return;

      setConnecting(false);
      if (data.type === "gh-connect-error") {
        setConnectError(data.message || "Connect failed, try again");
        return;
      }
      upsertAccount({ login: data.login, name: data.name, avatar: data.avatar, pat: data.token });
      onClose();
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts, activeAccountId]);

  const handleConnect = () => {
    setConnectError("");
    setConnecting(true);
    const w = 520, h = 640;
    const left = window.screenX + (window.outerWidth - w) / 2;
    const top = window.screenY + (window.outerHeight - h) / 2;
    popupRef.current = window.open(
      "/api/auth/connect/start",
      "gh-connect",
      `width=${w},height=${h},left=${left},top=${top}`
    );
    if (!popupRef.current) {
      setConnecting(false);
      setConnectError("Popup blocked — allow popups and try again");
      return;
    }
    const poll = setInterval(() => {
      if (popupRef.current?.closed) {
        clearInterval(poll);
        setConnecting(false);
      }
    }, 500);
  };

  const handleTest = async () => {
    if (!pat.trim()) return;
    setTesting(true); setTestResult(null);
    try {
      const res = await fetch("https://api.github.com/user", { headers: { Authorization: `token ${pat.trim()}`, Accept: "application/vnd.github.v3+json" } });
      if (!res.ok) throw new Error("Invalid");
      const d = await res.json();
      setTestResult({ ok: true, login: d.login, name: d.name, avatar: d.avatar_url });
    } catch { setTestResult({ ok: false }); }
    finally { setTesting(false); }
  };

  const handleAdd = () => {
    if (!label.trim() || !pat.trim() || !testResult?.ok) return;
    upsertAccount({ login: testResult.login, name: label.trim(), avatar: testResult.avatar, pat: pat.trim() });
    onClose();
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: "12px", padding: "18px", width: "100%", maxWidth: "360px", display: "flex", flexDirection: "column", gap: "12px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: "14px", fontWeight: 700, color: "#f0f6fc" }}>➕ Add Account</div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#6e7681", fontSize: "18px", cursor: "pointer" }}>✕</button>
        </div>

        {/* Connect with GitHub — automatic, permanent token, zero manual steps */}
        <button
          onClick={handleConnect}
          disabled={connecting}
          style={{ width: "100%", padding: "11px", borderRadius: "8px", fontSize: "13px", fontWeight: 700, cursor: connecting ? "not-allowed" : "pointer", fontFamily: "inherit", background: connecting ? "#0d1117" : "#21262d", color: connecting ? "#6e7681" : "#f0f6fc", border: "1px solid #30363d", display: "flex", alignItems: "center", justifyContent: "center", gap: "9px" }}
        >
          <span style={{ fontSize: "16px" }}>🐙</span>
          {connecting ? "Waiting for authorization…" : "Connect with GitHub"}
        </button>
        {connectError && <div style={{ fontSize: "11px", color: "#f85149", textAlign: "center", marginTop: "-4px" }}>❌ {connectError}</div>}
        <div style={{ fontSize: "10px", color: "#484f58", textAlign: "center", marginTop: "-6px" }}>One click · token auto-generate hota hai · permanent rehta hai</div>

        <div style={{ display: "flex", alignItems: "center", gap: "10px", margin: "2px 0" }}>
          <div style={{ flex: 1, height: "1px", background: "#21262d" }} />
          <span style={{ fontSize: "10px", color: "#6e7681" }}>YA MANUALLY</span>
          <div style={{ flex: 1, height: "1px", background: "#21262d" }} />
        </div>

        <div>
          <div style={{ fontSize: "11px", color: "#8b949e", marginBottom: "4px" }}>🏷️ Label</div>
          <input type="text" value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Work, Personal" style={inp} />
        </div>

        <div>
          <div style={{ fontSize: "11px", color: "#8b949e", marginBottom: "4px" }}>
            🔑 GitHub PAT &nbsp;
            <a href="https://github.com/settings/tokens/new?scopes=repo" target="_blank" rel="noopener noreferrer" style={{ color: "#58a6ff", textDecoration: "none" }}>Generate ↗</a>
          </div>
          <div style={{ position: "relative" }}>
            <input type={patVisible ? "text" : "password"} value={pat} onChange={e => { setPat(e.target.value); setTestResult(null); }} placeholder="ghp_xxxxxxxxxxxx" style={{ ...inp, paddingRight: "55px" }} />
            <button onClick={() => setPatVisible(p => !p)} style={{ position: "absolute", right: "8px", top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#6e7681", cursor: "pointer", fontSize: "11px", fontFamily: "inherit" }}>
              {patVisible ? "Hide" : "Show"}
            </button>
          </div>
        </div>

        {testResult && (
          <div style={{ background: testResult.ok ? "#0d1f0d" : "#1f0d0d", border: `1px solid ${testResult.ok ? "#2ea043" : "#da3633"}`, borderRadius: "6px", padding: "8px 10px", fontSize: "11px", display: "flex", alignItems: "center", gap: "8px" }}>
            {testResult.ok ? (
              <><img src={testResult.avatar} alt="" style={{ width: "18px", height: "18px", borderRadius: "50%" }} /><span style={{ color: "#3fb950" }}>✅ @{testResult.login}</span></>
            ) : <span style={{ color: "#f85149" }}>❌ Invalid token</span>}
          </div>
        )}

        <div style={{ display: "flex", gap: "8px" }}>
          <button onClick={handleTest} disabled={testing || !pat.trim()} style={{ flex: 1, padding: "9px", borderRadius: "6px", fontSize: "12px", fontFamily: "inherit", fontWeight: 600, cursor: testing || !pat.trim() ? "not-allowed" : "pointer", background: testing || !pat.trim() ? "#0d1117" : "#1f6feb", color: testing || !pat.trim() ? "#6e7681" : "#fff", border: "1px solid #388bfd" }}>
            {testing ? "⏳..." : "🔍 Test"}
          </button>
          <button onClick={handleAdd} disabled={!testResult?.ok || !label.trim()} style={{ flex: 1, padding: "9px", borderRadius: "6px", fontSize: "12px", fontFamily: "inherit", fontWeight: 600, cursor: !testResult?.ok || !label.trim() ? "not-allowed" : "pointer", background: !testResult?.ok || !label.trim() ? "#0d1117" : "#238636", color: !testResult?.ok || !label.trim() ? "#6e7681" : "#fff", border: "1px solid #2ea043" }}>
            ✅ Add
          </button>
        </div>
        <div style={{ fontSize: "10px", color: "#484f58", textAlign: "center" }}>Scope chahiye: <code>repo</code></div>
      </div>
    </div>
  );
}

// ── Switch Account Modal ─────────────────────────────────
export function SwitchAccountModal({ onClose, accounts, setAccounts, activeAccountId, setActiveAccountId, setSelectedRepo, onAddNew }) {
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  const handleDelete = (id) => {
    const updated = accounts.filter(a => a.id !== id);
    saveAccounts(updated); setAccounts(updated);
    if (activeAccountId === id) { const n = updated[0]?.id || null; saveActiveId(n || ""); setActiveAccountId(n); }
    setDeleteConfirm(null);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: "12px", width: "100%", maxWidth: "360px", overflow: "hidden", maxHeight: "80vh", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", borderBottom: "1px solid #21262d", flexShrink: 0 }}>
          <div style={{ fontSize: "14px", fontWeight: 700, color: "#f0f6fc" }}>⇄ Switch Account</div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#6e7681", fontSize: "18px", cursor: "pointer" }}>✕</button>
        </div>

        <div style={{ overflowY: "auto", flex: 1 }}>
          {accounts.length === 0 && (
            <div style={{ padding: "24px", textAlign: "center", fontSize: "12px", color: "#6e7681" }}>Koi account nahi hai</div>
          )}
          {accounts.map(acc => {
            const isActive = acc.id === activeAccountId;
            const expired = acc.viaInvite && acc.accessExpiresAt && acc.accessExpiresAt <= Date.now();
            return (
              <div key={acc.id} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 16px", borderBottom: "1px solid #21262d", background: isActive ? "#1f2937" : "transparent", opacity: expired ? 0.55 : 1 }}>
                <div style={{ width: "32px", height: "32px", borderRadius: "50%", overflow: "hidden", flexShrink: 0, border: `2px solid ${isActive ? "#2ea043" : "#30363d"}`, background: "#30363d" }}>
                  {acc.avatar && <img src={acc.avatar} alt="" style={{ width: "100%", height: "100%" }} />}
                </div>
                <button
                  onClick={() => { if (expired) return; saveActiveId(acc.id); setActiveAccountId(acc.id); setSelectedRepo(""); onClose(); }}
                  disabled={expired}
                  style={{ flex: 1, textAlign: "left", background: "none", border: "none", cursor: expired ? "not-allowed" : "pointer", fontFamily: "inherit", padding: 0 }}
                >
                  <div style={{ fontSize: "13px", fontWeight: 600, color: "#f0f6fc", display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                    {acc.label}
                    {acc.viaInvite && <span style={{ fontSize: "8px", background: "#1f6feb", color: "#fff", borderRadius: "4px", padding: "1px 4px" }}>via invite</span>}
                    {acc.viaInvite && acc.accessExpiresAt && <ExpiryBadge expiresAt={acc.accessExpiresAt} />}
                  </div>
                  <div style={{ fontSize: "10px", color: "#6e7681" }}>@{acc.login}</div>
                </button>
                {isActive && <span style={{ color: "#3fb950", fontSize: "14px", flexShrink: 0 }}>✓</span>}
                {deleteConfirm === acc.id ? (
                  <div style={{ display: "flex", gap: "4px", flexShrink: 0 }}>
                    <button onClick={() => handleDelete(acc.id)} style={{ background: "#da3633", border: "none", color: "#fff", borderRadius: "4px", padding: "4px 6px", fontSize: "10px", cursor: "pointer", fontFamily: "inherit" }}>Haan</button>
                    <button onClick={() => setDeleteConfirm(null)} style={{ background: "#30363d", border: "none", color: "#c9d1d9", borderRadius: "4px", padding: "4px 6px", fontSize: "10px", cursor: "pointer", fontFamily: "inherit" }}>Nahi</button>
                  </div>
                ) : (
                  <button onClick={() => setDeleteConfirm(acc.id)} style={{ background: "none", border: "none", color: "#6e7681", cursor: "pointer", fontSize: "13px", flexShrink: 0 }}>🗑️</button>
                )}
              </div>
            );
          })}
        </div>

        <button onClick={() => { onClose(); onAddNew(); }} style={{ padding: "13px 16px", background: "none", border: "none", borderTop: "1px solid #21262d", color: "#58a6ff", fontSize: "13px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
          ➕ Add another account
        </button>
      </div>
    </div>
  );
}

// ── Invite Link Modal ─────────────────────────────────────
// Owner ek link generate karta hai, kisiko bhejta hai, woh apna GitHub
// connect karta hai — aur woh account automatically owner ke accounts
// list mein "via invite" badge ke saath aa jaata hai.
export function InviteLinkModal({ onClose }) {
  const [loading, setLoading] = useState(true);
  const [invite, setInvite] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [customValue, setCustomValue] = useState(7);
  const [customUnit, setCustomUnit] = useState("days");
  const [permanent, setPermanent] = useState(false);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const link = invite ? `${origin}/invite/${invite.token}` : "";

  const UNIT_MS = { minutes: 60000, hours: 3600000, days: 86400000 };
  const customMs = Math.max(1, Number(customValue) || 0) * UNIT_MS[customUnit];

  const loadInvite = async () => {
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/invite");
      const data = await res.json();
      setInvite(data.invite || null);
    } catch { setError("Load nahi ho paya"); }
    finally { setLoading(false); }
  };

  useEffect(() => { loadInvite(); }, []);

  const handleGenerate = async () => {
    setGenerating(true); setError("");
    try {
      const res = await fetch("/api/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(permanent ? { duration: "permanent" } : { customMs }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setInvite(data.invite);
      setCopied(false);
    } catch { setError("Generate nahi ho paya, dobara try karo"); }
    finally { setGenerating(false); }
  };

  const handleRevoke = async () => {
    setGenerating(true); setError("");
    try {
      await fetch("/api/invite", { method: "DELETE" });
      setInvite(null);
    } catch { setError("Revoke nahi ho paya"); }
    finally { setGenerating(false); }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  const handleShare = async () => {
    if (navigator.share) {
      try { await navigator.share({ title: "GitHub Account Connect Karo", url: link }); } catch {}
    } else {
      handleCopy();
    }
  };

  const expiryText = invite
    ? (invite.expiresAt === null
        ? "Kabhi expire nahi hoga (ek baar use hote hi khatam)"
        : new Date(invite.expiresAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }))
    : "";

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: "12px", padding: "18px", width: "100%", maxWidth: "380px", display: "flex", flexDirection: "column", gap: "12px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: "14px", fontWeight: 700, color: "#f0f6fc" }}>🔗 Invite Link</div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#6e7681", fontSize: "18px", cursor: "pointer" }}>✕</button>
        </div>
        <div style={{ fontSize: "11px", color: "#8b949e", lineHeight: 1.5 }}>
          Yeh link kisiko bhejo — woh apna GitHub connect karega aur uska account automatically tumhare accounts list mein add ho jaayega. Link <strong style={{ color: "#f0f6fc" }}>ek baar use</strong> hote hi khud invalid ho jaayega.
        </div>

        {loading ? (
          <div style={{ fontSize: "12px", color: "#6e7681", textAlign: "center", padding: "16px" }}>Loading…</div>
        ) : invite ? (
          <>
            <div style={{ background: "#0d1117", border: "1px solid #30363d", borderRadius: "6px", padding: "9px 12px", fontSize: "11px", color: "#58a6ff", wordBreak: "break-all" }}>
              {link}
            </div>
            <div style={{ fontSize: "10px", color: "#484f58" }}>Expires: {expiryText}</div>
            <div style={{ display: "flex", gap: "8px" }}>
              <button onClick={handleCopy} style={{ flex: 1, padding: "9px", borderRadius: "6px", fontSize: "12px", fontFamily: "inherit", fontWeight: 600, cursor: "pointer", background: copied ? "#0d1f0d" : "#1f6feb", color: "#fff", border: "1px solid #388bfd" }}>
                {copied ? "✅ Copied" : "📋 Copy"}
              </button>
              <button onClick={handleShare} style={{ flex: 1, padding: "9px", borderRadius: "6px", fontSize: "12px", fontFamily: "inherit", fontWeight: 600, cursor: "pointer", background: "#238636", color: "#fff", border: "1px solid #2ea043" }}>
                📤 Share
              </button>
            </div>
            <button onClick={handleRevoke} disabled={generating} style={{ background: "none", border: "1px solid #30363d", color: "#f85149", borderRadius: "6px", padding: "8px", fontSize: "11px", cursor: generating ? "not-allowed" : "pointer", fontFamily: "inherit" }}>
              {generating ? "⏳…" : "🗑️ Revoke & Naya Banao"}
            </button>
          </>
        ) : (
          <>
            <div>
              <div style={{ fontSize: "11px", color: "#8b949e", marginBottom: "6px" }}>⏱️ Access kitne samay ke liye do? Apna time chuno:</div>
              <div style={{ display: "flex", gap: "8px", opacity: permanent ? 0.4 : 1, pointerEvents: permanent ? "none" : "auto" }}>
                <input
                  type="number"
                  min="1"
                  value={customValue}
                  onChange={e => setCustomValue(e.target.value)}
                  style={{ width: "70px", background: "#0d1117", border: "1px solid #30363d", color: "#c9d1d9", borderRadius: "6px", padding: "9px 10px", fontSize: "13px", outline: "none", fontFamily: "inherit" }}
                />
                <div style={{ display: "flex", gap: "6px", flex: 1 }}>
                  {[["minutes", "Min"], ["hours", "Ghante"], ["days", "Din"]].map(([val, label]) => (
                    <button
                      key={val}
                      onClick={() => setCustomUnit(val)}
                      style={{ flex: 1, padding: "9px 4px", borderRadius: "6px", fontSize: "11px", fontFamily: "inherit", fontWeight: 600, cursor: "pointer", background: customUnit === val ? "#1f6feb" : "#0d1117", color: customUnit === val ? "#fff" : "#8b949e", border: `1px solid ${customUnit === val ? "#388bfd" : "#30363d"}` }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "10px", fontSize: "11px", color: "#8b949e", cursor: "pointer" }}>
                <input type="checkbox" checked={permanent} onChange={e => setPermanent(e.target.checked)} />
                Permanent (kabhi expire nahi hoga, sirf one-time use tak)
              </label>
            </div>
            <button onClick={handleGenerate} disabled={generating || (!permanent && (!customValue || Number(customValue) <= 0))} style={{ width: "100%", padding: "11px", borderRadius: "8px", fontSize: "13px", fontWeight: 700, cursor: generating ? "not-allowed" : "pointer", fontFamily: "inherit", background: generating ? "#0d1117" : "#238636", color: generating ? "#6e7681" : "#fff", border: "1px solid #2ea043" }}>
              {generating ? "⏳ Generating…" : "🔗 Invite Link Generate Karo"}
            </button>
          </>
        )}
        {error && <div style={{ fontSize: "11px", color: "#f85149", textAlign: "center" }}>❌ {error}</div>}
        <div style={{ fontSize: "10px", color: "#484f58", textAlign: "center" }}>One-time use · connect hote hi link khud unlink ho jaayega</div>
      </div>
    </div>
  );
}

// ── Agent Link Modal ──────────────────────────────────────
// Account + repo chuno, ek read-only URL milta hai jo poora repo (tree +
// file contents) JSON mein return karta hai — kisi bhi AI/agent tool ko
// bas yeh URL fetch karna hai, poora code padh lega.
export function AgentLinkModal({ accounts, onClose }) {
  const [step, setStep] = useState("account"); // account | repo | done
  const [selectedAcc, setSelectedAcc] = useState(null);
  const [repos, setRepos] = useState([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [repoFilter, setRepoFilter] = useState("");
  const [generating, setGenerating] = useState(false);
  const [link, setLink] = useState(null);
  const [existingLinks, setExistingLinks] = useState([]);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  useEffect(() => {
    fetch("/api/agent").then(r => r.json()).then(d => setExistingLinks(d.links || [])).catch(() => {});
  }, []);

  const pickAccount = async (acc) => {
    setSelectedAcc(acc); setStep("repo"); setReposLoading(true); setError("");
    try {
      const res = await fetch("https://api.github.com/user/repos?per_page=100&sort=updated", {
        headers: { Authorization: `token ${acc.pat}`, Accept: "application/vnd.github.v3+json" },
      });
      if (!res.ok) throw new Error();
      setRepos(await res.json());
    } catch { setError("Repos load nahi hue"); }
    finally { setReposLoading(false); }
  };

  const pickRepo = async (repo) => {
    setGenerating(true); setError("");
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: selectedAcc.id, owner: repo.owner.login, repo: repo.name }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setLink(data.link);
      setStep("done");
    } catch { setError("Link generate nahi hua"); }
    finally { setGenerating(false); }
  };

  const handleRevoke = async (token) => {
    await fetch("/api/agent", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) }).catch(() => {});
    setExistingLinks(l => l.filter(x => x.token !== token));
  };

  const handleCopy = async (url) => {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
  };

  const filteredRepos = repos.filter(r => r.name.toLowerCase().includes(repoFilter.toLowerCase()));

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: "12px", width: "100%", maxWidth: "380px", maxHeight: "82vh", overflowY: "auto", padding: "18px", display: "flex", flexDirection: "column", gap: "12px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: "14px", fontWeight: 700, color: "#f0f6fc" }}>🤖 Agent Access Link</div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#6e7681", fontSize: "18px", cursor: "pointer" }}>✕</button>
        </div>

        {step === "account" && (
          <>
            <div style={{ fontSize: "11px", color: "#8b949e" }}>Kis account ka repo access dena hai?</div>
            {accounts.map(acc => (
              <button key={acc.id} onClick={() => pickAccount(acc)} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px", background: "#0d1117", border: "1px solid #30363d", borderRadius: "8px", cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}>
                <div style={{ width: "28px", height: "28px", borderRadius: "50%", overflow: "hidden", background: "#30363d", flexShrink: 0 }}>{acc.avatar && <img src={acc.avatar} alt="" style={{ width: "100%", height: "100%" }} />}</div>
                <div style={{ fontSize: "12px", color: "#f0f6fc", fontWeight: 600 }}>{acc.label} <span style={{ color: "#6e7681", fontWeight: 400 }}>@{acc.login}</span></div>
              </button>
            ))}
          </>
        )}

        {step === "repo" && (
          <>
            <div style={{ fontSize: "11px", color: "#8b949e" }}>Kaunsa repo? — <strong style={{ color: "#f0f6fc" }}>{selectedAcc?.label}</strong></div>
            <input value={repoFilter} onChange={e => setRepoFilter(e.target.value)} placeholder="🔍 Repo search karo" style={{ background: "#0d1117", border: "1px solid #30363d", color: "#c9d1d9", borderRadius: "6px", padding: "9px 12px", fontSize: "12px", outline: "none", fontFamily: "inherit" }} />
            {reposLoading ? (
              <div style={{ fontSize: "12px", color: "#6e7681", textAlign: "center", padding: "16px" }}>Loading…</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "6px", maxHeight: "260px", overflowY: "auto" }}>
                {filteredRepos.map(r => (
                  <button key={r.id} onClick={() => pickRepo(r)} disabled={generating} style={{ textAlign: "left", padding: "9px 10px", background: "#0d1117", border: "1px solid #30363d", borderRadius: "6px", color: "#c9d1d9", fontSize: "12px", cursor: generating ? "not-allowed" : "pointer", fontFamily: "inherit" }}>
                    {r.private ? "🔒" : "📂"} {r.name}
                  </button>
                ))}
              </div>
            )}
            <button onClick={() => setStep("account")} style={{ background: "none", border: "none", color: "#6e7681", fontSize: "11px", cursor: "pointer", fontFamily: "inherit" }}>← Back</button>
          </>
        )}

        {step === "done" && link && (
          <>
            <div style={{ fontSize: "11px", color: "#8b949e" }}>Yeh URL do — GET request pe pura repo (code + files) JSON mein milega:</div>
            <div style={{ background: "#0d1117", border: "1px solid #30363d", borderRadius: "6px", padding: "9px 12px", fontSize: "11px", color: "#58a6ff", wordBreak: "break-all" }}>
              {origin}/api/agent/{link.token}
            </div>
            <button onClick={() => handleCopy(`${origin}/api/agent/${link.token}`)} style={{ padding: "9px", borderRadius: "6px", fontSize: "12px", fontFamily: "inherit", fontWeight: 600, cursor: "pointer", background: copied ? "#0d1f0d" : "#1f6feb", color: "#fff", border: "1px solid #388bfd" }}>
              {copied ? "✅ Copied" : "📋 Copy Link"}
            </button>
            <div style={{ fontSize: "10px", color: "#484f58" }}>Repo: {link.owner}/{link.repo} · Read-only · Revoke kabhi bhi ho sakta hai</div>
          </>
        )}

        {error && <div style={{ fontSize: "11px", color: "#f85149", textAlign: "center" }}>❌ {error}</div>}

        {existingLinks.length > 0 && step === "account" && (
          <>
            <div style={{ borderTop: "1px solid #21262d", paddingTop: "10px", fontSize: "11px", color: "#8b949e" }}>Active Agent Links:</div>
            {existingLinks.map(l => (
              <div key={l.token} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", padding: "8px 10px", background: "#0d1117", border: "1px solid #30363d", borderRadius: "6px" }}>
                <div style={{ fontSize: "11px", color: "#c9d1d9", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{l.owner}/{l.repo} <span style={{ color: "#6e7681" }}>({l.accountLabel})</span></div>
                <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
                  <button onClick={() => handleCopy(`${origin}/api/agent/${l.token}`)} style={{ background: "#21262d", border: "1px solid #30363d", color: "#58a6ff", borderRadius: "4px", padding: "4px 6px", fontSize: "10px", cursor: "pointer", fontFamily: "inherit" }}>📋</button>
                  <button onClick={() => handleRevoke(l.token)} style={{ background: "none", border: "1px solid #30363d", color: "#f85149", borderRadius: "4px", padding: "4px 6px", fontSize: "10px", cursor: "pointer", fontFamily: "inherit" }}>🗑️</button>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}


export function AccountsSkeleton() {
  const shimmer = {
    background: "linear-gradient(90deg, #161b22 25%, #21262d 37%, #161b22 63%)",
    backgroundSize: "400% 100%",
    animation: "ghpusher-shimmer 1.4s ease infinite",
    borderRadius: "6px",
  };
  return (
    <div style={{ minHeight: "100vh", background: "#0d1117", padding: "16px", fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}>
      <style>{`@keyframes ghpusher-shimmer { 0% { background-position: 100% 50%; } 100% { background-position: 0 50%; } }`}</style>
      <div style={{ ...shimmer, height: "20px", width: "55%", marginBottom: "18px" }} />
      <div style={{ ...shimmer, height: "44px", width: "100%", marginBottom: "12px" }} />
      <div style={{ ...shimmer, height: "120px", width: "100%", marginBottom: "12px" }} />
      <div style={{ ...shimmer, height: "44px", width: "70%", marginBottom: "8px" }} />
      <div style={{ ...shimmer, height: "44px", width: "85%" }} />
    </div>
  );
}

