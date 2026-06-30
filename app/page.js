"use client";

import { useState, useRef, useEffect } from "react";
import { useSession, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";

const GITHUB_API = "https://api.github.com";

// ── Accounts Storage Helpers ──────────────────────────────
const ACCOUNTS_KEY = "ghpusher_accounts";
const ACTIVE_KEY = "ghpusher_active";
function loadAccounts() { try { return JSON.parse(localStorage.getItem(ACCOUNTS_KEY) || "[]"); } catch { return []; } }
function saveAccounts(a) { localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(a)); }
function loadActiveId() { return localStorage.getItem(ACTIVE_KEY) || null; }
function saveActiveId(id) { if (id) localStorage.setItem(ACTIVE_KEY, id); else localStorage.removeItem(ACTIVE_KEY); }
function maskPat(pat) { if (!pat || pat.length < 8) return "••••••••"; return pat.slice(0, 4) + "••••••" + pat.slice(-4); }

// ── Backup / Restore-point Storage ────────────────────────
const BACKUPS_KEY = "ghpusher_backups";
function loadBackups() { try { return JSON.parse(localStorage.getItem(BACKUPS_KEY) || "[]"); } catch { return []; } }
function saveBackups(b) { localStorage.setItem(BACKUPS_KEY, JSON.stringify(b)); }
function addBackup(record) {
  const all = loadBackups();
  all.unshift({ id: Math.random().toString(36).slice(2), ...record });
  // keep only last 8 restore points per owner/repo/branch to avoid bloat
  const key = `${record.owner}/${record.repo}@${record.branch}`;
  let countForKey = 0;
  const trimmed = all.filter(b => {
    const k = `${b.owner}/${b.repo}@${b.branch}`;
    if (k !== key) return true;
    countForKey++;
    return countForKey <= 8;
  });
  saveBackups(trimmed);
  return trimmed;
}


// ── Push History Storage (records EVERY push attempt, success or fail) ────
const HISTORY_KEY = "ghpusher_history";
function loadHistory() { try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); } catch { return []; } }
function saveHistory(h) { localStorage.setItem(HISTORY_KEY, JSON.stringify(h)); }
function addHistoryEntry(record) {
  const all = loadHistory();
  all.unshift({ id: Math.random().toString(36).slice(2), timestamp: Date.now(), ...record });
  const trimmed = all.slice(0, 100); // keep last 100 entries total
  saveHistory(trimmed);
  return trimmed;
}

// ── Vercel Integration Config (per owner/repo) ─────────────────────────
const VERCEL_KEY = "ghpusher_vercel_cfg";
function loadVercelConfigs() { try { return JSON.parse(localStorage.getItem(VERCEL_KEY) || "{}"); } catch { return {}; } }
function saveVercelConfigs(c) { localStorage.setItem(VERCEL_KEY, JSON.stringify(c)); }
function getVercelConfig(owner, repo) { return loadVercelConfigs()[`${owner}/${repo}`] || null; }
function setVercelConfig(owner, repo, cfg) {
  const all = loadVercelConfigs();
  all[`${owner}/${repo}`] = cfg;
  saveVercelConfigs(all);
}

function uint8ToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

async function readFileAsArrayBuffer(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsArrayBuffer(file);
  });
}

async function readFileAsUint8(file) {
  return new Uint8Array(await readFileAsArrayBuffer(file));
}

async function computeGitBlobSha(uint8) {
  const header = new TextEncoder().encode(`blob ${uint8.byteLength}\0`);
  const combined = new Uint8Array(header.length + uint8.length);
  combined.set(header, 0);
  combined.set(uint8, header.length);
  const hashBuffer = await crypto.subtle.digest("SHA-1", combined);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// "members-page.js" → "members/page.js"
// "api-auth-route.js" → "api/auth/route.js"
function autoConvertPath(filename) {
  const dotIdx = filename.lastIndexOf(".");
  const ext = dotIdx !== -1 ? filename.slice(dotIdx) : "";
  const base = dotIdx !== -1 ? filename.slice(0, dotIdx) : filename;
  return base.replace(/-/g, "/") + ext;
}

// ── ZIP Parser ────────────────────────────────────────────
function parseZip(buffer) {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const files = [];
  let offset = 0;
  while (offset < bytes.length - 4) {
    const sig = view.getUint32(offset, true);
    if (sig !== 0x04034b50) break;
    const compression = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const fileNameLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);
    const name = new TextDecoder().decode(bytes.slice(offset + 30, offset + 30 + fileNameLen));
    const dataOffset = offset + 30 + fileNameLen + extraLen;
    const compressedData = bytes.slice(dataOffset, dataOffset + compressedSize);
    if (!name.endsWith("/")) files.push({ name, compressedData, compression, compressedSize });
    offset = dataOffset + compressedSize;
  }
  return files;
}

async function decompressFile(file) {
  if (file.compression === 0) return file.compressedData;
  if (file.compression === 8) {
    const ds = new DecompressionStream("deflate-raw");
    const writer = ds.writable.getWriter();
    const reader = ds.readable.getReader();
    writer.write(file.compressedData);
    writer.close();
    const chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const total = chunks.reduce((s, c) => s + c.length, 0);
    const result = new Uint8Array(total);
    let pos = 0;
    for (const chunk of chunks) { result.set(chunk, pos); pos += chunk.length; }
    return result;
  }
  throw new Error(`Unsupported compression: ${file.compression}`);
}

// ── GitHub API ────────────────────────────────────────────
async function fetchUserRepos(token) {
  const repos = [];
  let page = 1;
  while (true) {
    const res = await fetch(`${GITHUB_API}/user/repos?per_page=100&page=${page}&sort=updated&affiliation=owner`, {
      headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json" },
    });
    if (!res.ok) throw new Error("Repos fetch nahi hua");
    const data = await res.json();
    if (!data.length) break;
    repos.push(...data);
    if (data.length < 100) break;
    page++;
  }
  return repos;
}

async function createRepo(name, isPrivate, token) {
  const res = await fetch(`${GITHUB_API}/user/repos`, {
    method: "POST",
    headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json", "Content-Type": "application/json" },
    body: JSON.stringify({ name, private: isPrivate, auto_init: true }),
  });
  if (!res.ok) { const e = await res.json(); throw new Error(e.message || "Repo create nahi hua"); }
  return res.json();
}

async function getDefaultBranch(owner, repo, token) {
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}`, {
    headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json" },
  });
  if (!res.ok) throw new Error(`Repo not found: ${res.status}`);
  return (await res.json()).default_branch;
}

async function getLatestCommitSha(owner, repo, branch, token) {
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/git/ref/heads/${branch}`, {
    headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json" },
  });
  if (!res.ok) throw new Error(`Branch not found: ${res.status}`);
  return (await res.json()).object.sha;
}

async function getTreeSha(owner, repo, commitSha, token) {
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/git/commits/${commitSha}`, {
    headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json" },
  });
  return (await res.json()).tree.sha;
}

async function fetchRepoTree(owner, repo, treeSha, token) {
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/git/trees/${treeSha}?recursive=1`, {
    headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json" },
  });
  if (!res.ok) throw new Error(`Tree fetch error: ${res.status}`);
  const data = await res.json();
  const map = {};
  for (const item of data.tree) if (item.type === "blob") map[item.path] = item.sha;
  return map;
}

async function createBlob(owner, repo, content, token) {
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/git/blobs`, {
    method: "POST",
    headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json", "Content-Type": "application/json" },
    body: JSON.stringify({ content, encoding: "base64" }),
  });
  if (!res.ok) { const e = await res.json(); throw new Error(`Blob error: ${e.message}`); }
  return (await res.json()).sha;
}

async function createTree(owner, repo, baseTreeSha, treeItems, token) {
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/git/trees`, {
    method: "POST",
    headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json", "Content-Type": "application/json" },
    body: JSON.stringify({ base_tree: baseTreeSha, tree: treeItems }),
  });
  if (!res.ok) { const e = await res.json(); throw new Error(`Tree error: ${e.message}`); }
  return (await res.json()).sha;
}

async function createCommit(owner, repo, message, treeSha, parentSha, token) {
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/git/commits`, {
    method: "POST",
    headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json", "Content-Type": "application/json" },
    body: JSON.stringify({ message, tree: treeSha, parents: [parentSha] }),
  });
  if (!res.ok) { const e = await res.json(); throw new Error(`Commit error: ${e.message}`); }
  return (await res.json()).sha;
}

async function updateRef(owner, repo, branch, commitSha, token, force = false) {
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
    method: "PATCH",
    headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json", "Content-Type": "application/json" },
    body: JSON.stringify({ sha: commitSha, force }),
  });
  if (!res.ok) { const e = await res.json(); throw new Error(`Ref update error: ${e.message}`); }
}

async function downloadRepoZip(owner, repo, branch, token) {
  const res = await fetch(`/api/zip-download?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}&branch=${encodeURIComponent(branch)}`, {
    headers: { Authorization: `token ${token}` },
  });
  if (!res.ok) {
    let msg = `ZIP download error: ${res.status}`;
    try { const e = await res.json(); if (e.error) msg = e.error; } catch {}
    throw new Error(msg);
  }
  const blob = await res.blob();
  triggerBlobDownload(blob, `${repo}-${branch}.zip`);
}

function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ── Shared Push Logic ─────────────────────────────────────
async function smartPush({ filesToProcess, owner, repo, token, commitMsg, log, backupEnabled }) {
  log(`🌐 Repo check kar raha hai...`);
  const branch = await getDefaultBranch(owner, repo, token);
  log(`✅ Branch: ${branch}`);

  const latestSha = await getLatestCommitSha(owner, repo, branch, token);
  log(`✅ Latest commit: ${latestSha.slice(0, 7)}`);

  if (backupEnabled) {
    addBackup({ owner, repo, branch, sha: latestSha, timestamp: Date.now(), label: commitMsg });
    log(`📦 Backup point saved: ${latestSha.slice(0, 7)} (revert ke liye use hoga)`);
  }

  const baseTreeSha = await getTreeSha(owner, repo, latestSha, token);

  log(`🔍 Existing files fetch kar raha hai...`);
  const repoFileMap = await fetchRepoTree(owner, repo, baseTreeSha, token);
  log(`✅ ${Object.keys(repoFileMap).length} files repo mein`);

  log(`⚖️ Diff compare kar raha hai...`);
  const toPush = [];
  let skipped = 0;
  for (const { name, data } of filesToProcess) {
    const localSha = await computeGitBlobSha(data);
    const remoteSha = repoFileMap[name];
    if (!remoteSha) toPush.push({ name, data, fileStatus: "added" });
    else if (localSha !== remoteSha) toPush.push({ name, data, fileStatus: "updated" });
    else skipped++;
  }

  const addedCount = toPush.filter(f => f.fileStatus === "added").length;
  const updatedCount = toPush.filter(f => f.fileStatus === "updated").length;
  log(`📊 ${addedCount} naye · ${updatedCount} changed · ${skipped} unchanged`);

  if (toPush.length === 0) {
    log(`🎉 Sab files already up-to-date!`, "success");
    return { added: 0, updated: 0, skipped, branch, prevSha: latestSha, newSha: null };
  }

  log(`⬆️ ${toPush.length} files upload ho rahi hain...`);
  const treeItems = [];
  let added = 0, updated = 0;
  for (let i = 0; i < toPush.length; i++) {
    const { name, data, fileStatus } = toPush[i];
    log(`  ${fileStatus === "added" ? "🆕" : "✏️"} [${i + 1}/${toPush.length}] ${fileStatus.toUpperCase()}: ${name}`);
    const blobSha = await createBlob(owner, repo, uint8ToBase64(data), token);
    treeItems.push({ path: name, mode: "100644", type: "blob", sha: blobSha });
    if (fileStatus === "added") added++; else updated++;
  }

  log(`🌳 Tree create ho raha hai...`);
  const newTreeSha = await createTree(owner, repo, baseTreeSha, treeItems, token);
  log(`💬 Commit ban raha hai...`);
  const newCommitSha = await createCommit(owner, repo, commitMsg, newTreeSha, latestSha, token);
  log(`🚀 Push ho raha hai ${branch} par...`);
  await updateRef(owner, repo, branch, newCommitSha, token);
  log(`🎉 Done! ${newCommitSha.slice(0, 7)} → ${owner}/${repo}@${branch}`, "success");
  return { added, updated, skipped, branch, prevSha: latestSha, newSha: newCommitSha };
}

// ── Vercel Auto-Rollback Monitor ──────────────────────────
// Polls Vercel for the deployment matching newSha. If it errors out,
// automatically force-updates the GitHub ref back to prevSha.
async function monitorVercelDeployment({ owner, repo, branch, prevSha, newSha, githubToken, vercelToken, vercelProjectId, log }) {
  if (!vercelToken || !vercelProjectId || !newSha) return;
  log(`🔭 Vercel deployment monitor kar raha hai (auto-rollback ON)...`);
  const maxAttempts = 24; // ~6 minutes at 15s interval
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, 15000));
    let dep = null;
    try {
      const res = await fetch(`https://api.vercel.com/v6/deployments?projectId=${encodeURIComponent(vercelProjectId)}&limit=10`, {
        headers: { Authorization: `Bearer ${vercelToken}` },
      });
      if (!res.ok) { log(`⚠️ Vercel status check fail (${res.status})`, "warn"); continue; }
      const data = await res.json();
      dep = (data.deployments || []).find(d => {
        const sha = d.meta?.githubCommitSha || d.meta?.gitCommitSha || "";
        return sha === newSha || (sha && newSha.startsWith(sha.slice(0, 7)));
      });
    } catch (e) { log(`⚠️ Vercel poll error: ${e.message}`, "warn"); continue; }

    if (!dep) continue; // deployment not visible yet, keep polling

    if (dep.readyState === "READY") {
      log(`✅ Vercel deployment successful — koi rollback nahi chahiye`, "success");
      return { ok: true };
    }
    if (dep.readyState === "ERROR" || dep.readyState === "CANCELED") {
      log(`❌ Vercel build FAILED — auto-rollback kar raha hai ${prevSha.slice(0, 7)} par...`, "error");
      try {
        await updateRef(owner, repo, branch, prevSha, githubToken, true);
        log(`⏪ Auto-rollback ho gaya — ${owner}/${repo}@${branch} wapas ${prevSha.slice(0, 7)} par`, "success");
        return { ok: false, rolledBack: true };
      } catch (e) {
        log(`❌ Auto-rollback bhi fail ho gaya: ${e.message}`, "error");
        return { ok: false, rolledBack: false };
      }
    }
    // QUEUED / BUILDING / INITIALIZING → keep polling
  }
  log(`⌛ Vercel monitor timeout — deployment status manually check kar lo`, "warn");
  return { ok: null };
}

// ── Sub-components ────────────────────────────────────────

// Repo Selector (shared across tabs)
function RepoSelector({ token, selectedRepo, setSelectedRepo }) {
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
function LogsPanel({ logs }) {
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
function SummaryCard({ summary }) {
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
function DiffBadge() {
  return (
    <div style={{ background: "#0d2130", border: "1px solid #1f6feb33", borderRadius: "8px", padding: "9px 12px", fontSize: "11px", color: "#58a6ff", display: "flex", gap: "8px" }}>
      <span>🧠</span>
      <span><strong>Smart Diff ON</strong> — Sirf <span style={{ color: "#3fb950" }}>🆕 naye</span> aur <span style={{ color: "#e3b341" }}>✏️ changed</span> files push honge. Extra files safe.</span>
    </div>
  );
}

// Backup Toggle (shared across tabs)
function BackupToggle({ enabled, setEnabled, onOpenRestorePoints, restoreCount }) {
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
function RestorePointsModal({ onClose, owner, repo, token }) {
  const [backups, setBackups] = useState([]);
  const [reverting, setReverting] = useState(null);
  const [doneMsg, setDoneMsg] = useState("");
  const [errMsg, setErrMsg] = useState("");

  useEffect(() => {
    const all = loadBackups();
    setBackups(all.filter(b => b.owner === owner && b.repo === repo));
  }, [owner, repo]);

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

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: "12px", width: "100%", maxWidth: "380px", maxHeight: "78vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", borderBottom: "1px solid #21262d", flexShrink: 0 }}>
          <div style={{ fontSize: "14px", fontWeight: 700, color: "#f0f6fc" }}>🕐 Restore Points</div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#6e7681", fontSize: "18px", cursor: "pointer" }}>✕</button>
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
            </div>
          ))}
        </div>
        <div style={{ padding: "9px 16px", fontSize: "10px", color: "#484f58", borderTop: "1px solid #21262d", flexShrink: 0 }}>
          ⚠️ Revert branch ko force-update karta hai — uske baad ke commits/pushes overwrite ho jaayenge.
        </div>
      </div>
    </div>
  );
}

// Vercel Auto-Rollback Panel (shared across tabs) — per-repo settings
function VercelRollbackPanel({ owner, repo }) {
  const [cfg, setCfg] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [vToken, setVToken] = useState("");
  const [vProjectId, setVProjectId] = useState("");

  useEffect(() => {
    if (!owner || !repo) { setCfg(null); return; }
    const c = getVercelConfig(owner, repo);
    setCfg(c);
    setVToken(c?.token || "");
    setVProjectId(c?.projectId || "");
  }, [owner, repo]);

  if (!owner || !repo) return null;

  const enabled = !!cfg?.autoRollback;

  const toggleEnabled = () => {
    if (!cfg?.token || !cfg?.projectId) { setShowModal(true); return; }
    const next = { ...cfg, autoRollback: !enabled };
    setVercelConfig(owner, repo, next);
    setCfg(next);
  };

  const handleSave = () => {
    const next = { token: vToken.trim(), projectId: vProjectId.trim(), autoRollback: !!(vToken.trim() && vProjectId.trim()) };
    setVercelConfig(owner, repo, next);
    setCfg(next);
    setShowModal(false);
  };

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 12px", background: "#161b22", border: "1px solid #30363d", borderRadius: "6px" }}>
        <div onClick={toggleEnabled} style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer", flex: 1 }}>
          <div style={{ width: "36px", height: "20px", borderRadius: "10px", background: enabled ? "#1f6feb" : "#30363d", position: "relative", flexShrink: 0 }}>
            <div style={{ position: "absolute", top: "3px", left: enabled ? "18px" : "3px", width: "14px", height: "14px", borderRadius: "50%", background: "#fff", transition: "left 0.2s" }} />
          </div>
          <div>
            <div style={{ fontSize: "12px", color: "#c9d1d9" }}>▲ Vercel Auto-Rollback</div>
            <div style={{ fontSize: "10px", color: "#6e7681" }}>{cfg?.projectId ? `Build fail → auto revert` : "Pehle Vercel token/project ID set karo"}</div>
          </div>
        </div>
        <button onClick={() => setShowModal(true)} style={{ background: "#0d1117", border: "1px solid #30363d", borderRadius: "6px", padding: "7px 10px", fontSize: "11px", color: "#58a6ff", cursor: "pointer", fontFamily: "inherit", flexShrink: 0 }}>
          ⚙️
        </button>
      </div>

      {showModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }} onClick={() => setShowModal(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: "12px", width: "100%", maxWidth: "380px", padding: "16px", display: "flex", flexDirection: "column", gap: "10px" }}>
            <div style={{ fontSize: "14px", fontWeight: 700, color: "#f0f6fc" }}>▲ Vercel Settings — {owner}/{repo}</div>
            <div style={{ fontSize: "10px", color: "#6e7681" }}>Token: Vercel → Settings → Tokens se banao. Project ID: Project → Settings mein milega.</div>
            <input type="text" value={vToken} onChange={e => setVToken(e.target.value)} placeholder="Vercel API Token" style={{ width: "100%", boxSizing: "border-box", background: "#0d1117", border: "1px solid #30363d", color: "#c9d1d9", borderRadius: "6px", padding: "9px 12px", fontSize: "12px", outline: "none", fontFamily: "inherit" }} />
            <input type="text" value={vProjectId} onChange={e => setVProjectId(e.target.value)} placeholder="Vercel Project ID" style={{ width: "100%", boxSizing: "border-box", background: "#0d1117", border: "1px solid #30363d", color: "#c9d1d9", borderRadius: "6px", padding: "9px 12px", fontSize: "12px", outline: "none", fontFamily: "inherit" }} />
            <div style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
              <button onClick={() => setShowModal(false)} style={{ flex: 1, padding: "9px", borderRadius: "6px", fontSize: "12px", fontFamily: "inherit", fontWeight: 600, cursor: "pointer", background: "#0d1117", color: "#8b949e", border: "1px solid #30363d" }}>Cancel</button>
              <button onClick={handleSave} style={{ flex: 1, padding: "9px", borderRadius: "6px", fontSize: "12px", fontFamily: "inherit", fontWeight: 600, cursor: "pointer", background: "#1f6feb", color: "#fff", border: "1px solid #388bfd" }}>Save</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// Confirm-before-push modal — prevents accidental push to wrong repo
function ConfirmPushModal({ owner, repo, branch, fileCount, commitMsg, onConfirm, onCancel }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }} onClick={onCancel}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: "12px", width: "100%", maxWidth: "380px", padding: "18px", display: "flex", flexDirection: "column", gap: "12px" }}>
        <div style={{ fontSize: "15px", fontWeight: 700, color: "#f0f6fc" }}>🚀 Push Confirm Karo</div>
        <div style={{ background: "#0d1117", border: "1px solid #21262d", borderRadius: "8px", padding: "12px", display: "flex", flexDirection: "column", gap: "6px" }}>
          <div style={{ fontSize: "12px", color: "#8b949e" }}>Repo: <span style={{ color: "#58a6ff", fontWeight: 700 }}>{owner}/{repo}</span></div>
          <div style={{ fontSize: "12px", color: "#8b949e" }}>Branch: <span style={{ color: "#3fb950", fontWeight: 700 }}>{branch || "(default)"}</span></div>
          <div style={{ fontSize: "12px", color: "#8b949e" }}>Files: <span style={{ color: "#e3b341", fontWeight: 700 }}>{fileCount}</span></div>
          <div style={{ fontSize: "12px", color: "#8b949e" }}>Commit: <span style={{ color: "#c9d1d9" }}>{commitMsg}</span></div>
        </div>
        <div style={{ fontSize: "10.5px", color: "#6e7681" }}>⚠️ Pakka check kar lo ye sahi repo hai — push hone ke baad GitHub par directly changes ho jaayenge.</div>
        <div style={{ display: "flex", gap: "8px" }}>
          <button onClick={onCancel} style={{ flex: 1, padding: "10px", borderRadius: "6px", fontSize: "12px", fontFamily: "inherit", fontWeight: 600, cursor: "pointer", background: "#0d1117", color: "#8b949e", border: "1px solid #30363d" }}>Cancel</button>
          <button onClick={onConfirm} style={{ flex: 1, padding: "10px", borderRadius: "6px", fontSize: "12px", fontFamily: "inherit", fontWeight: 700, cursor: "pointer", background: "#238636", color: "#fff", border: "1px solid #2ea043" }}>✅ Haan, Push Karo</button>
        </div>
      </div>
    </div>
  );
}


// Returns true only if EVERY file path starts with the same "folderName/" prefix.
function detectWrapperFolder(rawFiles) {
  const fileEntries = rawFiles.filter(f => f.name && !f.name.endsWith("/"));
  if (fileEntries.length === 0) return false;
  let common = null;
  for (const f of fileEntries) {
    const idx = f.name.indexOf("/");
    if (idx === -1) return false; // a file sits at the true root → no single wrapper
    const top = f.name.slice(0, idx);
    if (common === null) common = top;
    else if (common !== top) return false; // different top-level folders → no single wrapper
  }
  return true;
}

function ZipTab({ token, selectedRepo, setSelectedRepo }) {
  const [zipFile, setZipFile] = useState(null);
  const [stripOverride, setStripOverride] = useState(null); // null = auto, true/false = manual override
  const [detectedWrapper, setDetectedWrapper] = useState(null); // null = not yet checked
  const [commitMsg, setCommitMsg] = useState("Smart diff update via ZIP pusher");
  const [logs, setLogs] = useState([]);
  const [status, setStatus] = useState("idle");
  const [summary, setSummary] = useState(null);
  const [backupEnabled, setBackupEnabled] = useState(true);
  const [showRestore, setShowRestore] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [pendingFiles, setPendingFiles] = useState(null);
  const [progress, setProgress] = useState(null); // { current, total }
  const zipRef = useRef();

  const log = (msg, type = "info") => setLogs(prev => [...prev, { msg, type, time: new Date().toLocaleTimeString() }]);

  const getOwnerRepo = () => {
    if (!selectedRepo) return null;
    const parts = selectedRepo.split("/");
    return parts.length === 2 ? { owner: parts[0], repo: parts[1] } : null;
  };

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

      const wrapperDetected = detectWrapperFolder(rawFiles);
      const stripRoot = stripOverride !== null ? stripOverride : wrapperDetected;
      log(stripRoot ? `📁 Wrapper folder detected — strip kar raha hai` : `📁 Koi wrapper folder nahi — paths as-is rahenge`);

      log(`🔓 Decompress ho rahi hain...`);
      const decompressed = [];
      for (const f of rawFiles) {
        try {
          const data = await decompressFile(f);
          let name = f.name;
          if (stripRoot) { const s = name.indexOf("/"); if (s !== -1) name = name.slice(s + 1); }
          if (name) decompressed.push({ name, data });
        } catch (e) { log(`⚠️ Skip: ${f.name} — ${e.message}`, "warn"); }
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
      const vercelCfg = getVercelConfig(parsed.owner, parsed.repo);
      const result = await smartPush({ filesToProcess: decompressed, ...parsed, token, commitMsg, log, backupEnabled });
      setSummary(result);
      setStatus("done");
      addHistoryEntry({
        owner: parsed.owner, repo: parsed.repo, branch: result.branch, commitMsg, source: "zip",
        prevSha: result.prevSha, newSha: result.newSha,
        added: result.added, updated: result.updated, skipped: result.skipped,
        status: result.newSha ? "success" : "no-changes",
      });
      if (result.newSha && vercelCfg?.autoRollback) {
        monitorVercelDeployment({
          owner: parsed.owner, repo: parsed.repo, branch: result.branch,
          prevSha: result.prevSha, newSha: result.newSha,
          githubToken: token, vercelToken: vercelCfg.token, vercelProjectId: vercelCfg.projectId, log,
        });
      }
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
              setDetectedWrapper(detectWrapperFolder(rawFiles));
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

      {parsed && <VercelRollbackPanel owner={parsed.owner} repo={parsed.repo} />}

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

// ── Tab 2: Files Pusher ───────────────────────────────────
function FilesTab({ token, selectedRepo, setSelectedRepo }) {
  const [indivFiles, setIndivFiles] = useState([]);
  const [commitMsg, setCommitMsg] = useState("File update via pusher");
  const [logs, setLogs] = useState([]);
  const [status, setStatus] = useState("idle");
  const [summary, setSummary] = useState(null);
  const [backupEnabled, setBackupEnabled] = useState(true);
  const [showRestore, setShowRestore] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
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

  const handlePushClick = () => {
    const parsed = getOwnerRepo();
    if (!parsed) { log("⚠️ Repo select karo!", "error"); return; }
    if (!indivFiles.length) { log("⚠️ Koi file select nahi!", "error"); return; }
    const emptyPath = indivFiles.find(f => !f.repoPath.trim());
    if (emptyPath) { log(`⚠️ "${emptyPath.file.name}" ka path empty hai!`, "error"); return; }
    setShowConfirm(true);
  };

  const handlePush = async () => {
    setShowConfirm(false);
    const parsed = getOwnerRepo();
    if (!parsed) return;

    setStatus("running"); setLogs([]); setSummary(null);
    try {
      log(`📂 ${indivFiles.length} files process ho rahi hain...`);
      const processed = [];
      for (const { file, repoPath } of indivFiles) {
        const data = await readFileAsUint8(file);
        processed.push({ name: repoPath.trim(), data });
      }
      const vercelCfg = getVercelConfig(parsed.owner, parsed.repo);
      const result = await smartPush({ filesToProcess: processed, ...parsed, token, commitMsg, log, backupEnabled });
      setSummary(result);
      setStatus("done");
      addHistoryEntry({
        owner: parsed.owner, repo: parsed.repo, branch: result.branch, commitMsg, source: "files",
        prevSha: result.prevSha, newSha: result.newSha,
        added: result.added, updated: result.updated, skipped: result.skipped,
        status: result.newSha ? "success" : "no-changes",
      });
      if (result.newSha && vercelCfg?.autoRollback) {
        monitorVercelDeployment({
          owner: parsed.owner, repo: parsed.repo, branch: result.branch,
          prevSha: result.prevSha, newSha: result.newSha,
          githubToken: token, vercelToken: vercelCfg.token, vercelProjectId: vercelCfg.projectId, log,
        });
      }
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

      <div>
        <div style={{ fontSize: "11px", color: "#8b949e", marginBottom: "5px" }}>💬 Commit Message</div>
        <input type="text" value={commitMsg} onChange={e => setCommitMsg(e.target.value)} style={inp} />
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
            </div>
          ))}
        </div>
      )}

      <BackupToggle enabled={backupEnabled} setEnabled={setBackupEnabled} onOpenRestorePoints={() => setShowRestore(true)} restoreCount={repoBackupCount} />

      {parsedRepo && <VercelRollbackPanel owner={parsedRepo.owner} repo={parsedRepo.repo} />}

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
          owner={parsedRepo.owner} repo={parsedRepo.repo} branch="" fileCount={indivFiles.length} commitMsg={commitMsg}
          onConfirm={handlePush} onCancel={() => setShowConfirm(false)}
        />
      )}
    </div>
  );
}

// ── Tab 3: Push History ───────────────────────────────────
function HistoryTab({ token }) {
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


function AccountsTab({ activeAccountId, setActiveAccountId, accounts, setAccounts }) {
  const [showAdd, setShowAdd] = useState(false);
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
        return (
          <div key={acc.id} style={{ background: "#161b22", border: `1px solid ${isActive ? "#2ea043" : "#30363d"}`, borderRadius: "8px", padding: "12px", display: "flex", alignItems: "center", gap: "10px" }}>
            <div style={{ width: "36px", height: "36px", borderRadius: "50%", background: "#30363d", flexShrink: 0, overflow: "hidden", border: `2px solid ${isActive ? "#2ea043" : "#30363d"}` }}>
              {acc.avatar && <img src={acc.avatar} alt="" style={{ width: "100%", height: "100%" }} />}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: "13px", fontWeight: 700, color: "#f0f6fc", display: "flex", alignItems: "center", gap: "6px" }}>
                {acc.label}
                {isActive && <span style={{ fontSize: "9px", background: "#238636", color: "#fff", borderRadius: "4px", padding: "1px 5px" }}>ACTIVE</span>}
              </div>
              <div style={{ fontSize: "10px", color: "#6e7681" }}>@{acc.login} · {maskPat(acc.pat)}</div>
            </div>
            <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
              {!isActive && (
                <button onClick={() => { saveActiveId(acc.id); setActiveAccountId(acc.id); }} style={{ background: "#238636", border: "none", color: "#fff", borderRadius: "6px", padding: "5px 10px", fontSize: "11px", cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}>Switch</button>
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
      <div style={{ fontSize: "10px", color: "#484f58", textAlign: "center" }}>PAT localStorage mein save hota hai · Scope chahiye: <code>repo</code></div>
    </div>
  );
}

// ── Add Account Modal ────────────────────────────────────
function AddAccountModal({ onClose, accounts, setAccounts, setActiveAccountId, activeAccountId }) {
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
function SwitchAccountModal({ onClose, accounts, setAccounts, activeAccountId, setActiveAccountId, setSelectedRepo, onAddNew }) {
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
            return (
              <div key={acc.id} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 16px", borderBottom: "1px solid #21262d", background: isActive ? "#1f2937" : "transparent" }}>
                <div style={{ width: "32px", height: "32px", borderRadius: "50%", overflow: "hidden", flexShrink: 0, border: `2px solid ${isActive ? "#2ea043" : "#30363d"}`, background: "#30363d" }}>
                  {acc.avatar && <img src={acc.avatar} alt="" style={{ width: "100%", height: "100%" }} />}
                </div>
                <button
                  onClick={() => { saveActiveId(acc.id); setActiveAccountId(acc.id); setSelectedRepo(""); onClose(); }}
                  style={{ flex: 1, textAlign: "left", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", padding: 0 }}
                >
                  <div style={{ fontSize: "13px", fontWeight: 600, color: "#f0f6fc" }}>{acc.label}</div>
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

// ── Main App ──────────────────────────────────────────────
export default function ZipPusherPage() {
  const { data: session, status: sessionStatus } = useSession();
  const router = useRouter();

  const [activeTab, setActiveTab] = useState("zip");
  const [selectedRepo, setSelectedRepo] = useState("");
  const [accounts, setAccounts] = useState([]);
  const [activeAccountId, setActiveAccountId] = useState(null);
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showSwitchModal, setShowSwitchModal] = useState(false);
  const menuRef = useRef();

  useEffect(() => { if (sessionStatus === "unauthenticated") router.push("/login"); }, [sessionStatus, router]);

  useEffect(() => {
    const saved = loadAccounts();
    const savedActive = loadActiveId();
    setAccounts(saved);
    if (savedActive && saved.find(a => a.id === savedActive)) setActiveAccountId(savedActive);
    else if (saved.length > 0) { setActiveAccountId(saved[0].id); saveActiveId(saved[0].id); }
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    if (!showAccountMenu) return;
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setShowAccountMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, [showAccountMenu]);

  const activeAccount = accounts.find(a => a.id === activeAccountId);
  const token = activeAccount?.pat || session?.accessToken || "";

  if (sessionStatus === "loading") return <div style={{ minHeight: "100vh", background: "#0d1117", color: "#8b949e", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "monospace" }}>Loading...</div>;
  if (sessionStatus !== "authenticated") return null;

  const tabs = [
    { id: "zip", label: "ZIP Push", icon: "📦" },
    { id: "files", label: "Files Push", icon: "🗂️" },
    { id: "history", label: "History", icon: "📜" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "#0d1117", color: "#c9d1d9", fontFamily: "'JetBrains Mono','Fira Code',monospace", display: "flex", flexDirection: "column" }}>

      {/* Header */}
      <div style={{ padding: "13px 18px", borderBottom: "1px solid #21262d", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0, gap: "10px", background: "linear-gradient(180deg, #11161d 0%, #0d1117 100%)", position: "sticky", top: 0, zIndex: 60 }}>
        {/* Logo + Title */}
        <div style={{ display: "flex", alignItems: "center", gap: "9px" }}>
          <div style={{ width: "30px", height: "30px", borderRadius: "8px", background: "#161b22", border: "1px solid #21262d", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "16px" }}>🐙</div>
          <div>
            <div style={{ fontSize: "13.5px", fontWeight: 700, color: "#f0f6fc", letterSpacing: "0.2px" }}>Smart Pusher</div>
            <div style={{ fontSize: "9.5px", color: "#6e7681", fontWeight: 500, marginTop: "-1px" }}>GitHub Deploy Tool</div>
          </div>
        </div>

        {/* Right: Avatar Dropdown */}
        <div ref={menuRef} style={{ position: "relative" }}>
          <button
            onClick={() => setShowAccountMenu(p => !p)}
            style={{ background: showAccountMenu ? "#161b22" : "none", border: "1px solid", borderColor: showAccountMenu ? "#30363d" : "transparent", borderRadius: "10px", cursor: "pointer", padding: "4px 8px 4px 4px", display: "flex", alignItems: "center", gap: "8px", transition: "all 0.15s ease" }}
          >
            {/* Avatar */}
            <div style={{ width: "30px", height: "30px", borderRadius: "50%", overflow: "hidden", border: `2px solid ${activeAccount ? "#2ea043" : "#30363d"}`, background: "#30363d", flexShrink: 0 }}>
              {activeAccount?.avatar
                ? <img src={activeAccount.avatar} alt="" style={{ width: "100%", height: "100%" }} />
                : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "14px" }}>👤</div>
              }
            </div>
            {/* Name + chevron */}
            <div style={{ textAlign: "left" }}>
              <div style={{ fontSize: "12px", fontWeight: 600, color: "#f0f6fc", maxWidth: "110px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {activeAccount ? activeAccount.label : (session?.user?.name || "Account")}
              </div>
              {activeAccount && <div style={{ fontSize: "10px", color: "#6e7681" }}>@{activeAccount.login}</div>}
            </div>
            <span style={{ color: "#6e7681", fontSize: "9px", transform: showAccountMenu ? "rotate(180deg)" : "none", transition: "transform 0.15s ease" }}>▾</span>
          </button>

          {/* Google-style Account Card */}
          {showAccountMenu && (
            <div style={{ position: "absolute", top: "calc(100% + 10px)", right: 0, width: "270px", maxWidth: "calc(100vw - 24px)", background: "#161b22", border: "1px solid #30363d", borderRadius: "14px", zIndex: 100, boxShadow: "0 16px 40px rgba(0,0,0,0.55), 0 2px 8px rgba(0,0,0,0.4)", overflow: "hidden", animation: "spDropdownIn 0.16s ease-out" }}>

              {/* Current account detail */}
              <div style={{ padding: "22px 16px 18px", display: "flex", flexDirection: "column", alignItems: "center", gap: "10px", borderBottom: "1px solid #21262d", background: "linear-gradient(180deg, #1a2029 0%, #161b22 100%)" }}>
                <div style={{ width: "54px", height: "54px", borderRadius: "50%", overflow: "hidden", border: "2px solid #2ea043", background: "#30363d", boxShadow: "0 0 0 4px rgba(46,160,67,0.12)" }}>
                  {activeAccount?.avatar
                    ? <img src={activeAccount.avatar} alt="" style={{ width: "100%", height: "100%" }} />
                    : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "22px" }}>👤</div>
                  }
                </div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: "13.5px", fontWeight: 700, color: "#f0f6fc" }}>
                    {activeAccount ? activeAccount.label : (session?.user?.name || "No account")}
                  </div>
                  <div style={{ fontSize: "11px", color: "#6e7681", marginTop: "2px" }}>
                    {activeAccount ? `@${activeAccount.login}` : (session?.user?.email || "")}
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div style={{ padding: "6px" }}>
                <button
                  onClick={() => { setShowSwitchModal(true); setShowAccountMenu(false); }}
                  className="sp-menu-item"
                  style={{ width: "100%", background: "none", border: "none", cursor: "pointer", padding: "10px 11px", display: "flex", alignItems: "center", gap: "11px", fontFamily: "inherit", borderRadius: "8px", transition: "background 0.12s ease" }}
                >
                  <span style={{ fontSize: "15px", width: "20px", textAlign: "center" }}>⇄</span>
                  <span style={{ fontSize: "12.5px", color: "#c9d1d9", fontWeight: 500 }}>Switch account</span>
                  {accounts.length > 0 && (
                    <span style={{ marginLeft: "auto", fontSize: "10px", background: "#21262d", color: "#8b949e", borderRadius: "10px", padding: "1px 7px" }}>{accounts.length}</span>
                  )}
                </button>

                <button
                  onClick={() => { setShowAddModal(true); setShowAccountMenu(false); }}
                  className="sp-menu-item"
                  style={{ width: "100%", background: "none", border: "none", cursor: "pointer", padding: "10px 11px", display: "flex", alignItems: "center", gap: "11px", fontFamily: "inherit", borderRadius: "8px", transition: "background 0.12s ease" }}
                >
                  <span style={{ fontSize: "15px", width: "20px", textAlign: "center" }}>➕</span>
                  <span style={{ fontSize: "12.5px", color: "#c9d1d9", fontWeight: 500 }}>Add account</span>
                </button>
              </div>

              {/* Logout */}
              <div style={{ borderTop: "1px solid #21262d", padding: "6px" }}>
                <button
                  onClick={() => { setShowAccountMenu(false); signOut({ callbackUrl: "/login" }); }}
                  className="sp-menu-item-danger"
                  style={{ width: "100%", background: "none", border: "none", cursor: "pointer", padding: "10px 11px", display: "flex", alignItems: "center", gap: "11px", fontFamily: "inherit", borderRadius: "8px", transition: "background 0.12s ease" }}
                >
                  <span style={{ fontSize: "15px", width: "20px", textAlign: "center" }}>🚪</span>
                  <span style={{ fontSize: "12.5px", color: "#f85149", fontWeight: 500 }}>Logout</span>
                </button>
              </div>
            </div>
          )}
        </div>
        {/* end avatar wrapper */}
      </div>

      <style jsx global>{`
        @keyframes spDropdownIn {
          from { opacity: 0; transform: translateY(-6px) scale(0.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        .sp-menu-item:hover { background: #21262d; }
        .sp-menu-item-danger:hover { background: #2d1416; }
      `}</style>

      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px", paddingBottom: "80px" }}>
        {!token && activeTab !== "accounts" && (
          <div style={{ background: "#1f1207", border: "1px solid #e3b34144", borderRadius: "8px", padding: "14px", fontSize: "12px", color: "#e3b341", textAlign: "center", marginBottom: "14px" }}>
            ⚠️ Pehle <strong>Accounts</strong> tab mein ek account add karo
          </div>
        )}
        {activeTab === "zip" && token && <ZipTab token={token} selectedRepo={selectedRepo} setSelectedRepo={setSelectedRepo} />}
        {activeTab === "files" && token && <FilesTab token={token} selectedRepo={selectedRepo} setSelectedRepo={setSelectedRepo} />}
        {activeTab === "history" && token && <HistoryTab token={token} />}
      </div>

      {/* Bottom Nav */}
      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "#161b22", borderTop: "1px solid #21262d", display: "flex", zIndex: 50 }}>
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{ flex: 1, padding: "12px 8px 14px", background: "none", border: "none", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: "4px", fontFamily: "inherit", borderTop: activeTab === tab.id ? "2px solid #58a6ff" : "2px solid transparent", position: "relative" }}>
            <span style={{ fontSize: "20px" }}>{tab.icon}</span>
            <span style={{ fontSize: "10px", fontWeight: 600, color: activeTab === tab.id ? "#58a6ff" : "#6e7681" }}>{tab.label}</span>

          </button>
        ))}
      </div>

      {/* Add Account Modal */}
      {showAddModal && (
        <AddAccountModal
          onClose={() => setShowAddModal(false)}
          accounts={accounts}
          setAccounts={setAccounts}
          activeAccountId={activeAccountId}
          setActiveAccountId={setActiveAccountId}
        />
      )}

      {/* Switch Account Modal */}
      {showSwitchModal && (
        <SwitchAccountModal
          onClose={() => setShowSwitchModal(false)}
          accounts={accounts}
          setAccounts={setAccounts}
          activeAccountId={activeAccountId}
          setActiveAccountId={setActiveAccountId}
          setSelectedRepo={setSelectedRepo}
          onAddNew={() => setShowAddModal(true)}
        />
      )}
    </div>
  );
}
