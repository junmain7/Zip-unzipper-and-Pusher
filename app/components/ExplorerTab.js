"use client";

import { useState, useEffect, useCallback, useRef } from "react";

// ─── GitHub API helpers ───────────────────────────────────────────────────────

async function ghFetch(path, token, opts = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      ...(opts.headers || {}),
    },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || `GitHub error ${res.status}`);
  return data;
}

function b64Decode(str) {
  try { return decodeURIComponent(escape(atob(str.replace(/\n/g, "")))); }
  catch { return atob(str.replace(/\n/g, "")); }
}

function b64Encode(str) {
  try { return btoa(unescape(encodeURIComponent(str))); }
  catch { return btoa(str); }
}

// ─── Single file row ──────────────────────────────────────────────────────────

function FileRow({ item, depth, onOpen, activeFile }) {
  const isActive = activeFile?.path === item.path;
  return (
    <button
      onClick={() => onOpen(item)}
      style={{
        width: "100%", textAlign: "left", background: isActive ? "#1f2937" : "transparent",
        border: "none", borderRadius: "5px", padding: `6px 8px 6px ${12 + depth * 14}px`,
        cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center",
        gap: "6px", color: isActive ? "#c9d1d9" : "#8b949e", fontSize: "11.5px",
        transition: "background 0.1s",
      }}
    >
      <span style={{ flexShrink: 0 }}>
        {item.type === "dir" ? "📁" : getFileIcon(item.name)}
      </span>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {item.name}
      </span>
    </button>
  );
}

function getFileIcon(name) {
  const ext = name.split(".").pop().toLowerCase();
  const map = { js: "🟨", jsx: "🟨", ts: "🔷", tsx: "🔷", json: "📋", md: "📝", css: "🎨", html: "🌐", env: "🔐", py: "🐍", sh: "⚙️", yml: "⚙️", yaml: "⚙️", png: "🖼️", jpg: "🖼️", jpeg: "🖼️", svg: "🖼️", gif: "🖼️", lock: "🔒" };
  return map[ext] || "📄";
}

// ─── Recursive tree node ──────────────────────────────────────────────────────

function TreeNode({ item, depth, token, onOpenFile, activeFile }) {
  const [open, setOpen]         = useState(false);
  const [children, setChildren] = useState(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");

  const owner = activeFile?._owner;
  const repo  = activeFile?._repo;

  const toggleDir = async () => {
    if (item.type !== "dir") return;
    if (!open && children === null) {
      setLoading(true);
      try {
        const [o, r] = item._repoPath.split("/");
        const items = await ghFetch(`/repos/${o}/${r}/contents/${item.path}`, token);
        const sorted = [...items].sort((a, b) => {
          if (a.type === b.type) return a.name.localeCompare(b.name);
          return a.type === "dir" ? -1 : 1;
        });
        setChildren(sorted.map(i => ({ ...i, _repoPath: item._repoPath })));
      } catch (e) { setError(e.message); }
      finally { setLoading(false); }
    }
    setOpen(p => !p);
  };

  if (item.type === "dir") {
    return (
      <div>
        <button
          onClick={toggleDir}
          style={{
            width: "100%", textAlign: "left", background: "transparent", border: "none",
            borderRadius: "5px", padding: `6px 8px 6px ${12 + depth * 14}px`,
            cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center",
            gap: "6px", color: "#c9d1d9", fontSize: "11.5px",
          }}
        >
          <span style={{ fontSize: "10px", color: "#6e7681", width: "10px", flexShrink: 0 }}>{open ? "▼" : "▶"}</span>
          <span>📁</span>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</span>
          {loading && <span style={{ fontSize: "10px", color: "#6e7681", marginLeft: "auto" }}>⏳</span>}
        </button>
        {error && <div style={{ fontSize: "10px", color: "#f85149", padding: `2px 8px 2px ${12 + depth * 14 + 26}px` }}>⚠️ {error}</div>}
        {open && children && (
          <div>
            {children.map(child => (
              <TreeNode key={child.sha + child.path} item={child} depth={depth + 1} token={token} onOpenFile={onOpenFile} activeFile={activeFile} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return <FileRow item={item} depth={depth} onOpen={onOpenFile} activeFile={activeFile} />;
}

// ─── Main ExplorerTab component ───────────────────────────────────────────────

export default function ExplorerTab({ token, selectedRepo, setSelectedRepo }) {
  // Repo input — reuse parent selectedRepo or allow manual override
  const [repoInput, setRepoInput]   = useState(selectedRepo || "");
  const [targetRepo, setTargetRepo] = useState(selectedRepo || ""); // locked repo being browsed

  // Repo root listing
  const [rootItems, setRootItems]   = useState(null);
  const [rootLoading, setRootLoading] = useState(false);
  const [rootError, setRootError]   = useState("");

  // Currently open file
  const [activeFile, setActiveFile] = useState(null); // {name, path, sha, _owner, _repo}
  const [fileContent, setFileContent] = useState("");
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError]   = useState("");

  // Editor state
  const [edited, setEdited]         = useState("");
  const [isDirty, setIsDirty]       = useState(false);
  const [commitMsg, setCommitMsg]   = useState("");
  const [saving, setSaving]         = useState(false);
  const [saveResult, setSaveResult] = useState(null); // {ok, msg}

  // Panel: "tree" | "editor"
  const [panel, setPanel]           = useState("tree");
  const textareaRef                 = useRef(null);

  // Sync repoInput when parent selectedRepo changes
  useEffect(() => {
    if (selectedRepo && selectedRepo !== repoInput) setRepoInput(selectedRepo);
  }, [selectedRepo]);

  const loadRepo = useCallback(async (repoPath) => {
    const rp = repoPath.trim();
    if (!rp || !rp.includes("/")) { setRootError("Format: owner/repo"); return; }
    setRootLoading(true); setRootError(""); setRootItems(null);
    setActiveFile(null); setFileContent(""); setEdited(""); setIsDirty(false); setSaveResult(null);
    try {
      const items = await ghFetch(`/repos/${rp}/contents`, token);
      const sorted = [...items].sort((a, b) => {
        if (a.type === b.type) return a.name.localeCompare(b.name);
        return a.type === "dir" ? -1 : 1;
      });
      setRootItems(sorted.map(i => ({ ...i, _repoPath: rp })));
      setTargetRepo(rp);
    } catch (e) {
      setRootError(e.message);
    } finally {
      setRootLoading(false);
    }
  }, [token]);

  // Auto-load if selectedRepo already set
  useEffect(() => {
    if (selectedRepo && !rootItems && !rootLoading) loadRepo(selectedRepo);
  }, []);

  const openFile = async (item) => {
    if (item.type === "dir") return;
    const [owner, repo] = item._repoPath.split("/");
    setActiveFile({ ...item, _owner: owner, _repo: repo });
    setFileLoading(true); setFileError(""); setFileContent(""); setEdited("");
    setIsDirty(false); setSaveResult(null); setPanel("editor");
    try {
      const data = await ghFetch(`/repos/${owner}/${repo}/contents/${item.path}`, token);
      if (data.encoding === "base64") {
        const decoded = b64Decode(data.content);
        setFileContent(decoded);
        setEdited(decoded);
        // Update sha (always fresh before edit)
        setActiveFile(prev => ({ ...prev, sha: data.sha }));
      } else {
        setFileContent("(Binary file — edit nahi ho sakta)");
        setEdited("");
      }
    } catch (e) {
      setFileError(e.message);
    } finally {
      setFileLoading(false);
    }
  };

  const handleEditorChange = (val) => {
    setEdited(val);
    setIsDirty(val !== fileContent);
    setSaveResult(null);
  };

  const handleSave = async () => {
    if (!activeFile || !isDirty) return;
    if (!commitMsg.trim()) { setSaveResult({ ok: false, msg: "Commit message daalo" }); return; }
    setSaving(true); setSaveResult(null);
    try {
      await ghFetch(`/repos/${activeFile._owner}/${activeFile._repo}/contents/${activeFile.path}`, token, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: commitMsg.trim(),
          content: b64Encode(edited),
          sha: activeFile.sha,
        }),
      });
      setFileContent(edited);
      setIsDirty(false);
      setCommitMsg("");
      setSaveResult({ ok: true, msg: "✅ Saved & committed!" });
    } catch (e) {
      setSaveResult({ ok: false, msg: `❌ ${e.message}` });
    } finally {
      setSaving(false);
    }
  };

  const isBinary = fileContent === "(Binary file — edit nahi ho sakta)";

  // ── Styles ──
  const inp = { width: "100%", boxSizing: "border-box", background: "#0d1117", border: "1px solid #30363d", color: "#c9d1d9", borderRadius: "6px", padding: "8px 10px", fontSize: "11.5px", outline: "none", fontFamily: "inherit" };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: "12px" }}>

      {/* ── Repo selector ── */}
      <div style={{ display: "flex", gap: "8px" }}>
        <input
          type="text"
          value={repoInput}
          onChange={e => setRepoInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && loadRepo(repoInput)}
          placeholder="owner/repo"
          style={{ ...inp, flex: 1 }}
        />
        <button
          onClick={() => loadRepo(repoInput)}
          disabled={rootLoading || !repoInput.trim()}
          style={{
            padding: "8px 14px", borderRadius: "6px", fontSize: "12px", fontFamily: "inherit",
            fontWeight: 700, cursor: rootLoading || !repoInput.trim() ? "not-allowed" : "pointer",
            background: rootLoading || !repoInput.trim() ? "#161b22" : "#1f6feb",
            color: rootLoading || !repoInput.trim() ? "#6e7681" : "#fff",
            border: "1px solid #388bfd", flexShrink: 0,
          }}
        >
          {rootLoading ? "⏳" : "Browse"}
        </button>
      </div>

      {rootError && <div style={{ fontSize: "11px", color: "#f85149" }}>⚠️ {rootError}</div>}

      {/* ── Tree / Editor tabs ── */}
      {rootItems && (
        <div style={{ display: "flex", background: "#0d1117", border: "1px solid #30363d", borderRadius: "8px", padding: "3px", gap: "3px", flexShrink: 0 }}>
          <button onClick={() => setPanel("tree")} style={{ flex: 1, padding: "7px", borderRadius: "6px", fontSize: "11px", fontFamily: "inherit", fontWeight: 700, cursor: "pointer", border: "none", background: panel === "tree" ? "#1f6feb" : "transparent", color: panel === "tree" ? "#fff" : "#8b949e" }}>
            📂 Files
          </button>
          <button onClick={() => setPanel("editor")} disabled={!activeFile} style={{ flex: 1, padding: "7px", borderRadius: "6px", fontSize: "11px", fontFamily: "inherit", fontWeight: 700, cursor: !activeFile ? "not-allowed" : "pointer", border: "none", background: panel === "editor" ? "#1f6feb" : "transparent", color: panel === "editor" ? "#fff" : !activeFile ? "#484f58" : "#8b949e" }}>
            ✏️ Editor {isDirty && <span style={{ color: "#e3b341" }}>●</span>}
          </button>
        </div>
      )}

      {/* ── File tree panel ── */}
      {panel === "tree" && rootItems && (
        <div style={{ background: "#0d1117", border: "1px solid #30363d", borderRadius: "8px", overflow: "hidden", flex: 1 }}>
          {/* Repo header */}
          <div style={{ padding: "9px 12px", borderBottom: "1px solid #21262d", display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ fontSize: "13px" }}>📦</span>
            <span style={{ fontSize: "12px", fontWeight: 700, color: "#c9d1d9" }}>{targetRepo}</span>
          </div>
          <div style={{ overflowY: "auto", maxHeight: "55vh", padding: "6px" }}>
            {rootItems.map(item => (
              <TreeNode key={item.sha + item.path} item={item} depth={0} token={token} onOpenFile={openFile} activeFile={activeFile} />
            ))}
          </div>
        </div>
      )}

      {/* ── Editor panel ── */}
      {panel === "editor" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px", flex: 1 }}>
          {!activeFile ? (
            <div style={{ background: "#0d1117", border: "1px solid #30363d", borderRadius: "8px", padding: "32px 16px", textAlign: "center", color: "#484f58", fontSize: "12px" }}>
              📂 Pehle Files tab se koi file kholo
            </div>
          ) : (
            <>
              {/* File path bar */}
              <div style={{ display: "flex", alignItems: "center", gap: "8px", background: "#0d1117", border: "1px solid #30363d", borderRadius: "8px", padding: "9px 12px" }}>
                <span style={{ fontSize: "14px" }}>{getFileIcon(activeFile.name)}</span>
                <span style={{ fontSize: "11px", color: "#8b949e", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                  {activeFile.path}
                </span>
                {isDirty && <span style={{ fontSize: "10px", color: "#e3b341", flexShrink: 0 }}>● unsaved</span>}
              </div>

              {fileLoading && <div style={{ fontSize: "11px", color: "#6e7681", textAlign: "center", padding: "16px" }}>⏳ File load ho rahi hai…</div>}
              {fileError  && <div style={{ fontSize: "11px", color: "#f85149" }}>⚠️ {fileError}</div>}

              {!fileLoading && fileContent && (
                <textarea
                  ref={textareaRef}
                  value={isBinary ? fileContent : edited}
                  onChange={e => !isBinary && handleEditorChange(e.target.value)}
                  readOnly={isBinary}
                  spellCheck={false}
                  style={{
                    ...inp,
                    flex: 1, minHeight: "38vh", resize: "vertical",
                    fontFamily: "'JetBrains Mono','Fira Code',monospace",
                    fontSize: "11px", lineHeight: 1.6,
                    color: isBinary ? "#484f58" : "#c9d1d9",
                    padding: "12px",
                  }}
                />
              )}

              {/* Save bar */}
              {!isBinary && fileContent && !fileLoading && (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px", background: "#0d1117", border: "1px solid #30363d", borderRadius: "8px", padding: "12px" }}>
                  <input
                    type="text"
                    value={commitMsg}
                    onChange={e => setCommitMsg(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && isDirty && !saving && handleSave()}
                    placeholder="Commit message…"
                    style={inp}
                  />
                  <button
                    onClick={handleSave}
                    disabled={!isDirty || saving || !commitMsg.trim()}
                    style={{
                      padding: "9px", borderRadius: "6px", fontSize: "12px", fontFamily: "inherit",
                      fontWeight: 700, cursor: !isDirty || saving || !commitMsg.trim() ? "not-allowed" : "pointer",
                      background: !isDirty || saving || !commitMsg.trim() ? "#161b22" : "#238636",
                      color: !isDirty || saving || !commitMsg.trim() ? "#6e7681" : "#fff",
                      border: "1px solid #2ea043",
                    }}
                  >
                    {saving ? "⏳ Save ho raha hai…" : isDirty ? "💾 Save & Commit" : "✅ Saved"}
                  </button>
                  {saveResult && (
                    <div style={{ fontSize: "11px", color: saveResult.ok ? "#3fb950" : "#f85149" }}>
                      {saveResult.msg}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
