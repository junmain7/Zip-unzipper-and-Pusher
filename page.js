"use client";

import { useState, useRef, useEffect } from "react";
import { useSession, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";

const GITHUB_API = "https://api.github.com";

// ── Helpers ──────────────────────────────────────────────
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

async function updateRef(owner, repo, branch, commitSha, token) {
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
    method: "PATCH",
    headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json", "Content-Type": "application/json" },
    body: JSON.stringify({ sha: commitSha, force: false }),
  });
  if (!res.ok) { const e = await res.json(); throw new Error(`Ref update error: ${e.message}`); }
}

// ── Shared Push Logic ─────────────────────────────────────
async function smartPush({ filesToProcess, owner, repo, token, commitMsg, log }) {
  log(`🌐 Repo check kar raha hai...`);
  const branch = await getDefaultBranch(owner, repo, token);
  log(`✅ Branch: ${branch}`);

  const latestSha = await getLatestCommitSha(owner, repo, branch, token);
  log(`✅ Latest commit: ${latestSha.slice(0, 7)}`);

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
    return { added: 0, updated: 0, skipped };
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
  return { added, updated, skipped };
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

// ── Tab 1: ZIP Pusher ─────────────────────────────────────
function ZipTab({ token, selectedRepo, setSelectedRepo }) {
  const [zipFile, setZipFile] = useState(null);
  const [stripRoot, setStripRoot] = useState(true);
  const [commitMsg, setCommitMsg] = useState("Smart diff update via ZIP pusher");
  const [logs, setLogs] = useState([]);
  const [status, setStatus] = useState("idle");
  const [summary, setSummary] = useState(null);
  const zipRef = useRef();

  const log = (msg, type = "info") => setLogs(prev => [...prev, { msg, type, time: new Date().toLocaleTimeString() }]);

  const getOwnerRepo = () => {
    if (!selectedRepo) return null;
    const parts = selectedRepo.split("/");
    return parts.length === 2 ? { owner: parts[0], repo: parts[1] } : null;
  };

  const handlePush = async () => {
    const parsed = getOwnerRepo();
    if (!parsed) { log("⚠️ Repo select karo!", "error"); return; }
    if (!zipFile) { log("⚠️ ZIP file choose karo!", "error"); return; }

    setStatus("running"); setLogs([]); setSummary(null);
    try {
      log(`📦 ZIP read ho raha hai...`);
      const buffer = await readFileAsArrayBuffer(zipFile);
      const rawFiles = parseZip(buffer);
      log(`✅ ${rawFiles.length} files mili`);

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
      log(`✅ ${decompressed.length} files ready`);

      const result = await smartPush({ filesToProcess: decompressed, ...parsed, token, commitMsg, log });
      setSummary(result);
      setStatus("done");
    } catch (e) { log(`❌ ${e.message}`, "error"); setStatus("error"); }
  };

  const isRunning = status === "running";
  const inp = { width: "100%", boxSizing: "border-box", background: "#161b22", border: "1px solid #30363d", color: "#c9d1d9", borderRadius: "6px", padding: "9px 12px", fontSize: "12px", outline: "none", fontFamily: "inherit" };

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
        <input ref={zipRef} type="file" accept=".zip" style={{ display: "none" }} onChange={e => setZipFile(e.target.files[0] || null)} />
      </div>

      <div onClick={() => setStripRoot(p => !p)} style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer", padding: "10px 12px", background: "#161b22", border: "1px solid #30363d", borderRadius: "6px" }}>
        <div style={{ width: "36px", height: "20px", borderRadius: "10px", background: stripRoot ? "#238636" : "#30363d", position: "relative", flexShrink: 0 }}>
          <div style={{ position: "absolute", top: "3px", left: stripRoot ? "18px" : "3px", width: "14px", height: "14px", borderRadius: "50%", background: "#fff", transition: "left 0.2s" }} />
        </div>
        <div>
          <div style={{ fontSize: "12px", color: "#c9d1d9" }}>Root folder strip karo</div>
          <div style={{ fontSize: "10px", color: "#6e7681" }}>project-main/ → / (pehla folder hata do)</div>
        </div>
      </div>

      <DiffBadge />

      <button onClick={handlePush} disabled={isRunning || !selectedRepo || !zipFile} style={{
        width: "100%", padding: "14px", borderRadius: "8px", fontSize: "14px", fontWeight: 700, cursor: isRunning || !selectedRepo || !zipFile ? "not-allowed" : "pointer", fontFamily: "inherit",
        background: isRunning || !selectedRepo || !zipFile ? "#161b22" : "#238636",
        color: isRunning || !selectedRepo || !zipFile ? "#6e7681" : "#fff",
        border: "1px solid #2ea043",
      }}>
        {isRunning ? "⏳ Push ho raha hai..." : "🚀 ZIP Smart Push Karo"}
      </button>

      <SummaryCard summary={summary} />
      <LogsPanel logs={logs} />
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

  const handlePush = async () => {
    const parsed = getOwnerRepo();
    if (!parsed) { log("⚠️ Repo select karo!", "error"); return; }
    if (!indivFiles.length) { log("⚠️ Koi file select nahi!", "error"); return; }
    const emptyPath = indivFiles.find(f => !f.repoPath.trim());
    if (emptyPath) { log(`⚠️ "${emptyPath.file.name}" ka path empty hai!`, "error"); return; }

    setStatus("running"); setLogs([]); setSummary(null);
    try {
      log(`📂 ${indivFiles.length} files process ho rahi hain...`);
      const processed = [];
      for (const { file, repoPath } of indivFiles) {
        const data = await readFileAsUint8(file);
        processed.push({ name: repoPath.trim(), data });
      }
      const result = await smartPush({ filesToProcess: processed, ...parsed, token, commitMsg, log });
      setSummary(result);
      setStatus("done");
    } catch (e) { log(`❌ ${e.message}`, "error"); setStatus("error"); }
  };

  const isRunning = status === "running";
  const inp = { width: "100%", boxSizing: "border-box", background: "#161b22", border: "1px solid #30363d", color: "#c9d1d9", borderRadius: "6px", padding: "9px 12px", fontSize: "12px", outline: "none", fontFamily: "inherit" };

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

      <DiffBadge />

      <button onClick={handlePush} disabled={isRunning || !selectedRepo || !indivFiles.length} style={{
        width: "100%", padding: "14px", borderRadius: "8px", fontSize: "14px", fontWeight: 700, cursor: isRunning || !selectedRepo || !indivFiles.length ? "not-allowed" : "pointer", fontFamily: "inherit",
        background: isRunning || !selectedRepo || !indivFiles.length ? "#161b22" : "#6e40c9",
        color: isRunning || !selectedRepo || !indivFiles.length ? "#6e7681" : "#fff",
        border: "1px solid #8957e5",
      }}>
        {isRunning ? "⏳ Push ho raha hai..." : `🚀 ${indivFiles.length ? `${indivFiles.length} File${indivFiles.length > 1 ? "s" : ""}` : "Files"} Push Karo`}
      </button>

      <SummaryCard summary={summary} />
      <LogsPanel logs={logs} />
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────
export default function ZipPusherPage() {
  const { data: session, status: sessionStatus } = useSession();
  const router = useRouter();
  const token = session?.accessToken || "";

  const [activeTab, setActiveTab] = useState("zip");
  // Shared repo state across tabs
  const [selectedRepo, setSelectedRepo] = useState("");

  useEffect(() => {
    if (sessionStatus === "unauthenticated") router.push("/login");
  }, [sessionStatus, router]);

  if (sessionStatus === "loading") {
    return <div style={{ minHeight: "100vh", background: "#0d1117", color: "#8b949e", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "monospace" }}>Loading...</div>;
  }
  if (sessionStatus !== "authenticated") return null;

  const tabs = [
    { id: "zip", label: "ZIP Push", icon: "📦" },
    { id: "files", label: "Files Push", icon: "🗂️" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "#0d1117", color: "#c9d1d9", fontFamily: "'JetBrains Mono','Fira Code',monospace", display: "flex", flexDirection: "column" }}>

      {/* Header */}
      <div style={{ padding: "14px 16px", borderBottom: "1px solid #21262d", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{ fontSize: "20px" }}>🐙</span>
          <div>
            <div style={{ fontSize: "14px", fontWeight: 700, color: "#f0f6fc" }}>GitHub Smart Pusher</div>
            <div style={{ fontSize: "10px", color: "#8b949e" }}>{session?.user?.name || session?.user?.email}</div>
          </div>
        </div>
        <button onClick={() => signOut({ callbackUrl: "/login" })} style={{ background: "none", border: "1px solid #30363d", color: "#8b949e", borderRadius: "6px", padding: "5px 10px", fontSize: "11px", cursor: "pointer", fontFamily: "inherit" }}>
          Logout
        </button>
      </div>

      {/* Tab Content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px", paddingBottom: "80px" }}>
        {activeTab === "zip" && <ZipTab token={token} selectedRepo={selectedRepo} setSelectedRepo={setSelectedRepo} />}
        {activeTab === "files" && <FilesTab token={token} selectedRepo={selectedRepo} setSelectedRepo={setSelectedRepo} />}
      </div>

      {/* Bottom Nav */}
      <div style={{
        position: "fixed", bottom: 0, left: 0, right: 0,
        background: "#161b22",
        borderTop: "1px solid #21262d",
        display: "flex",
        zIndex: 50,
      }}>
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
            flex: 1, padding: "12px 8px 14px",
            background: "none", border: "none", cursor: "pointer",
            display: "flex", flexDirection: "column", alignItems: "center", gap: "4px",
            fontFamily: "inherit",
            borderTop: activeTab === tab.id ? "2px solid #58a6ff" : "2px solid transparent",
          }}>
            <span style={{ fontSize: "20px" }}>{tab.icon}</span>
            <span style={{ fontSize: "10px", fontWeight: 600, color: activeTab === tab.id ? "#58a6ff" : "#6e7681" }}>{tab.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
