"use client";

import { useState, useEffect } from "react";
import { updateRef } from "../../lib/github";
import { loadHistory, saveHistory } from "../../lib/storage";

export default function HistoryTab({ token }) {
  const [history, setHistory] = useState([]);
  const [filterRepo, setFilterRepo] = useState("");
  const [reverting, setReverting] = useState(null);
  const [msg, setMsg] = useState(null);

  useEffect(() => { setHistory(loadHistory()); }, []);

  const repos = Array.from(new Set(history.map(h => `${h.owner}/${h.repo}`))).sort();
  const filtered = filterRepo ? history.filter(h => `${h.owner}/${h.repo}` === filterRepo) : history;

  const handleRevert = async (h) => {
    if (!h.prevSha || !h.branch) return;
    setReverting(h.id); setMsg(null);
    try {
      await updateRef(h.owner, h.repo, h.branch, h.prevSha, token, true);
      setMsg({ ok: true, text: `✅ ${h.owner}/${h.repo}@${h.branch} revert ho gaya → ${h.prevSha.slice(0, 7)}` });
    } catch (e) {
      setMsg({ ok: false, text: `❌ ${e.message}` });
    } finally {
      setReverting(null);
    }
  };

  const handleClear = () => {
    saveHistory([]);
    setHistory([]);
  };

  const statusColor = { success: "#3fb950", "no-changes": "#6e7681", failed: "#f85149" };
  const statusLabel = { success: "✅ Success", "no-changes": "⏭️ No changes", failed: "❌ Failed" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: "11px", color: "#8b949e" }}>📜 {filtered.length} push record{filtered.length !== 1 ? "s" : ""}</div>
        {history.length > 0 && (
          <button onClick={handleClear} style={{ background: "none", border: "none", color: "#6e7681", cursor: "pointer", fontSize: "11px", fontFamily: "inherit" }}>🗑️ Clear history</button>
        )}
      </div>

      {repos.length > 1 && (
        <select value={filterRepo} onChange={e => setFilterRepo(e.target.value)} style={{ width: "100%", boxSizing: "border-box", background: "#161b22", border: "1px solid #30363d", color: "#c9d1d9", borderRadius: "6px", padding: "9px 12px", fontSize: "12px", outline: "none", fontFamily: "inherit" }}>
          <option value="">Sabhi repos</option>
          {repos.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      )}

      {msg && (
        <div style={{ padding: "10px 12px", borderRadius: "6px", fontSize: "11px", color: msg.ok ? "#3fb950" : "#f85149", background: msg.ok ? "#0d1f0d" : "#2d1416", border: `1px solid ${msg.ok ? "#2ea04344" : "#f8514944"}` }}>
          {msg.text}
        </div>
      )}

      {filtered.length === 0 && (
        <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: "8px", padding: "28px", textAlign: "center" }}>
          <div style={{ fontSize: "28px", marginBottom: "8px" }}>📜</div>
          <div style={{ fontSize: "12px", color: "#6e7681" }}>Abhi koi push history nahi hai</div>
        </div>
      )}

      {filtered.map(h => (
        <div key={h.id} style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: "8px", padding: "12px", display: "flex", flexDirection: "column", gap: "7px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: "12.5px", fontWeight: 700, color: "#f0f6fc", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.owner}/{h.repo}</div>
              <div style={{ fontSize: "10px", color: "#6e7681", marginTop: "1px" }}>{h.branch || "—"} · {h.source === "zip" ? "📦 ZIP" : "🗂️ Files"} · {new Date(h.timestamp).toLocaleString()}</div>
            </div>
            <span style={{ fontSize: "10px", fontWeight: 700, color: statusColor[h.status] || "#8b949e", whiteSpace: "nowrap", flexShrink: 0 }}>{statusLabel[h.status] || h.status}</span>
          </div>

          <div style={{ fontSize: "11px", color: "#8b949e", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>💬 {h.commitMsg}</div>

          {h.status === "success" && (
            <div style={{ display: "flex", gap: "10px", fontSize: "10.5px", color: "#6e7681" }}>
              <span style={{ color: "#3fb950" }}>🆕 {h.added}</span>
              <span style={{ color: "#e3b341" }}>✏️ {h.updated}</span>
              <span>⏭️ {h.skipped}</span>
              {h.newSha && <span>· <code>{h.newSha.slice(0, 7)}</code></span>}
            </div>
          )}
          {h.status === "failed" && h.error && (
            <div style={{ fontSize: "10.5px", color: "#f85149" }}>{h.error}</div>
          )}

          {h.status === "success" && h.prevSha && h.branch && (
            <button
              onClick={() => handleRevert(h)}
              disabled={reverting === h.id}
              style={{ alignSelf: "flex-start", background: "#21262d", border: "1px solid #30363d", color: "#e3b341", borderRadius: "6px", padding: "6px 10px", fontSize: "11px", cursor: reverting === h.id ? "not-allowed" : "pointer", fontFamily: "inherit", fontWeight: 600 }}
            >
              {reverting === h.id ? "⏳..." : `⏪ Is push se pehle wapas jao (${h.prevSha.slice(0, 7)})`}
            </button>
          )}
        </div>
      ))}

      <div style={{ fontSize: "10px", color: "#484f58", textAlign: "center", padding: "4px" }}>⚠️ Revert branch ko force-update karta hai — uske baad ke commits overwrite ho jaayenge.</div>
    </div>
  );
}
