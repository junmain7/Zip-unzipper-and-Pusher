"use client";

import { useState, useRef, useEffect } from "react";
import { readFileAsArrayBuffer, parseZip, decompressFile, detectWrapperFolder, stripAllWrapperLevels } from "../../lib/zip";
import { smartPush, fetchRepoFolders } from "../../lib/github";
import { loadBackups, addHistoryEntry } from "../../lib/storage";
import { RepoSelector, LogsPanel, SummaryCard, DiffBadge, BackupToggle, RestorePointsModal, ConfirmPushModal } from "./PushShared";

export default function ZipTab({ token, selectedRepo, setSelectedRepo }) {
  const [zipFile, setZipFile] = useState(null);
  const [stripOverride, setStripOverride] = useState(null); // null = auto, true/false = manual override
  const [detectedWrapper, setDetectedWrapper] = useState(null); // null = not yet checked
  const [commitMsg, setCommitMsg] = useState("Smart diff update via ZIP pusher");
  const [logs, setLogs] = useState([]);
  const [status, setStatus] = useState("idle");
  const [summary, setSummary] = useState(null);
  const [backupEnabled, setBackupEnabled] = useState(false);
  const [showRestore, setShowRestore] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [pendingFiles, setPendingFiles] = useState(null);
  const [progress, setProgress] = useState(null); // { current, total }
  const [repoRootFolders, setRepoRootFolders] = useState(null); // GitHub se fetched actual root folder names — wrapper detection ko accurate banane ke liye
  const zipRef = useRef();

  const log = (msg, type = "info") => setLogs(prev => [...prev, { msg, type, time: new Date().toLocaleTimeString() }]);

  const getOwnerRepo = () => {
    if (!selectedRepo) return null;
    const parts = selectedRepo.split("/");
    return parts.length === 2 ? { owner: parts[0], repo: parts[1] } : null;
  };

  // Jab bhi repo select ho (ya badle), uske actual root-level folders fetch
  // karo — taaki ZIP ke top-level folder ko guess se nahi, balki repo ke
  // real structure se compare karke wrapper-folder decide kiya ja sake.
  useEffect(() => {
    const parsed = getOwnerRepo();
    if (!parsed || !token) { setRepoRootFolders(null); return; }
    let cancelled = false;
    fetchRepoFolders(parsed.owner, parsed.repo, token)
      .then(folders => {
        if (cancelled) return;
        const roots = folders.filter(f => f && !f.includes("/"));
        setRepoRootFolders(roots);
      })
      .catch(() => { if (!cancelled) setRepoRootFolders(null); }); // fail ho to fallback list use hogi
    return () => { cancelled = true; };
  }, [selectedRepo, token]);

  // Step 1: prepare files, show confirm modal
  const handlePushClick = async () => {
    const parsed = getOwnerRepo();
    if (!parsed) { log("⚠️ Repo select karo!", "error"); return; }
    if (!zipFile) { log("⚠️ ZIP file choose karo!", "error"); return; }

    setStatus("running"); setLogs([]); setSummary(null);
    try {
      log(`📦 ZIP read ho raha hai...`);
      const buffer = await readFileAsArrayBuffer(zipFile);
      const rawFiles = parseZip(buffer);
      log(`✅ ${rawFiles.length} files mili`);

      const wrapperDetected = detectWrapperFolder(rawFiles, repoRootFolders);
      log(wrapperDetected ? `📁 Wrapper folder detected — strip kar raha hai` : `📁 Koi wrapper folder nahi — paths as-is rahenge`);

      log(`🔓 Decompress ho rahi hain...`);
      const rawDecompressed = [];
      for (const f of rawFiles) {
        try {
          const data = await decompressFile(f);
          if (f.name) rawDecompressed.push({ name: f.name, data });
        } catch (e) { log(`⚠️ Skip: ${f.name} — ${e.message}`, "warn"); }
      }

      // Strip karne se pehle decompress kiya — taaki nested wrapper levels
      // (jaise "Wrapper/RepoName/app/page.js") sahi se detect ho sakein,
      // ek se zyada level strip karne ki zaroorat ho to woh bhi ho jaaye.
      let decompressed;
      if (stripOverride === false) {
        decompressed = rawDecompressed; // manual override: strip mat karo
      } else if (stripOverride === true) {
        // manual override: kam se kam ek level zaroor strip karo, phir
        // baaki nested levels auto-detect se strip ho jaayenge
        const onceStripped = rawDecompressed
          .map(f => { const s = f.name.indexOf("/"); return s !== -1 ? { ...f, name: f.name.slice(s + 1) } : f; })
          .filter(f => f.name);
        const { files, levelsStripped } = stripAllWrapperLevels(onceStripped, repoRootFolders);
        decompressed = files;
        if (levelsStripped > 0) log(`📁 ${levelsStripped} aur nested wrapper level(s) bhi strip kiye`);
      } else {
        const { files, levelsStripped } = stripAllWrapperLevels(rawDecompressed, repoRootFolders);
        decompressed = files;
        if (levelsStripped > 1) log(`📁 ${levelsStripped} nested wrapper levels strip kiye`);
      }

      log(`✅ ${decompressed.length} files ready — confirm karo`);
      setPendingFiles(decompressed);
      setStatus("idle");
      setShowConfirm(true);
    } catch (e) { log(`❌ ${e.message}`, "error"); setStatus("error"); }
  };

  // Step 2: actually push, after confirm
  const handlePush = async () => {
    setShowConfirm(false);
    const parsed = getOwnerRepo();
    const decompressed = pendingFiles;
    if (!parsed || !decompressed) return;

    setStatus("running"); setProgress(null);
    try {
      const result = await smartPush({ filesToProcess: decompressed, ...parsed, token, commitMsg, log, backupEnabled });
      setSummary(result);
      setStatus("done");
      addHistoryEntry({
        owner: parsed.owner, repo: parsed.repo, branch: result.branch, commitMsg, source: "zip",
        prevSha: result.prevSha, newSha: result.newSha,
        added: result.added, updated: result.updated, skipped: result.skipped,
        status: result.newSha ? "success" : "no-changes",
      });
    } catch (e) {
      log(`❌ ${e.message}`, "error"); setStatus("error");
      addHistoryEntry({ owner: parsed.owner, repo: parsed.repo, branch: "", commitMsg, source: "zip", status: "failed", error: e.message });
    }
  };

  const isRunning = status === "running";
  const inp = { width: "100%", boxSizing: "border-box", background: "#161b22", border: "1px solid #30363d", color: "#c9d1d9", borderRadius: "6px", padding: "9px 12px", fontSize: "12px", outline: "none", fontFamily: "inherit" };
  const parsed = getOwnerRepo();
  const repoBackupCount = parsed ? loadBackups().filter(b => b.owner === parsed.owner && b.repo === parsed.repo).length : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <RepoSelector token={token} selectedRepo={selectedRepo} setSelectedRepo={setSelectedRepo} />

      <div>
        <div style={{ fontSize: "11px", color: "#8b949e", marginBottom: "5px" }}>💬 Commit Message</div>
        <input type="text" value={commitMsg} onChange={e => setCommitMsg(e.target.value)} style={inp} />
      </div>

      <div>
        <div style={{ fontSize: "11px", color: "#8b949e", marginBottom: "5px" }}>📦 ZIP File</div>
        <div onClick={() => zipRef.current?.click()} style={{ border: "2px dashed", borderColor: zipFile ? "#238636" : "#30363d", borderRadius: "8px", padding: "24px", textAlign: "center", cursor: "pointer", background: zipFile ? "#0d2130" : "#0d1117" }}>
          <div style={{ fontSize: "28px", marginBottom: "6px" }}>{zipFile ? "✅" : "📂"}</div>
          <div style={{ fontSize: "12px", color: zipFile ? "#3fb950" : "#8b949e" }}>{zipFile ? zipFile.name : "ZIP file select karo ya drop karo"}</div>
          {zipFile && <div style={{ fontSize: "10px", color: "#6e7681", marginTop: "4px" }}>{(zipFile.size / 1024).toFixed(1)} KB</div>}
        </div>
        <input ref={zipRef} type="file" accept=".zip" style={{ display: "none" }} onChange={async e => {
          const f = e.target.files[0] || null;
          setZipFile(f);
          setStripOverride(null);
          setDetectedWrapper(null);
          if (f) {
            try {
              const buffer = await readFileAsArrayBuffer(f);
              const rawFiles = parseZip(buffer);
              setDetectedWrapper(detectWrapperFolder(rawFiles, repoRootFolders));
            } catch { setDetectedWrapper(null); }
          }
        }} />
      </div>

      <div style={{ padding: "10px 12px", background: "#161b22", border: "1px solid #30363d", borderRadius: "6px" }}>
        {detectedWrapper === null ? (
          <div style={{ fontSize: "12px", color: "#6e7681" }}>📁 ZIP select karo — wrapper folder auto-detect ho jayega</div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
            <div>
              <div style={{ fontSize: "12px", color: "#c9d1d9" }}>
                {detectedWrapper ? "✅ Wrapper folder mila — auto-strip hoga" : "✅ Koi wrapper folder nahi — paths as-is rahenge"}
              </div>
              <div style={{ fontSize: "10px", color: "#6e7681" }}>
                {stripOverride === null ? "Auto-detected" : `Manual override: ${stripOverride ? "strip karo" : "strip mat karo"}`}
              </div>
            </div>
            <button
              onClick={() => setStripOverride(p => p === null ? !detectedWrapper : null)}
              style={{ fontSize: "10px", color: "#58a6ff", background: "transparent", border: "1px solid #30363d", borderRadius: "5px", padding: "5px 8px", cursor: "pointer", fontFamily: "inherit" }}
            >
              {stripOverride === null ? "Override" : "Reset to auto"}
            </button>
          </div>
        )}
      </div>

      <BackupToggle enabled={backupEnabled} setEnabled={setBackupEnabled} onOpenRestorePoints={() => setShowRestore(true)} restoreCount={repoBackupCount} />


      <DiffBadge />

      <button onClick={handlePushClick} disabled={isRunning || !selectedRepo || !zipFile} style={{
        width: "100%", padding: "14px", borderRadius: "8px", fontSize: "14px", fontWeight: 700, cursor: isRunning || !selectedRepo || !zipFile ? "not-allowed" : "pointer", fontFamily: "inherit",
        background: isRunning || !selectedRepo || !zipFile ? "#161b22" : "#238636",
        color: isRunning || !selectedRepo || !zipFile ? "#6e7681" : "#fff",
        border: "1px solid #2ea043",
      }}>
        {isRunning ? "⏳ Tayyar ho raha hai..." : "🚀 ZIP Smart Push Karo"}
      </button>

      <SummaryCard summary={summary} />
      <LogsPanel logs={logs} />

      {showRestore && parsed && (
        <RestorePointsModal onClose={() => setShowRestore(false)} owner={parsed.owner} repo={parsed.repo} token={token} />
      )}

      {showConfirm && parsed && pendingFiles && (
        <ConfirmPushModal
          owner={parsed.owner} repo={parsed.repo} branch="" fileCount={pendingFiles.length} commitMsg={commitMsg}
          onConfirm={handlePush} onCancel={() => { setShowConfirm(false); setStatus("idle"); }}
        />
      )}
    </div>
  );
}
