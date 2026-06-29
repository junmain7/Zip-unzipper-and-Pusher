"use client";

import { useState, useRef, useEffect } from "react";
import { useSession, signIn, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";

const GITHUB_API = "https://api.github.com";

function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function readFileAsArrayBuffer(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsArrayBuffer(file);
  });
}

function uint8ToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// Compute Git blob SHA: "blob <size>\0<content>"
async function computeGitBlobSha(uint8) {
  const header = new TextEncoder().encode(`blob ${uint8.byteLength}\0`);
  const combined = new Uint8Array(header.length + uint8.length);
  combined.set(header, 0);
  combined.set(uint8, header.length);
  const hashBuffer = await crypto.subtle.digest("SHA-1", combined);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

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
    const uncompressedSize = view.getUint32(offset + 22, true);
    const fileNameLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);

    const nameBytes = bytes.slice(offset + 30, offset + 30 + fileNameLen);
    const name = new TextDecoder().decode(nameBytes);

    const dataOffset = offset + 30 + fileNameLen + extraLen;
    const compressedData = bytes.slice(dataOffset, dataOffset + compressedSize);

    if (!name.endsWith("/")) {
      files.push({ name, compressedData, compression, compressedSize, uncompressedSize });
    }

    offset = dataOffset + compressedSize;
  }

  return files;
}

async function decompressFile(file) {
  if (file.compression === 0) {
    return file.compressedData;
  } else if (file.compression === 8) {
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
    for (const chunk of chunks) {
      result.set(chunk, pos);
      pos += chunk.length;
    }
    return result;
  }
  throw new Error(`Unsupported compression: ${file.compression}`);
}

async function fetchUserRepos(token) {
  const repos = [];
  let page = 1;
  while (true) {
    const res = await fetch(`${GITHUB_API}/user/repos?per_page=100&page=${page}&sort=updated&affiliation=owner`, {
      headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json" },
    });
    if (!res.ok) throw new Error("Repos fetch nahi hua");
    const data = await res.json();
    if (data.length === 0) break;
    repos.push(...data);
    if (data.length < 100) break;
    page++;
  }
  return repos;
}

async function createRepo(name, isPrivate, token) {
  const res = await fetch(`${GITHUB_API}/user/repos`, {
    method: "POST",
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name, private: isPrivate, auto_init: true }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.message || "Repo create nahi hua");
  }
  return await res.json();
}

async function getDefaultBranch(owner, repo, token) {
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}`, {
    headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json" },
  });
  if (!res.ok) throw new Error(`Repo not found: ${res.status}`);
  const data = await res.json();
  return data.default_branch;
}

async function getLatestCommitSha(owner, repo, branch, token) {
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/git/ref/heads/${branch}`, {
    headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json" },
  });
  if (!res.ok) throw new Error(`Branch not found: ${res.status}`);
  const data = await res.json();
  return data.object.sha;
}

async function getTreeSha(owner, repo, commitSha, token) {
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/git/commits/${commitSha}`, {
    headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json" },
  });
  const data = await res.json();
  return data.tree.sha;
}

// Fetch ALL files in repo with their SHAs (recursive tree)
async function fetchRepoTree(owner, repo, treeSha, token) {
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/git/trees/${treeSha}?recursive=1`, {
    headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json" },
  });
  if (!res.ok) throw new Error(`Tree fetch error: ${res.status}`);
  const data = await res.json();
  // Returns map of path -> sha for blobs only
  const map = {};
  for (const item of data.tree) {
    if (item.type === "blob") {
      map[item.path] = item.sha;
    }
  }
  return map;
}

async function createBlob(owner, repo, content, token) {
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/git/blobs`, {
    method: "POST",
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ content, encoding: "base64" }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(`Blob error: ${err.message}`);
  }
  const data = await res.json();
  return data.sha;
}

async function createTree(owner, repo, baseTreeSha, treeItems, token) {
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/git/trees`, {
    method: "POST",
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ base_tree: baseTreeSha, tree: treeItems }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(`Tree error: ${err.message}`);
  }
  const data = await res.json();
  return data.sha;
}

async function createCommit(owner, repo, message, treeSha, parentSha, token) {
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/git/commits`, {
    method: "POST",
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message, tree: treeSha, parents: [parentSha] }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(`Commit error: ${err.message}`);
  }
  const data = await res.json();
  return data.sha;
}

async function updateRef(owner, repo, branch, commitSha, token) {
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
    method: "PATCH",
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sha: commitSha, force: false }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(`Ref update error: ${err.message}`);
  }
}

export default function ZipPusherPage() {
  const { data: session, status: sessionStatus } = useSession();
  const router = useRouter();
  const token = session?.accessToken || "";

  const [mode, setMode] = useState("existing");
  const [repos, setRepos] = useState([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);

  const [newRepoName, setNewRepoName] = useState("");
  const [newRepoPrivate, setNewRepoPrivate] = useState(false);
  const [creatingRepo, setCreatingRepo] = useState(false);

  const [commitMsg, setCommitMsg] = useState("Smart diff update via ZIP pusher");
  const [stripRoot, setStripRoot] = useState(true);
  const [zipFile, setZipFile] = useState(null);
  const [logs, setLogs] = useState([]);
  const [status, setStatus] = useState("idle");
  // Summary counts
  const [summary, setSummary] = useState(null);
  const fileRef = useRef();
  const logsEndRef = useRef();

  useEffect(() => {
    if (sessionStatus === "unauthenticated") router.push("/login");
  }, [sessionStatus, router]);

  useEffect(() => {
    if (token && mode === "existing") loadRepos();
  }, [token, mode]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const loadRepos = async () => {
    setReposLoading(true);
    try {
      const data = await fetchUserRepos(token);
      setRepos(data);
    } catch (e) {
      // silent
    } finally {
      setReposLoading(false);
    }
  };

  const filteredRepos = repos.filter(r =>
    r.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const log = (msg, type = "info") =>
    setLogs(prev => [...prev, { msg, type, time: new Date().toLocaleTimeString() }]);

  const handleCreateRepo = async () => {
    if (!newRepoName.trim()) return;
    setCreatingRepo(true);
    try {
      const repo = await createRepo(newRepoName.trim(), newRepoPrivate, token);
      log(`✅ Repo create ho gayi: ${repo.full_name}`, "success");
      await loadRepos();
      setSelectedRepo(repo.full_name);
      setMode("existing");
    } catch (e) {
      log(`❌ Repo create error: ${e.message}`, "error");
    } finally {
      setCreatingRepo(false);
    }
  };

  const getOwnerRepo = () => {
    if (!selectedRepo) return null;
    const parts = selectedRepo.split("/");
    if (parts.length !== 2) return null;
    return { owner: parts[0], repo: parts[1] };
  };

  const handlePush = async () => {
    const parsed = getOwnerRepo();
    if (!token || !parsed || !zipFile) {
      log("⚠️ Repo select karo aur ZIP file choose karo!", "error");
      return;
    }

    setStatus("running");
    setLogs([]);
    setSummary(null);
    const { owner, repo } = parsed;

    let added = 0, updated = 0, skipped = 0;

    try {
      log(`📦 ZIP read ho raha hai...`);
      const buffer = await readFileAsArrayBuffer(zipFile);
      const rawFiles = parseZip(buffer);
      log(`✅ ${rawFiles.length} files mili ZIP mein`);

      log(`🔓 Files decompress ho rahi hain...`);
      const decompressed = [];
      for (const f of rawFiles) {
        try {
          const data = await decompressFile(f);
          let name = f.name;
          if (stripRoot) {
            const slash = name.indexOf("/");
            if (slash !== -1) name = name.slice(slash + 1);
          }
          if (name) decompressed.push({ name, data });
        } catch (e) {
          log(`⚠️ Skip: ${f.name} — ${e.message}`, "warn");
        }
      }
      log(`✅ ${decompressed.length} files ready`);

      log(`🌐 GitHub repo check kar raha hai...`);
      const branch = await getDefaultBranch(owner, repo, token);
      log(`✅ Branch: ${branch}`);

      const latestSha = await getLatestCommitSha(owner, repo, branch, token);
      log(`✅ Latest commit: ${latestSha.slice(0, 7)}`);

      const baseTreeSha = await getTreeSha(owner, repo, latestSha, token);
      log(`✅ Base tree: ${baseTreeSha.slice(0, 7)}`);

      log(`🔍 Repo ki existing files fetch kar raha hai (diff ke liye)...`);
      const repoFileMap = await fetchRepoTree(owner, repo, baseTreeSha, token);
      const repoFileCount = Object.keys(repoFileMap).length;
      log(`✅ Repo mein ${repoFileCount} existing files mili`);

      log(`⚖️ Diff compare kar raha hai...`);
      const filesToPush = [];

      for (const { name, data } of decompressed) {
        const localSha = await computeGitBlobSha(data);
        const remoteSha = repoFileMap[name];

        if (!remoteSha) {
          filesToPush.push({ name, data, status: "added" });
        } else if (localSha !== remoteSha) {
          filesToPush.push({ name, data, status: "updated" });
        } else {
          skipped++;
          // Only log skipped if count is small to avoid spam
        }
      }

      log(`📊 Diff result: ${filesToPush.filter(f=>f.status==="added").length} naye, ${filesToPush.filter(f=>f.status==="updated").length} changed, ${skipped} unchanged (skip)`);

      if (filesToPush.length === 0) {
        log(`🎉 Sab files already up-to-date hain! Kuch push karne ki zaroorat nahi.`, "success");
        setSummary({ added: 0, updated: 0, skipped });
        setStatus("done");
        return;
      }

      log(`⬆️ Sirf changed/new files upload ho rahe hain (${filesToPush.length} files)...`);
      const treeItems = [];
      for (let i = 0; i < filesToPush.length; i++) {
        const { name, data, status: fileStatus } = filesToPush[i];
        const b64 = uint8ToBase64(data);
        const icon = fileStatus === "added" ? "🆕" : "✏️";
        const label = fileStatus === "added" ? "ADDED" : "UPDATED";
        log(`  ${icon} [${i + 1}/${filesToPush.length}] ${label}: ${name}`);
        const blobSha = await createBlob(owner, repo, b64, token);
        treeItems.push({ path: name, mode: "100644", type: "blob", sha: blobSha });
        if (fileStatus === "added") added++;
        else updated++;
      }

      log(`🌳 Tree create ho raha hai (base tree preserve hoga)...`);
      const newTreeSha = await createTree(owner, repo, baseTreeSha, treeItems, token);

      log(`💬 Commit ban raha hai...`);
      const newCommitSha = await createCommit(owner, repo, commitMsg, newTreeSha, latestSha, token);

      log(`🚀 Push ho raha hai ${branch} par...`);
      await updateRef(owner, repo, branch, newCommitSha, token);

      log(`🎉 Done! Commit: ${newCommitSha.slice(0, 7)} → ${owner}/${repo}@${branch}`, "success");
      setSummary({ added, updated, skipped });
      setStatus("done");
    } catch (e) {
      log(`❌ Error: ${e.message}`, "error");
      setStatus("error");
    }
  };

  const logColors = { info: "#c9d1d9", warn: "#e3b341", error: "#f85149", success: "#3fb950" };

  if (sessionStatus === "loading") {
    return (
      <div style={{ minHeight: "100vh", background: "#0d1117", color: "#8b949e", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "monospace" }}>
        Loading...
      </div>
    );
  }

  if (sessionStatus !== "authenticated") return null;

  return (
    <div style={{
      minHeight: "100vh",
      background: "#0d1117",
      color: "#c9d1d9",
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      padding: "16px",
    }}>
      {/* Header */}
      <div style={{ borderBottom: "1px solid #21262d", paddingBottom: "12px", marginBottom: "20px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ fontSize: "22px" }}>🐙</span>
            <div>
              <div style={{ fontSize: "15px", fontWeight: 700, color: "#f0f6fc" }}>ZIP → GitHub Smart Pusher</div>
              <div style={{ fontSize: "11px", color: "#8b949e" }}>
                {session?.user?.name || session?.user?.email || "Logged in"} · Sirf changed files push hoti hain
              </div>
            </div>
          </div>
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            style={{
              background: "none", border: "1px solid #30363d", color: "#8b949e",
              borderRadius: "6px", padding: "6px 10px", fontSize: "11px", cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Logout
          </button>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>

        {/* Mode Toggle */}
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            onClick={() => { setMode("existing"); }}
            style={{
              flex: 1, padding: "9px", borderRadius: "6px", fontSize: "12px", cursor: "pointer",
              fontFamily: "inherit", fontWeight: 600,
              background: mode === "existing" ? "#238636" : "#161b22",
              color: mode === "existing" ? "#fff" : "#8b949e",
              border: `1px solid ${mode === "existing" ? "#2ea043" : "#30363d"}`,
            }}
          >
            📂 Existing Repo
          </button>
          <button
            onClick={() => setMode("new")}
            style={{
              flex: 1, padding: "9px", borderRadius: "6px", fontSize: "12px", cursor: "pointer",
              fontFamily: "inherit", fontWeight: 600,
              background: mode === "new" ? "#1f6feb" : "#161b22",
              color: mode === "new" ? "#fff" : "#8b949e",
              border: `1px solid ${mode === "new" ? "#388bfd" : "#30363d"}`,
            }}
          >
            ➕ Nayi Repo
          </button>
        </div>

        {/* Existing Repo Selector */}
        {mode === "existing" && (
          <div style={{ position: "relative" }}>
            <label style={{ fontSize: "11px", color: "#8b949e", display: "block", marginBottom: "5px" }}>
              📁 Repo Select Karo {reposLoading && <span style={{ color: "#6e7681" }}>— load ho raha hai...</span>}
            </label>
            <div
              onClick={() => setShowDropdown(p => !p)}
              style={{
                width: "100%", boxSizing: "border-box",
                background: "#161b22", border: "1px solid #30363d",
                color: selectedRepo ? "#c9d1d9" : "#6e7681",
                borderRadius: "6px", padding: "10px 12px", fontSize: "12px",
                cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center",
              }}
            >
              <span>{selectedRepo || "— Repo choose karo —"}</span>
              <span style={{ color: "#6e7681" }}>{showDropdown ? "▲" : "▼"}</span>
            </div>

            {showDropdown && (
              <div style={{
                position: "absolute", top: "100%", left: 0, right: 0, zIndex: 10,
                background: "#161b22", border: "1px solid #30363d", borderRadius: "6px",
                marginTop: "4px", maxHeight: "220px", overflowY: "auto",
              }}>
                <div style={{ padding: "6px" }}>
                  <input
                    autoFocus
                    type="text"
                    placeholder="Search repos..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    onClick={e => e.stopPropagation()}
                    style={{
                      width: "100%", boxSizing: "border-box",
                      background: "#0d1117", border: "1px solid #30363d",
                      color: "#c9d1d9", borderRadius: "4px",
                      padding: "7px 10px", fontSize: "11px", outline: "none",
                    }}
                  />
                </div>
                {filteredRepos.length === 0 && (
                  <div style={{ padding: "10px 12px", fontSize: "11px", color: "#6e7681" }}>
                    {reposLoading ? "Loading..." : "Koi repo nahi mila"}
                  </div>
                )}
                {filteredRepos.map(r => (
                  <div
                    key={r.full_name}
                    onClick={() => { setSelectedRepo(r.full_name); setShowDropdown(false); setSearchQuery(""); }}
                    style={{
                      padding: "9px 12px", fontSize: "12px", cursor: "pointer",
                      background: selectedRepo === r.full_name ? "#1f2937" : "transparent",
                      borderBottom: "1px solid #21262d",
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                    }}
                  >
                    <span style={{ color: "#c9d1d9" }}>{r.name}</span>
                    <span style={{ fontSize: "10px", color: "#6e7681" }}>{r.private ? "🔒" : "🌐"}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* New Repo Creator */}
        {mode === "new" && (
          <div style={{
            background: "#161b22", border: "1px solid #30363d",
            borderRadius: "8px", padding: "14px",
            display: "flex", flexDirection: "column", gap: "10px",
          }}>
            <label style={{ fontSize: "11px", color: "#8b949e" }}>🆕 Nayi Repo Ka Naam</label>
            <input
              type="text"
              value={newRepoName}
              onChange={e => setNewRepoName(e.target.value.replace(/\s/g, "-"))}
              placeholder="my-awesome-project"
              style={{
                width: "100%", boxSizing: "border-box",
                background: "#0d1117", border: "1px solid #30363d",
                color: "#c9d1d9", borderRadius: "6px",
                padding: "9px 12px", fontSize: "12px", outline: "none",
              }}
            />
            <div
              onClick={() => setNewRepoPrivate(p => !p)}
              style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer" }}
            >
              <div style={{
                width: "36px", height: "20px", borderRadius: "10px",
                background: newRepoPrivate ? "#1f6feb" : "#30363d",
                position: "relative", transition: "background 0.2s", flexShrink: 0,
              }}>
                <div style={{
                  position: "absolute", top: "3px",
                  left: newRepoPrivate ? "18px" : "3px",
                  width: "14px", height: "14px",
                  borderRadius: "50%", background: "#fff",
                  transition: "left 0.2s",
                }} />
              </div>
              <span style={{ fontSize: "12px", color: "#c9d1d9" }}>
                {newRepoPrivate ? "🔒 Private" : "🌐 Public"}
              </span>
            </div>
            <button
              onClick={handleCreateRepo}
              disabled={creatingRepo || !newRepoName.trim()}
              style={{
                padding: "10px", borderRadius: "6px", fontSize: "12px",
                fontFamily: "inherit", fontWeight: 600, cursor: "pointer",
                background: creatingRepo || !newRepoName.trim() ? "#161b22" : "#1f6feb",
                color: creatingRepo || !newRepoName.trim() ? "#6e7681" : "#fff",
                border: "1px solid #388bfd",
              }}
            >
              {creatingRepo ? "⏳ Ban rahi hai..." : "✅ Repo Banao"}
            </button>
          </div>
        )}

        {/* Commit Message */}
        <div>
          <label style={{ fontSize: "11px", color: "#8b949e", display: "block", marginBottom: "5px" }}>
            💬 Commit Message
          </label>
          <input
            type="text"
            value={commitMsg}
            onChange={e => setCommitMsg(e.target.value)}
            style={{
              width: "100%", boxSizing: "border-box",
              background: "#161b22", border: "1px solid #30363d",
              color: "#c9d1d9", borderRadius: "6px",
              padding: "10px 12px", fontSize: "12px",
            }}
          />
        </div>

        {/* ZIP Upload */}
        <div>
          <label style={{ fontSize: "11px", color: "#8b949e", display: "block", marginBottom: "5px" }}>
            📦 ZIP File
          </label>
          <div
            onClick={() => fileRef.current?.click()}
            style={{
              border: "2px dashed #30363d",
              borderRadius: "8px",
              padding: "20px",
              textAlign: "center",
              cursor: "pointer",
              background: zipFile ? "#0d2130" : "#0d1117",
              borderColor: zipFile ? "#238636" : "#30363d",
              transition: "all 0.2s",
            }}
          >
            <div style={{ fontSize: "24px", marginBottom: "6px" }}>
              {zipFile ? "✅" : "📂"}
            </div>
            <div style={{ fontSize: "12px", color: zipFile ? "#3fb950" : "#8b949e" }}>
              {zipFile ? zipFile.name : "ZIP file select karo"}
            </div>
            {zipFile && (
              <div style={{ fontSize: "10px", color: "#6e7681", marginTop: "3px" }}>
                {(zipFile.size / 1024).toFixed(1)} KB
              </div>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".zip"
            style={{ display: "none" }}
            onChange={e => setZipFile(e.target.files[0] || null)}
          />
        </div>

        {/* Strip Root Toggle */}
        <div
          onClick={() => setStripRoot(p => !p)}
          style={{
            display: "flex", alignItems: "center", gap: "10px",
            cursor: "pointer", padding: "10px 12px",
            background: "#161b22", borderRadius: "6px",
            border: "1px solid #30363d",
          }}
        >
          <div style={{
            width: "36px", height: "20px", borderRadius: "10px",
            background: stripRoot ? "#238636" : "#30363d",
            position: "relative", transition: "background 0.2s",
          }}>
            <div style={{
              position: "absolute", top: "3px",
              left: stripRoot ? "18px" : "3px",
              width: "14px", height: "14px",
              borderRadius: "50%", background: "#fff",
              transition: "left 0.2s",
            }} />
          </div>
          <div>
            <div style={{ fontSize: "12px", color: "#c9d1d9" }}>Root folder strip karo</div>
            <div style={{ fontSize: "10px", color: "#6e7681" }}>
              ZIP ka pehla folder hata do (e.g. project-main/ → /)
            </div>
          </div>
        </div>

        {/* Smart Diff Info Banner */}
        <div style={{
          background: "#0d2130", border: "1px solid #1f6feb44",
          borderRadius: "8px", padding: "10px 14px",
          fontSize: "11px", color: "#58a6ff",
          display: "flex", gap: "8px", alignItems: "flex-start",
        }}>
          <span>🧠</span>
          <div>
            <strong>Smart Diff Mode ON</strong> — ZIP ki files ko repo se compare kiya jayega.
            Sirf <span style={{ color: "#3fb950" }}>naye (🆕)</span> aur <span style={{ color: "#e3b341" }}>changed (✏️)</span> files push hongi.
            Repo ki baaki files safe rahengi.
          </div>
        </div>

        {/* Push Button */}
        <button
          onClick={handlePush}
          disabled={status === "running" || !selectedRepo}
          style={{
            width: "100%",
            padding: "13px",
            background: status === "running" || !selectedRepo ? "#161b22" : "#238636",
            color: status === "running" || !selectedRepo ? "#8b949e" : "#fff",
            border: "1px solid #2ea043",
            borderRadius: "8px",
            fontSize: "14px",
            fontWeight: 700,
            cursor: status === "running" || !selectedRepo ? "not-allowed" : "pointer",
            transition: "all 0.2s",
            fontFamily: "inherit",
          }}
        >
          {status === "running" ? "⏳ Diff check + push ho raha hai..." : "🚀 Smart Push Karo"}
        </button>

        {/* Summary Card */}
        {summary && (
          <div style={{
            background: "#0d1f0d", border: "1px solid #2ea04344",
            borderRadius: "8px", padding: "12px 14px",
          }}>
            <div style={{ fontSize: "11px", color: "#3fb950", fontWeight: 700, marginBottom: "8px" }}>
              ✅ Push Complete — Summary
            </div>
            <div style={{ display: "flex", gap: "12px" }}>
              <div style={{ textAlign: "center", flex: 1 }}>
                <div style={{ fontSize: "20px", fontWeight: 700, color: "#3fb950" }}>{summary.added}</div>
                <div style={{ fontSize: "10px", color: "#6e7681" }}>🆕 Added</div>
              </div>
              <div style={{ textAlign: "center", flex: 1 }}>
                <div style={{ fontSize: "20px", fontWeight: 700, color: "#e3b341" }}>{summary.updated}</div>
                <div style={{ fontSize: "10px", color: "#6e7681" }}>✏️ Updated</div>
              </div>
              <div style={{ textAlign: "center", flex: 1 }}>
                <div style={{ fontSize: "20px", fontWeight: 700, color: "#6e7681" }}>{summary.skipped}</div>
                <div style={{ fontSize: "10px", color: "#6e7681" }}>⏭️ Skipped</div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Logs */}
      {logs.length > 0 && (
        <div style={{
          marginTop: "20px",
          background: "#010409",
          border: "1px solid #21262d",
          borderRadius: "8px",
          padding: "12px",
          maxHeight: "300px",
          overflowY: "auto",
        }}>
          <div style={{ fontSize: "10px", color: "#6e7681", marginBottom: "8px" }}>📋 LOGS</div>
          {logs.map((l, i) => (
            <div key={i} style={{ fontSize: "11px", color: logColors[l.type] || "#c9d1d9", marginBottom: "3px", lineHeight: 1.5 }}>
              <span style={{ color: "#484f58" }}>{l.time} </span>{l.msg}
            </div>
          ))}
          <div ref={logsEndRef} />
        </div>
      )}

      <div style={{ marginTop: "20px", fontSize: "10px", color: "#6e7681", textAlign: "center" }}>
        GitHub session se token milta hai — kahi manually store nahi hota
      </div>
    </div>
  );
}
