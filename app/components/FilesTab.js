"use client";

import { useState, useRef } from "react";
import { readFileAsUint8, autoConvertPath } from "../../lib/zip";
import { smartPush, computeDiff, pushDiff, fetchRepoFolders } from "../../lib/github";
import { loadBackups, addHistoryEntry } from "../../lib/storage";
import { RepoSelector, LogsPanel, SummaryCard, DiffBadge, BackupToggle, RestorePointsModal, ConfirmPushModal, generateAICommitMessage } from "./PushShared";

export default function FilesTab({ token, selectedRepo, setSelectedRepo }) {
  const [indivFiles, setIndivFiles] = useState([]);
  const [commitMsg, setCommitMsg] = useState("File update via pusher");
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiError, setAiError] = useState("");
  const [logs, setLogs] = useState([]);
  const [status, setStatus] = useState("idle");
  const [summary, setSummary] = useState(null);
  const [backupEnabled, setBackupEnabled] = useState(false);
  const [showRestore, setShowRestore] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [diff, setDiff] = useState(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState("");
  const [repoFolders, setRepoFolders] = useState([]);
  const [foldersLoading, setFoldersLoading] = useState(false);
  const [foldersError, setFoldersError] = useState("");
  const filesRef = useRef();

  const log = (msg, type = "info") => setLogs(prev => [...prev, { msg, type, time: new Date().toLocaleTimeString() }]);

  const getOwnerRepo = () => {
    if (!selectedRepo) return null;
    const parts = selectedRepo.split("/");
    return parts.length === 2 ? { owner: parts[0], repo: parts[1] } : null;
  };

  const handleFilesAdd = (e) => {
    const newFiles = Array.from(e.target.files || []);
    const entries = newFiles.map(f => ({
      id: Math.random().toString(36).slice(2),
      file: f,
      repoPath: autoConvertPath(f.name),
    }));
    setIndivFiles(prev => [...prev, ...entries]);
    e.target.value = "";
  };

  // Selected files ko actual binary data mein read karta hai — push flow aur
  // AI commit-message dono isi ko use karte hain.
  const readSelectedFiles = async () => {
    const processed = [];
    for (const { file, repoPath } of indivFiles) {
      const data = await readFileAsUint8(file);
      processed.push({ name: repoPath.trim(), data });
    }
    return processed;
  };

  const handlePushClick = async () => {
    const parsed = getOwnerRepo();
    if (!parsed) { log("⚠️ Repo select karo!", "error"); return; }
    if (!indivFiles.length) { log("⚠️ Koi file select nahi!", "error"); return; }
    const emptyPath = indivFiles.find(f => !f.repoPath.trim());
    if (emptyPath) { log(`⚠️ "${emptyPath.file.name}" ka path empty hai!`, "error"); return; }

    setShowConfirm(true);
    setDiff(null); setDiffError(""); setDiffLoading(true);
    try {
      const processed = await readSelectedFiles();
      const d = await computeDiff({ filesToProcess: processed, owner: parsed.owner, repo: parsed.repo, token, log });
      setDiff(d);
    } catch (e) { setDiffError(e.message); }
    finally { setDiffLoading(false); }
  };

  // Select ki hui files ko repo se compare karke Groq se ek commit message
  // banwata hai — seedha commit box mein set ho jaata hai.
  const handleGenerateCommitMsg = async () => {
    const parsed = getOwnerRepo();
    if (!parsed) { setAiError("Repo select karo!"); return; }
    if (!indivFiles.length) { setAiError("Koi file select nahi!"); return; }
    const emptyPath = indivFiles.find(f => !f.repoPath.trim());
    if (emptyPath) { setAiError(`"${emptyPath.file.name}" ka path empty hai!`); return; }
    if (aiGenerating) return;

    setAiGenerating(true); setAiError("");
    try {
      const processed = await readSelectedFiles();
      const d = await computeDiff({ filesToProcess: processed, owner: parsed.owner, repo: parsed.repo, token, log });
      if (!d.toPush || !d.toPush.length) { setAiError("Koi changed file nahi mili"); return; }
      const msg = await generateAICommitMessage(d.toPush);
      setCommitMsg(msg);
    } catch (e) {
      setAiError(e.message);
    } finally {
      setAiGenerating(false);
    }
  };

  const handlePush = async () => {
    setShowConfirm(false);
    const parsed = getOwnerRepo();
    if (!parsed || !diff) return;

    setStatus("running"); setLogs([]); setSummary(null);
    try {
      const result = await pushDiff({ owner: parsed.owner, repo: parsed.repo, ...diff, commitMsg, token, log, backupEnabled });
      setSummary({ ...result, skipped: diff.skipped });
      setStatus("done");
      addHistoryEntry({
        owner: parsed.owner, repo: parsed.repo, branch: result.branch, commitMsg, source: "files",
        prevSha: result.prevSha, newSha: result.newSha,
        added: result.added, updated: result.updated, skipped: result.skipped,
        status: result.newSha ? "success" : "no-changes",
      });
    } catch (e) {
      log(`❌ ${e.message}`, "error"); setStatus("error");
      addHistoryEntry({ owner: parsed.owner, repo: parsed.repo, branch: "", commitMsg, source: "files", status: "failed", error: e.message });
    }
  };

  const isRunning = status === "running";
  const inp = { width: "100%", boxSizing: "border-box", background: "#161b22", border: "1px solid #30363d", color: "#c9d1d9", borderRadius: "6px", padding: "9px 12px", fontSize: "12px", outline: "none", fontFamily: "inherit" };
  const parsedRepo = getOwnerRepo();
  const repoBackupCount = parsedRepo ? loadBackups().filter(b => b.owner === parsedRepo.owner && b.repo === parsedRepo.repo).length : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <RepoSelector token={token} selectedRepo={selectedRepo} setSelectedRepo={setSelectedRepo} />

      {parsedRepo && (
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button
            onClick={async () => {
              setFoldersLoading(true); setFoldersError("");
              try { setRepoFolders(await fetchRepoFolders(parsedRepo.owner, parsedRepo.repo, token)); }
              catch (e) { setFoldersError(e.message); }
              setFoldersLoading(false);
            }}
            disabled={foldersLoading}
            style={{ background: "#161b22", border: "1px solid #30363d", color: "#a371f7", borderRadius: "6px", padding: "6px 10px", fontSize: "11px", cursor: foldersLoading ? "not-allowed" : "pointer", fontFamily: "inherit", fontWeight: 600 }}
          >
            {foldersLoading ? "⏳ Locations load ho rahi..." : repoFolders.length ? "🔄 Locations refresh karo" : "📂 Repo ki locations load karo"}
          </button>
          {repoFolders.length > 0 && !foldersLoading && (
            <span style={{ fontSize: "10px", color: "#6e7681" }}>{repoFolders.length} folders mile</span>
          )}
        </div>
      )}
      {foldersError && <div style={{ fontSize: "11px", color: "#f85149" }}>⚠️ {foldersError}</div>}

      <div>
        <div style={{ fontSize: "11px", color: "#8b949e", marginBottom: "5px" }}>💬 Commit Message</div>
        <div style={{ display: "flex", gap: "6px" }}>
          <input type="text" value={commitMsg} onChange={e => setCommitMsg(e.target.value)} style={{ ...inp, flex: 1 }} />
          <button
            onClick={handleGenerateCommitMsg}
            disabled={aiGenerating || !selectedRepo || !indivFiles.length}
            title="AI se commit message banao"
            style={{
              background: "#161b22", border: "1px solid #30363d",
              color: aiGenerating || !selectedRepo || !indivFiles.length ? "#484f58" : "#a371f7",
              borderRadius: "6px", padding: "9px 12px", fontSize: "13px",
              cursor: aiGenerating || !selectedRepo || !indivFiles.length ? "not-allowed" : "pointer",
              fontFamily: "inherit", flexShrink: 0,
            }}
          >
            {aiGenerating ? "⏳" : "✨"}
          </button>
        </div>
        {aiError && <div style={{ fontSize: "10.5px", color: "#f85149", marginTop: "4px" }}>❌ {aiError}</div>}
      </div>

      {/* Convention info */}
      <div style={{ background: "#1a1228", border: "1px solid #6e40c933", borderRadius: "8px", padding: "10px 14px", fontSize: "11px", color: "#a371f7" }}>
        <div style={{ fontWeight: 700, marginBottom: "4px" }}>✨ Auto Path Convention</div>
        <div style={{ color: "#6e7681", lineHeight: 1.8 }}>
          <code style={{ color: "#c9d1d9" }}>members-page.js</code> → <code style={{ color: "#3fb950" }}>members/page.js</code><br />
          <code style={{ color: "#c9d1d9" }}>api-auth-route.js</code> → <code style={{ color: "#3fb950" }}>api/auth/route.js</code><br />
          <code style={{ color: "#c9d1d9" }}>layout.js</code> → <code style={{ color: "#3fb950" }}>layout.js</code>
        </div>
        <div style={{ color: "#484f58", marginTop: "4px" }}>Path manually bhi edit kar sakte ho ✏️</div>
      </div>

      {/* Add files */}
      <div onClick={() => filesRef.current?.click()} style={{ border: "2px dashed #30363d", borderRadius: "8px", padding: "20px", textAlign: "center", cursor: "pointer", background: "#0d1117" }}>
        <div style={{ fontSize: "24px", marginBottom: "4px" }}>➕</div>
        <div style={{ fontSize: "12px", color: "#8b949e" }}>Files add karo (multiple select ho sakti hain)</div>
        <div style={{ fontSize: "10px", color: "#484f58", marginTop: "3px" }}>Koi bhi file type — .js .ts .css .json etc.</div>
      </div>
      <input ref={filesRef} type="file" multiple style={{ display: "none" }} onChange={handleFilesAdd} />

      {/* Files list */}
      {indivFiles.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "11px", color: "#8b949e" }}>📋 {indivFiles.length} file{indivFiles.length > 1 ? "s" : ""} ready</span>
            <button onClick={() => setIndivFiles([])} style={{ background: "none", border: "none", color: "#6e7681", cursor: "pointer", fontSize: "11px", fontFamily: "inherit" }}>🗑️ Clear all</button>
          </div>
          {indivFiles.map(({ id, file, repoPath }) => (
            <div key={id} style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: "8px", padding: "10px 12px", display: "flex", flexDirection: "column", gap: "6px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: "11px", color: "#8b949e" }}>
                  📄 <span style={{ color: "#c9d1d9" }}>{file.name}</span>
                  <span style={{ color: "#484f58" }}> ({(file.size / 1024).toFixed(1)} KB)</span>
                </span>
                <button onClick={() => setIndivFiles(prev => prev.filter(f => f.id !== id))}
                  style={{ background: "none", border: "none", color: "#f85149", cursor: "pointer", fontSize: "16px", lineHeight: 1, padding: "0 2px" }}>✕</button>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span style={{ fontSize: "10px", color: "#6e7681", flexShrink: 0 }}>→ repo:</span>
                <input
                  type="text"
                  value={repoPath}
                  onChange={e => setIndivFiles(prev => prev.map(f => f.id === id ? { ...f, repoPath: e.target.value } : f))}
                  style={{ ...inp, padding: "5px 8px", fontSize: "11px", flex: 1, background: "#0d1117", borderColor: repoPath.trim() ? "#30363d" : "#f85149" }}
                  placeholder="app/members/page.js"
                />
              </div>
              {repoFolders.length > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span style={{ fontSize: "10px", color: "#6e7681", flexShrink: 0 }}>📂 location:</span>
                  <select
                    value=""
                    onChange={e => {
                      const val = e.target.value;
                      if (!val) return; // placeholder selected, ignore
                      const folder = val === "__ROOT__" ? "" : val;
                      const baseName = repoPath.includes("/") ? repoPath.slice(repoPath.lastIndexOf("/") + 1) : repoPath;
                      const newPath = folder ? `${folder}/${baseName}` : baseName;
                      setIndivFiles(prev => prev.map(f => f.id === id ? { ...f, repoPath: newPath } : f));
                    }}
                    style={{ ...inp, padding: "5px 8px", fontSize: "11px", flex: 1, background: "#0d1117" }}
                  >
                    <option value="" disabled>-- repo mein existing folder chuno --</option>
                    <option value="__ROOT__">/ (repo root)</option>
                    {repoFolders.filter(f => f !== "").map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <BackupToggle enabled={backupEnabled} setEnabled={setBackupEnabled} onOpenRestorePoints={() => setShowRestore(true)} restoreCount={repoBackupCount} />


      <DiffBadge />

      <button onClick={handlePushClick} disabled={isRunning || !selectedRepo || !indivFiles.length} style={{
        width: "100%", padding: "14px", borderRadius: "8px", fontSize: "14px", fontWeight: 700, cursor: isRunning || !selectedRepo || !indivFiles.length ? "not-allowed" : "pointer", fontFamily: "inherit",
        background: isRunning || !selectedRepo || !indivFiles.length ? "#161b22" : "#6e40c9",
        color: isRunning || !selectedRepo || !indivFiles.length ? "#6e7681" : "#fff",
        border: "1px solid #8957e5",
      }}>
        {isRunning ? "⏳ Push ho raha hai..." : `🚀 ${indivFiles.length ? `${indivFiles.length} File${indivFiles.length > 1 ? "s" : ""}` : "Files"} Push Karo`}
      </button>

      <SummaryCard summary={summary} />
      <LogsPanel logs={logs} />

      {showRestore && parsedRepo && (
        <RestorePointsModal onClose={() => setShowRestore(false)} owner={parsedRepo.owner} repo={parsedRepo.repo} token={token} />
      )}

      {showConfirm && parsedRepo && (
        <ConfirmPushModal
          owner={parsedRepo.owner} repo={parsedRepo.repo} branch={diff?.branch || ""} fileCount={indivFiles.length} commitMsg={commitMsg}
          diffLoading={diffLoading} diffError={diffError} toPush={diff?.toPush} skipped={diff?.skipped || 0}
          onConfirm={handlePush}
          onCancel={() => { setShowConfirm(false); setDiff(null); setDiffError(""); }}
        />
      )}
    </div>
  );
}
