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

  const [repoUrl, setRepoUrl] = useState("");
  const [commitMsg, setCommitMsg] = useState("Update via ZIP pusher");
  const [stripRoot, setStripRoot] = useState(true);
  const [zipFile, setZipFile] = useState(null);
  const [logs, setLogs] = useState([]);
  const [status, setStatus] = useState("idle");
  const fileRef = useRef();

  useEffect(() => {
    if (sessionStatus === "unauthenticated") {
      router.push("/login");
    }
  }, [sessionStatus, router]);

  const log = (msg, type = "info") => setLogs(prev => [...prev, { msg, type, time: new Date().toLocaleTimeString() }]);

  const parseRepoUrl = (url) => {
    const match = url.match(/github\.com\/([^/]+)\/([^/\s]+)/);
    if (match) return { owner: match[1], repo: match[2].replace(/\.git$/, "") };
    const simple = url.trim().match(/^([^/]+)\/([^/]+)$/);
    if (simple) return { owner: simple[1], repo: simple[2] };
    return null;
  };

  const handlePush = async () => {
    if (!token || !repoUrl || !zipFile) {
      log("⚠️ Sab fields fill karo!", "error");
      return;
    }

    const parsed = parseRepoUrl(repoUrl);
    if (!parsed) {
      log("❌ Repo URL format galat hai. Use: https://github.com/user/repo", "error");
      return;
    }

    setStatus("running");
    setLogs([]);
    const { owner, repo } = parsed;

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

      log(`⬆️ Blobs upload ho rahe hain GitHub par...`);
      const treeItems = [];
      for (let i = 0; i < decompressed.length; i++) {
        const { name, data } = decompressed[i];
        const b64 = uint8ToBase64(data);
        log(`  [${i + 1}/${decompressed.length}] ${name}`);
        const blobSha = await createBlob(owner, repo, b64, token);
        treeItems.push({ path: name, mode: "100644", type: "blob", sha: blobSha });
      }

      log(`🌳 Tree create ho raha hai...`);
      const newTreeSha = await createTree(owner, repo, baseTreeSha, treeItems, token);

      log(`💬 Commit ban raha hai...`);
      const newCommitSha = await createCommit(owner, repo, commitMsg, newTreeSha, latestSha, token);

      log(`🚀 Push ho raha hai ${branch} par...`);
      await updateRef(owner, repo, branch, newCommitSha, token);

      log(`🎉 Done! Commit: ${newCommitSha.slice(0, 7)} pushed to ${owner}/${repo}@${branch}`, "success");
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

  if (sessionStatus !== "authenticated") {
    return null; // redirecting to /login
  }

  return (
    <div style={{
      minHeight: "100vh",
      background: "#0d1117",
      color: "#c9d1d9",
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      padding: "16px",
    }}>
      <div style={{ borderBottom: "1px solid #21262d", paddingBottom: "12px", marginBottom: "20px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ fontSize: "22px" }}>🐙</span>
            <div>
              <div style={{ fontSize: "15px", fontWeight: 700, color: "#f0f6fc" }}>ZIP → GitHub Pusher</div>
              <div style={{ fontSize: "11px", color: "#8b949e" }}>
                {session?.user?.name || session?.user?.email || "Logged in"}
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

        <div>
          <label style={{ fontSize: "11px", color: "#8b949e", display: "block", marginBottom: "5px" }}>
            📁 Repository URL ya owner/repo
          </label>
          <input
            type="text"
            value={repoUrl}
            onChange={e => setRepoUrl(e.target.value)}
            placeholder="https://github.com/username/repo-name"
            style={{
              width: "100%", boxSizing: "border-box",
              background: "#161b22", border: "1px solid #30363d",
              color: "#c9d1d9", borderRadius: "6px",
              padding: "10px 12px", fontSize: "12px",
            }}
          />
        </div>

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

        <button
          onClick={handlePush}
          disabled={status === "running"}
          style={{
            width: "100%",
            padding: "13px",
            background: status === "running" ? "#161b22" : "#238636",
            color: status === "running" ? "#8b949e" : "#fff",
            border: "1px solid #2ea043",
            borderRadius: "8px",
            fontSize: "14px",
            fontWeight: 700,
            cursor: status === "running" ? "not-allowed" : "pointer",
            transition: "all 0.2s",
            fontFamily: "inherit",
          }}
        >
          {status === "running" ? "⏳ Push ho raha hai..." : "🚀 GitHub Par Push Karo"}
        </button>
      </div>

      {logs.length > 0 && (
        <div style={{
          marginTop: "20px",
          background: "#010409",
          border: "1px solid #21262d",
          borderRadius: "8px",
          padding: "12px",
          maxHeight: "280px",
          overflowY: "auto",
        }}>
          <div style={{ fontSize: "10px", color: "#6e7681", marginBottom: "8px" }}>📋 LOGS</div>
          {logs.map((l, i) => (
            <div key={i} style={{ fontSize: "11px", color: logColors[l.type] || "#c9d1d9", marginBottom: "3px", lineHeight: 1.5 }}>
              <span style={{ color: "#484f58" }}>{l.time} </span>{l.msg}
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: "20px", fontSize: "10px", color: "#6e7681", textAlign: "center" }}>
        GitHub session se token milta hai — kahi manually store nahi hota
      </div>
    </div>
  );
}
