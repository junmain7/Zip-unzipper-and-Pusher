"use client";

import { useState, useRef, useEffect } from "react";
import { fetchUserRepos, createRepo, getDefaultBranch, downloadRepoZip, updateRef } from "../../lib/github";
import { loadBackups, saveBackups } from "../../lib/storage";

export function RepoSelector({ token, selectedRepo, setSelectedRepo }) {
  const [repoMode, setRepoMode] = useState("existing");
  const [repos, setRepos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [showDrop, setShowDrop] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPrivate, setNewPrivate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadErr, setDownloadErr] = useState("");

  const loadRepos = async () => {
    setLoading(true);
    try { setRepos(await fetchUserRepos(token)); } catch {}
    finally { setLoading(false); }
  };

  useEffect(() => { if (token && repoMode === "existing") loadRepos(); }, [token, repoMode]);

  const filtered = repos.filter(r => r.name.toLowerCase().includes(search.toLowerCase()));

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const repo = await createRepo(newName.trim(), newPrivate, token);
      await loadRepos();
      setSelectedRepo(repo.full_name);
      setRepoMode("existing");
    } catch (e) { alert(e.message); }
    finally { setCreating(false); }
  };

  const handleDownload = async () => {
    if (!selectedRepo) return;
    const [owner, repo] = selectedRepo.split("/");
    setDownloading(true); setDownloadErr("");
    try {
      const branch = await getDefaultBranch(owner, repo, token);
      await downloadRepoZip(owner, repo, branch, token);
    } catch (e) { setDownloadErr(e.message); }
    finally { setDownloading(false); }
  };

  const inp = { width: "100%", boxSizing: "border-box", background: "#161b22", border: "1px solid #30363d", color: "#c9d1d9", borderRadius: "6px", padding: "9px 12px", fontSize: "12px", outline: "none", fontFamily: "inherit" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      <div style={{ display: "flex", gap: "8px" }}>
        {[["existing", "📂 Existing"], ["new", "➕ Nayi"]].map(([m, label]) => (
          <button key={m} onClick={() => setRepoMode(m)} style={{
            flex: 1, padding: "8px", borderRadius: "6px", fontSize: "12px", cursor: "pointer", fontFamily: "inherit", fontWeight: 600,
            background: repoMode === m ? (m === "existing" ? "#238636" : "#1f6feb") : "#161b22",
            color: repoMode === m ? "#fff" : "#8b949e",
            border: `1px solid ${repoMode === m ? (m === "existing" ? "#2ea043" : "#388bfd") : "#30363d"}`,
          }}>{label}</button>
        ))}
      </div>

      {repoMode === "existing" && (
        <div style={{ position: "relative" }}>
          <div onClick={() => setShowDrop(p => !p)} style={{ ...inp, cursor: "pointer", display: "flex", justifyContent: "space-between", color: selectedRepo ? "#c9d1d9" : "#6e7681" }}>
            <span>{selectedRepo || "— Repo choose karo —"}</span>
            <span style={{ color: "#6e7681" }}>{showDrop ? "▲" : "▼"}</span>
          </div>
          {showDrop && (
            <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 20, background: "#161b22", border: "1px solid #30363d", borderRadius: "6px", marginTop: "4px", maxHeight: "200px", overflowY: "auto" }}>
              <div style={{ padding: "6px" }}>
                <input autoFocus type="text" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} onClick={e => e.stopPropagation()}
                  style={{ ...inp, background: "#0d1117", padding: "6px 10px" }} />
              </div>
              {filtered.length === 0 && <div style={{ padding: "10px 12px", fontSize: "11px", color: "#6e7681" }}>{loading ? "Loading..." : "Koi repo nahi"}</div>}
              {filtered.map(r => (
                <div key={r.full_name} onClick={() => { setSelectedRepo(r.full_name); setShowDrop(false); setSearch(""); }}
                  style={{ padding: "9px 12px", fontSize: "12px", cursor: "pointer", background: selectedRepo === r.full_name ? "#1f2937" : "transparent", borderBottom: "1px solid #21262d", display: "flex", justifyContent: "space-between" }}>
                  <span>{r.name}</span>
                  <span style={{ fontSize: "10px", color: "#6e7681" }}>{r.private ? "🔒" : "🌐"}</span>
                </div>
              ))}
            </div>
          )}

          {selectedRepo && (
            <div style={{ marginTop: "8px" }}>
              <button onClick={handleDownload} disabled={downloading} style={{ width: "100%", padding: "8px", borderRadius: "6px", fontSize: "11.5px", fontWeight: 600, cursor: downloading ? "not-allowed" : "pointer", fontFamily: "inherit", background: "#0d1117", color: downloading ? "#6e7681" : "#58a6ff", border: "1px solid #30363d", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
                {downloading ? "⏳ Tayyar ho raha hai..." : "⬇️ Repo ko ZIP mein download karo"}
              </button>
              {downloadErr && <div style={{ fontSize: "10px", color: "#f85149", marginTop: "4px", textAlign: "center" }}>❌ {downloadErr}</div>}
            </div>
          )}
        </div>
      )}

      {repoMode === "new" && (
        <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: "8px", padding: "12px", display: "flex", flexDirection: "column", gap: "8px" }}>
          <input type="text" value={newName} onChange={e => setNewName(e.target.value.replace(/\s/g, "-"))} placeholder="repo-name" style={inp} />
          <div onClick={() => setNewPrivate(p => !p)} style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
            <div style={{ width: "32px", height: "18px", borderRadius: "9px", background: newPrivate ? "#1f6feb" : "#30363d", position: "relative" }}>
              <div style={{ position: "absolute", top: "2px", left: newPrivate ? "16px" : "2px", width: "14px", height: "14px", borderRadius: "50%", background: "#fff", transition: "left 0.2s" }} />
            </div>
            <span style={{ fontSize: "12px", color: "#c9d1d9" }}>{newPrivate ? "🔒 Private" : "🌐 Public"}</span>
          </div>
          <button onClick={handleCreate} disabled={creating || !newName.trim()} style={{ padding: "9px", borderRadius: "6px", fontSize: "12px", fontFamily: "inherit", fontWeight: 600, cursor: "pointer", background: creating || !newName.trim() ? "#0d1117" : "#1f6feb", color: creating || !newName.trim() ? "#6e7681" : "#fff", border: "1px solid #388bfd" }}>
            {creating ? "⏳ Ban rahi hai..." : "✅ Repo Banao"}
          </button>
        </div>
      )}
    </div>
  );
}

// Logs Panel
export function LogsPanel({ logs }) {
  const endRef = useRef();
  const colors = { info: "#c9d1d9", warn: "#e3b341", error: "#f85149", success: "#3fb950" };
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [logs]);
  if (!logs.length) return null;
  return (
    <div style={{ background: "#010409", border: "1px solid #21262d", borderRadius: "8px", padding: "12px", maxHeight: "260px", overflowY: "auto" }}>
      <div style={{ fontSize: "10px", color: "#6e7681", marginBottom: "8px" }}>📋 LOGS</div>
      {logs.map((l, i) => (
        <div key={i} style={{ fontSize: "11px", color: colors[l.type] || "#c9d1d9", marginBottom: "3px", lineHeight: 1.5 }}>
          <span style={{ color: "#484f58" }}>{l.time} </span>{l.msg}
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}

// Summary Card
export function SummaryCard({ summary }) {
  if (!summary) return null;
  return (
    <div style={{ background: "#0d1f0d", border: "1px solid #2ea04344", borderRadius: "8px", padding: "12px" }}>
      <div style={{ fontSize: "11px", color: "#3fb950", fontWeight: 700, marginBottom: "8px" }}>✅ Push Complete</div>
      <div style={{ display: "flex", gap: "12px" }}>
        {[["🆕", summary.added, "#3fb950", "Added"], ["✏️", summary.updated, "#e3b341", "Updated"], ["⏭️", summary.skipped, "#6e7681", "Skipped"]].map(([icon, count, color, label]) => (
          <div key={label} style={{ textAlign: "center", flex: 1 }}>
            <div style={{ fontSize: "22px", fontWeight: 700, color }}>{count}</div>
            <div style={{ fontSize: "10px", color: "#6e7681" }}>{icon} {label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Smart Diff Badge
export function DiffBadge() {
  return (
    <div style={{ background: "#0d2130", border: "1px solid #1f6feb33", borderRadius: "8px", padding: "9px 12px", fontSize: "11px", color: "#58a6ff", display: "flex", gap: "8px" }}>
      <span>🧠</span>
      <span><strong>Smart Diff ON</strong> — Sirf <span style={{ color: "#3fb950" }}>🆕 naye</span> aur <span style={{ color: "#e3b341" }}>✏️ changed</span> files push honge. Extra files safe.</span>
    </div>
  );
}

// Backup Toggle (shared across tabs)
export function BackupToggle({ enabled, setEnabled, onOpenRestorePoints, restoreCount }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 12px", background: "#161b22", border: "1px solid #30363d", borderRadius: "6px" }}>
      <div onClick={() => setEnabled(p => !p)} style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer", flex: 1 }}>
        <div style={{ width: "36px", height: "20px", borderRadius: "10px", background: enabled ? "#1f6feb" : "#30363d", position: "relative", flexShrink: 0 }}>
          <div style={{ position: "absolute", top: "3px", left: enabled ? "18px" : "3px", width: "14px", height: "14px", borderRadius: "50%", background: "#fff", transition: "left 0.2s" }} />
        </div>
        <div>
          <div style={{ fontSize: "12px", color: "#c9d1d9" }}>📦 Backup before push</div>
          <div style={{ fontSize: "10px", color: "#6e7681" }}>Push se pehle ka commit save hoga, baad mein revert kar sakte ho</div>
        </div>
      </div>
      <button onClick={onOpenRestorePoints} style={{ background: "#0d1117", border: "1px solid #30363d", borderRadius: "6px", padding: "7px 10px", fontSize: "11px", color: "#58a6ff", cursor: "pointer", fontFamily: "inherit", flexShrink: 0, whiteSpace: "nowrap" }}>
        🕐 Restore{restoreCount ? ` (${restoreCount})` : ""}
      </button>
    </div>
  );
}

// Restore Points Modal — revert a repo's branch back to a saved pre-push commit
export function RestorePointsModal({ onClose, owner, repo, token }) {
  const [backups, setBackups] = useState([]);
  const [reverting, setReverting] = useState(null);
  const [doneMsg, setDoneMsg] = useState("");
  const [errMsg, setErrMsg] = useState("");

  useEffect(() => {
    const all = loadBackups();
    setBackups(all.filter(b => b.owner === owner && b.repo === repo));
  }, [owner, repo]);

  const [confirmDelete, setConfirmDelete] = useState(null); // backup obj or "all"

  const handleRevert = async (b) => {
    setReverting(b.id); setDoneMsg(""); setErrMsg("");
    try {
      await updateRef(b.owner, b.repo, b.branch, b.sha, token, true);
      setDoneMsg(`✅ ${b.repo}@${b.branch} revert ho gaya → ${b.sha.slice(0, 7)}`);
    } catch (e) {
      setErrMsg(`❌ ${e.message}`);
    } finally {
      setReverting(null);
    }
  };

  const handleDelete = (b) => {
    const all = loadBackups().filter(x => x.id !== b.id);
    saveBackups(all);
    setBackups(all.filter(x => x.owner === owner && x.repo === repo));
    setConfirmDelete(null);
  };

  const handleClearAll = () => {
    const all = loadBackups().filter(x => !(x.owner === owner && x.repo === repo));
    saveBackups(all);
    setBackups([]);
    setConfirmDelete(null);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: "12px", width: "100%", maxWidth: "380px", maxHeight: "78vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", borderBottom: "1px solid #21262d", flexShrink: 0 }}>
          <div style={{ fontSize: "14px", fontWeight: 700, color: "#f0f6fc" }}>🕐 Restore Points</div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            {backups.length > 0 && (
              <button onClick={() => setConfirmDelete("all")} style={{ background: "none", border: "none", color: "#f85149", fontSize: "10.5px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
                Clear all
              </button>
            )}
            <button onClick={onClose} style={{ background: "none", border: "none", color: "#6e7681", fontSize: "18px", cursor: "pointer" }}>✕</button>
          </div>
        </div>

        {(doneMsg || errMsg) && (
          <div style={{ padding: "10px 16px", fontSize: "11px", color: doneMsg ? "#3fb950" : "#f85149", borderBottom: "1px solid #21262d" }}>{doneMsg || errMsg}</div>
        )}

        <div style={{ overflowY: "auto", flex: 1 }}>
          {backups.length === 0 && (
            <div style={{ padding: "28px 16px", textAlign: "center", fontSize: "12px", color: "#6e7681" }}>
              Is repo ke liye koi backup nahi hai.<br />"📦 Backup before push" on karke push karo.
            </div>
          )}
          {backups.map(b => (
            <div key={b.id} style={{ padding: "11px 16px", borderBottom: "1px solid #21262d", display: "flex", alignItems: "center", gap: "10px" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: "12px", color: "#f0f6fc", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.label || "Push"}</div>
                <div style={{ fontSize: "10px", color: "#6e7681", marginTop: "2px" }}>
                  {b.branch} · <code>{b.sha.slice(0, 7)}</code> · {new Date(b.timestamp).toLocaleString()}
                </div>
              </div>
              <button
                onClick={() => handleRevert(b)}
                disabled={reverting === b.id}
                style={{ background: "#21262d", border: "1px solid #30363d", color: "#e3b341", borderRadius: "6px", padding: "6px 10px", fontSize: "11px", cursor: reverting === b.id ? "not-allowed" : "pointer", fontFamily: "inherit", fontWeight: 600, flexShrink: 0 }}
              >
                {reverting === b.id ? "⏳..." : "⏪ Revert"}
              </button>
              <button
                onClick={() => setConfirmDelete(b)}
                disabled={reverting === b.id}
                title="Delete backup"
                style={{ background: "#21262d", border: "1px solid #30363d", color: "#f85149", borderRadius: "6px", padding: "6px 9px", fontSize: "11px", cursor: "pointer", fontFamily: "inherit", fontWeight: 600, flexShrink: 0 }}
              >
                🗑️
              </button>
            </div>
          ))}
        </div>
        <div style={{ padding: "9px 16px", fontSize: "10px", color: "#484f58", borderTop: "1px solid #21262d", flexShrink: 0 }}>
          ⚠️ Revert branch ko force-update karta hai — uske baad ke commits/pushes overwrite ho jaayenge.
        </div>
      </div>

      {confirmDelete && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 210, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }} onClick={() => setConfirmDelete(null)}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: "12px", width: "100%", maxWidth: "320px", padding: "18px", display: "flex", flexDirection: "column", gap: "12px" }}>
            <div style={{ fontSize: "14px", fontWeight: 700, color: "#f0f6fc" }}>🗑️ Delete {confirmDelete === "all" ? "all backups?" : "backup?"}</div>
            <div style={{ fontSize: "12px", color: "#8b949e", lineHeight: 1.5 }}>
              {confirmDelete === "all"
                ? `${repo} ke saare restore points permanently delete ho jaayenge. Yeh undo nahi ho sakta.`
                : `"${confirmDelete.label || "Push"}" (${confirmDelete.sha.slice(0, 7)}) delete ho jaayega. Yeh undo nahi ho sakta.`}
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              <button onClick={() => setConfirmDelete(null)} style={{ flex: 1, background: "#21262d", border: "1px solid #30363d", color: "#c9d1d9", borderRadius: "8px", padding: "9px", fontSize: "12.5px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
                Cancel
              </button>
              <button
                onClick={() => confirmDelete === "all" ? handleClearAll() : handleDelete(confirmDelete)}
                style={{ flex: 1, background: "#f85149", border: "none", color: "#fff", borderRadius: "8px", padding: "9px", fontSize: "12.5px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Confirm-before-push modal — prevents accidental push to wrong repo
export function ConfirmPushModal({ owner, repo, branch, fileCount, commitMsg, diffLoading, diffError, toPush, skipped, onConfirm, onCancel }) {
  const [filter, setFilter] = useState("");
  const added = (toPush || []).filter(f => f.fileStatus === "added");
  const updated = (toPush || []).filter(f => f.fileStatus === "updated");
  const filteredList = (toPush || []).filter(f => f.name.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }} onClick={onCancel}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: "12px", width: "100%", maxWidth: "440px", maxHeight: "85vh", padding: "18px", display: "flex", flexDirection: "column", gap: "12px", overflow: "hidden" }}>
        <div style={{ fontSize: "15px", fontWeight: 700, color: "#f0f6fc" }}>🚀 Push Confirm Karo</div>

        <div style={{ background: "#0d1117", border: "1px solid #21262d", borderRadius: "8px", padding: "12px", display: "flex", flexDirection: "column", gap: "6px" }}>
          <div style={{ fontSize: "12px", color: "#8b949e" }}>Repo: <span style={{ color: "#58a6ff", fontWeight: 700 }}>{owner}/{repo}</span></div>
          <div style={{ fontSize: "12px", color: "#8b949e" }}>Branch: <span style={{ color: "#3fb950", fontWeight: 700 }}>{branch || "(default)"}</span></div>
          <div style={{ fontSize: "12px", color: "#8b949e" }}>Commit: <span style={{ color: "#c9d1d9" }}>{commitMsg}</span></div>
        </div>

        {diffLoading && (
          <div style={{ fontSize: "12px", color: "#8b949e", padding: "10px", textAlign: "center" }}>⏳ Diff check ho raha hai — kaunsi file kahan jayegi, calculate kiya ja raha hai...</div>
        )}

        {diffError && (
          <div style={{ fontSize: "12px", color: "#f85149", background: "#3a1414", border: "1px solid #f8514955", borderRadius: "6px", padding: "10px" }}>❌ {diffError}</div>
        )}

        {!diffLoading && !diffError && toPush && (
          <>
            <div style={{ display: "flex", gap: "10px", fontSize: "11px" }}>
              <span style={{ color: "#3fb950", fontWeight: 700 }}>🆕 {added.length} naye</span>
              <span style={{ color: "#e3b341", fontWeight: 700 }}>✏️ {updated.length} updated</span>
              <span style={{ color: "#6e7681" }}>⏭️ {skipped} unchanged</span>
            </div>

            {toPush.length > 6 && (
              <input
                type="text" placeholder="🔍 Path se filter karo..." value={filter} onChange={e => setFilter(e.target.value)}
                style={{ width: "100%", boxSizing: "border-box", background: "#0d1117", border: "1px solid #30363d", color: "#c9d1d9", borderRadius: "6px", padding: "7px 10px", fontSize: "11px", outline: "none", fontFamily: "inherit" }}
              />
            )}

            <div style={{ border: "1px solid #21262d", borderRadius: "8px", overflowY: "auto", flex: 1, minHeight: 0 }}>
              {toPush.length === 0 ? (
                <div style={{ padding: "14px", fontSize: "12px", color: "#6e7681", textAlign: "center" }}>Koi changed file nahi — sab already up-to-date hai.</div>
              ) : filteredList.length === 0 ? (
                <div style={{ padding: "14px", fontSize: "12px", color: "#6e7681", textAlign: "center" }}>Filter se koi file match nahi hui.</div>
              ) : (
                filteredList.map((f, i) => {
                  const slash = f.name.lastIndexOf("/");
                  const dir = slash === -1 ? "(repo root)" : f.name.slice(0, slash);
                  const base = slash === -1 ? f.name : f.name.slice(slash + 1);
                  return (
                    <div key={f.name + i} style={{ padding: "7px 10px", borderBottom: "1px solid #21262d", display: "flex", alignItems: "flex-start", gap: "8px", fontSize: "11px" }}>
                      <span style={{ flexShrink: 0 }}>{f.fileStatus === "added" ? "🆕" : "✏️"}</span>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ color: "#c9d1d9", wordBreak: "break-all" }}>
                          <span style={{ color: "#6e7681" }}>{dir}/</span><span style={{ fontWeight: 700 }}>{base}</span>
                        </div>
                        <div style={{ color: f.fileStatus === "added" ? "#3fb950" : "#e3b341", fontSize: "9.5px", marginTop: "1px" }}>
                          {f.fileStatus === "added" ? "naya file — is location par add hoga" : "existing file — overwrite hoga"}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}

        <div style={{ fontSize: "10.5px", color: "#6e7681" }}>⚠️ Upar list mein har file ka exact path check kar lo — push hone ke baad GitHub par directly changes ho jaayenge.</div>
        <div style={{ display: "flex", gap: "8px" }}>
          <button onClick={onCancel} style={{ flex: 1, padding: "10px", borderRadius: "6px", fontSize: "12px", fontFamily: "inherit", fontWeight: 600, cursor: "pointer", background: "#0d1117", color: "#8b949e", border: "1px solid #30363d" }}>Cancel</button>
          <button onClick={onConfirm} disabled={diffLoading || !!diffError} style={{
            flex: 1, padding: "10px", borderRadius: "6px", fontSize: "12px", fontFamily: "inherit", fontWeight: 700,
            cursor: diffLoading || diffError ? "not-allowed" : "pointer",
            background: diffLoading || diffError ? "#161b22" : "#238636",
            color: diffLoading || diffError ? "#6e7681" : "#fff",
            border: "1px solid #2ea043",
          }}>✅ Haan, Push Karo</button>
        </div>
      </div>
    </div>
  );
}
