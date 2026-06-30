"use client";

import { useState, useRef, useEffect } from "react";
import { readFileAsArrayBuffer, parseZip, decompressFile, detectWrapperFolder, stripAllWrapperLevels, getWrapperChain, stripExactLevels } from "../../lib/zip";
import { smartPush, computeDiff, pushDiff, fetchRepoFolders } from "../../lib/github";
import { loadBackups, addHistoryEntry } from "../../lib/storage";
import { RepoSelector, LogsPanel, SummaryCard, DiffBadge, BackupToggle, RestorePointsModal, ConfirmPushModal } from "./PushShared";

export default function ZipTab({ token, selectedRepo, setSelectedRepo }) {
  const [zipFile, setZipFile] = useState(null);
  const [manualLevel, setManualLevel] = useState(null); // null = auto, number = user-chosen exact strip depth
  const [wrapperChain, setWrapperChain] = useState(null); // full possible nesting chain: [{name, fileCount}, ...]
  const [autoLevel, setAutoLevel] = useState(0); // auto-detected strip depth, used as default highlight
  const [rawZipFiles, setRawZipFiles] = useState(null); // parsed zip entries (names only) — used to compute root preview
  const [commitMsg, setCommitMsg] = useState("Smart diff update via ZIP pusher");
  const [logs, setLogs] = useState([]);
  const [status, setStatus] = useState("idle");
  const [summary, setSummary] = useState(null);
  const [backupEnabled, setBackupEnabled] = useState(false);
  const [showRestore, setShowRestore] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [pendingFiles, setPendingFiles] = useState(null);
  const [diff, setDiff] = useState(null); // { branch, latestSha, baseTreeSha, toPush, skipped }
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState("");
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
      // (jaise "Wrapper/RepoName/app/page.js") sahi se detect ho sakein.
      // Agar user ne manually exact level select kiya hai (chain se), to
      // wahi use karo — chahe auto-detect kuch bhi kahe. Warna auto-detect
      // (repo ke actual root folders se compare karke) khud decide karega.
      let decompressed;
      if (manualLevel !== null) {
        decompressed = stripExactLevels(rawDecompressed, manualLevel);
        log(manualLevel > 0 ? `📁 Manually ${manualLevel} level(s) strip kiye` : `📁 Manual: koi strip nahi kiya, paths as-is`);
      } else {
        const { files, levelsStripped, strippedFolderNames } = stripAllWrapperLevels(rawDecompressed, repoRootFolders);
        decompressed = files;
        if (levelsStripped > 0) log(`📁 ${levelsStripped} wrapper level(s) strip kiye: ${strippedFolderNames.join(" → ")}`);
      }


      log(`✅ ${decompressed.length} files ready — confirm karo`);
      setPendingFiles(decompressed);
      setStatus("idle");
      setShowConfirm(true);

      // Confirm modal khulte hi diff calculate karo, taaki har file ka exact
      // path + status (added/updated) confirm se pehle dikh sake.
      setDiff(null); setDiffError(""); setDiffLoading(true);
      try {
        const d = await computeDiff({ filesToProcess: decompressed, owner: parsed.owner, repo: parsed.repo, token, log });
        setDiff(d);
      } catch (e) { setDiffError(e.message); }
      finally { setDiffLoading(false); }
    } catch (e) { log(`❌ ${e.message}`, "error"); setStatus("error"); }
  };

  // Step 2: actually push, after confirm — same precomputed diff use hota hai
  // jo modal mein dikhaya gaya tha (with a fresh conflict check inside pushDiff).
  const handlePush = async () => {
    setShowConfirm(false);
    const parsed = getOwnerRepo();
    if (!parsed || !diff) return;

    setStatus("running"); setProgress(null);
    try {
      const result = await pushDiff({ owner: parsed.owner, repo: parsed.repo, ...diff, commitMsg, token, log, backupEnabled });
      setSummary({ ...result, skipped: diff.skipped });
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
          setManualLevel(null);
          setWrapperChain(null);
          setRawZipFiles(null);
          if (f) {
            try {
              const buffer = await readFileAsArrayBuffer(f);
              const rawFiles = parseZip(buffer);
              const names = rawFiles.map(rf => ({ name: rf.name }));
              setRawZipFiles(names);
              setWrapperChain(getWrapperChain(names));
              setAutoLevel(stripAllWrapperLevels(names, repoRootFolders).levelsStripped);
            } catch { setWrapperChain(null); }
          }
        }} />
      </div>

      <div style={{ padding: "10px 12px", background: "#161b22", border: "1px solid #30363d", borderRadius: "6px" }}>
        {!wrapperChain || !rawZipFiles ? (
          <div style={{ fontSize: "12px", color: "#6e7681" }}>📁 ZIP select karo — folder structure dikhega yahan</div>
        ) : (() => {
          const selectedLevel = manualLevel !== null ? manualLevel : autoLevel;
          const previewFiles = stripExactLevels(rawZipFiles, selectedLevel);
          const sampleRoots = [...new Set(previewFiles.map(f => f.name.split("/")[0]))].slice(0, 6);

          return (
            <div>
              <div style={{ fontSize: "11px", color: "#8b949e", marginBottom: "8px" }}>
                📂 Kahan tak strip karna hai, level choose karo {manualLevel === null && <span style={{ color: "#58a6ff" }}>(auto-selected)</span>}
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "10px" }}>
                {/* Level 0 = strip kuch nahi, as-is */}
                <button
                  onClick={() => setManualLevel(0)}
                  style={{
                    fontSize: "10.5px", padding: "6px 10px", borderRadius: "6px", cursor: "pointer", fontFamily: "inherit", fontWeight: 600,
                    background: selectedLevel === 0 ? "#1f6feb" : "#0d1117",
                    color: selectedLevel === 0 ? "#fff" : "#8b949e",
                    border: selectedLevel === 0 ? "1px solid #1f6feb" : "1px solid #30363d",
                  }}
                >
                  🚫 Strip nahi (root)
                </button>
                {wrapperChain.map((level, i) => {
                  const lvl = i + 1;
                  const isSelected = selectedLevel === lvl;
                  const isAutoDefault = manualLevel === null && autoLevel === lvl;
                  return (
                    <button
                      key={i}
                      onClick={() => setManualLevel(lvl)}
                      style={{
                        fontSize: "10.5px", padding: "6px 10px", borderRadius: "6px", cursor: "pointer", fontFamily: "inherit", fontWeight: 600,
                        background: isSelected ? "#1f6feb" : "#0d1117",
                        color: isSelected ? "#fff" : "#8b949e",
                        border: isSelected ? "1px solid #1f6feb" : (isAutoDefault ? "1px solid #58a6ff" : "1px solid #30363d"),
                      }}
                      title={`${level.fileCount} files is folder ke andar`}
                    >
                      {lvl}. {level.name}/
                    </button>
                  );
                })}
              </div>

              {manualLevel !== null && (
                <button
                  onClick={() => setManualLevel(null)}
                  style={{ fontSize: "10px", color: "#58a6ff", background: "transparent", border: "none", padding: "0 0 8px 0", cursor: "pointer", fontFamily: "inherit", textDecoration: "underline" }}
                >
                  ↺ Reset to auto ({autoLevel} level{autoLevel === 1 ? "" : "s"})
                </button>
              )}

              <div style={{ fontSize: "10px", color: "#3fb950" }}>
                📍 Is selection se sahi root milega: <span style={{ color: "#c9d1d9" }}>{sampleRoots.join(", ") || "(empty)"}</span>
              </div>
            </div>
          );
        })()}
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
          owner={parsed.owner} repo={parsed.repo} branch={diff?.branch || ""} fileCount={pendingFiles.length} commitMsg={commitMsg}
          diffLoading={diffLoading} diffError={diffError} toPush={diff?.toPush} skipped={diff?.skipped || 0}
          onConfirm={handlePush}
          onCancel={() => { setShowConfirm(false); setStatus("idle"); setDiff(null); setDiffError(""); }}
        />
      )}
    </div>
  );
}
