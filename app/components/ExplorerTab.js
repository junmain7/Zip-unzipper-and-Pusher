"use client";

import { useState, useEffect, useCallback, useRef } from "react";

// ─── GitHub API ───────────────────────────────────────────────────────────────

async function gh(path, token, opts = {}) {
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

// ─── File icon ────────────────────────────────────────────────────────────────

function fileIcon(name) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  const m = { js:"📄",jsx:"📄",ts:"🔷",tsx:"🔷",json:"📋",md:"📝",css:"🎨",scss:"🎨",html:"🌐",env:"🔐",py:"🐍",sh:"⚙️",yml:"⚙️",yaml:"⚙️",png:"🖼️",jpg:"🖼️",jpeg:"🖼️",svg:"🖼️",gif:"🖼️",webp:"🖼️",lock:"🔒",gitignore:"🙈" };
  return m[ext] || (name.startsWith(".") ? "⚙️" : "📄");
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const S = {
  inp: { width:"100%", boxSizing:"border-box", background:"#0d1117", border:"1px solid #30363d", color:"#c9d1d9", borderRadius:"6px", padding:"8px 10px", fontSize:"11.5px", outline:"none", fontFamily:"inherit" },
  row: (active) => ({ width:"100%", textAlign:"left", background: active ? "#1c2128" : "transparent", border:"none", borderRadius:"5px", padding:"7px 10px", cursor:"pointer", fontFamily:"inherit", display:"flex", alignItems:"center", gap:"8px", color: active ? "#c9d1d9" : "#8b949e", fontSize:"12px" }),
  btn: (primary, disabled) => ({ padding:"8px 16px", borderRadius:"6px", fontSize:"12px", fontFamily:"inherit", fontWeight:700, cursor: disabled ? "not-allowed":"pointer", background: disabled ? "#161b22" : primary ? "#1f6feb":"#21262d", color: disabled ? "#6e7681":"#fff", border:`1px solid ${disabled?"#30363d":primary?"#388bfd":"#30363d"}` }),
};

// ─── Repo List View ───────────────────────────────────────────────────────────

function RepoList({ token, onSelectRepo }) {
  const [repos, setRepos]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");
  const [search, setSearch]   = useState("");

  useEffect(() => {
    (async () => {
      try {
        // Fetch up to 100 repos, sorted by recently updated
        const data = await gh("/user/repos?sort=updated&per_page=100&affiliation=owner,collaborator", token);
        setRepos(data);
      } catch(e) { setError(e.message); }
      finally { setLoading(false); }
    })();
  }, [token]);

  const filtered = repos.filter(r => r.full_name.toLowerCase().includes(search.toLowerCase()));

  if (loading) return (
    <div style={{ display:"flex", flexDirection:"column", gap:"8px" }}>
      {[...Array(6)].map((_,i) => (
        <div key={i} style={{ height:"52px", background:"#161b22", borderRadius:"8px", border:"1px solid #21262d", animation:"pulse 1.5s ease-in-out infinite" }} />
      ))}
      <style>{`@keyframes pulse { 0%,100%{opacity:.5} 50%{opacity:1} }`}</style>
    </div>
  );

  if (error) return <div style={{ fontSize:"12px", color:"#f85149" }}>⚠️ {error}</div>;

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"10px" }}>
      <input
        type="text" value={search} onChange={e => setSearch(e.target.value)}
        placeholder="🔍 Repo search karo..."
        style={{ ...S.inp }}
      />
      <div style={{ display:"flex", flexDirection:"column", gap:"6px" }}>
        {filtered.map(repo => (
          <button key={repo.id} onClick={() => onSelectRepo(repo)}
            style={{ ...S.row(false), background:"#0d1117", border:"1px solid #21262d", borderRadius:"8px", padding:"11px 13px", flexDirection:"column", alignItems:"flex-start", gap:"4px" }}
          >
            <div style={{ display:"flex", alignItems:"center", gap:"8px", width:"100%" }}>
              <span style={{ fontSize:"14px" }}>{repo.private ? "🔒" : "📦"}</span>
              <span style={{ fontSize:"12px", fontWeight:700, color:"#c9d1d9", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", flex:1 }}>{repo.full_name}</span>
              {repo.language && <span style={{ fontSize:"9.5px", background:"#21262d", color:"#8b949e", borderRadius:"4px", padding:"2px 6px", flexShrink:0 }}>{repo.language}</span>}
            </div>
            {repo.description && (
              <span style={{ fontSize:"10.5px", color:"#6e7681", paddingLeft:"22px", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", width:"100%" }}>
                {repo.description}
              </span>
            )}
            <div style={{ paddingLeft:"22px", fontSize:"10px", color:"#484f58", display:"flex", gap:"10px" }}>
              <span>⭐ {repo.stargazers_count}</span>
              <span>🍴 {repo.forks_count}</span>
              <span>Updated: {new Date(repo.updated_at).toLocaleDateString()}</span>
            </div>
          </button>
        ))}
        {filtered.length === 0 && <div style={{ fontSize:"12px", color:"#484f58", textAlign:"center", padding:"24px" }}>Koi repo nahi mila</div>}
      </div>
    </div>
  );
}

// ─── Directory Contents ───────────────────────────────────────────────────────

function DirView({ token, repo, path, onNavigate, onOpenFile, activeFilePath, refreshKey }) {
  const [items, setItems]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");

  useEffect(() => {
    setLoading(true); setError(""); setItems(null);
    (async () => {
      try {
        const apiPath = path ? `/repos/${repo}/contents/${path}` : `/repos/${repo}/contents`;
        const data = await gh(apiPath, token);
        const sorted = [...data].sort((a,b) => {
          if (a.type === b.type) return a.name.localeCompare(b.name);
          return a.type === "dir" ? -1 : 1;
        });
        setItems(sorted);
      } catch(e) { setError(e.message); }
      finally { setLoading(false); }
    })();
  }, [repo, path, token, refreshKey]);

  if (loading) return <div style={{ fontSize:"11px", color:"#6e7681", padding:"16px", textAlign:"center" }}>⏳ Loading…</div>;
  if (error)   return <div style={{ fontSize:"11px", color:"#f85149", padding:"8px" }}>⚠️ {error}</div>;
  if (!items)  return null;

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"2px" }}>
      {items.map(item => (
        <button
          key={item.sha + item.path}
          onClick={() => item.type === "dir" ? onNavigate(item.path) : onOpenFile(item)}
          style={{ ...S.row(activeFilePath === item.path), borderRadius:"6px" }}
        >
          <span style={{ fontSize:"15px", flexShrink:0 }}>
            {item.type === "dir" ? "📁" : fileIcon(item.name)}
          </span>
          <span style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", flex:1 }}>
            {item.name}
          </span>
          {item.type === "dir" && <span style={{ fontSize:"10px", color:"#484f58" }}>▶</span>}
        </button>
      ))}
    </div>
  );
}

// ─── Breadcrumb ───────────────────────────────────────────────────────────────

function Breadcrumb({ repo, path, onGoRepo, onNavigate }) {
  const parts = path ? path.split("/") : [];
  return (
    <div style={{ display:"flex", alignItems:"center", gap:"4px", flexWrap:"wrap", fontSize:"11.5px", padding:"8px 0" }}>
      <button onClick={onGoRepo} style={{ background:"none", border:"none", color:"#58a6ff", cursor:"pointer", fontFamily:"inherit", fontSize:"11.5px", padding:"2px 4px", borderRadius:"4px" }}>
        🏠 {repo.split("/")[0]}
      </button>
      <span style={{ color:"#484f58" }}>/</span>
      <button onClick={() => onNavigate("")} style={{ background:"none", border:"none", color:"#58a6ff", cursor:"pointer", fontFamily:"inherit", fontSize:"11.5px", padding:"2px 4px", borderRadius:"4px" }}>
        {repo.split("/")[1]}
      </button>
      {parts.map((part, i) => (
        <span key={i} style={{ display:"flex", alignItems:"center", gap:"4px" }}>
          <span style={{ color:"#484f58" }}>/</span>
          {i < parts.length - 1 ? (
            <button onClick={() => onNavigate(parts.slice(0,i+1).join("/"))} style={{ background:"none", border:"none", color:"#58a6ff", cursor:"pointer", fontFamily:"inherit", fontSize:"11.5px", padding:"2px 4px", borderRadius:"4px" }}>
              {part}
            </button>
          ) : (
            <span style={{ color:"#c9d1d9", padding:"2px 4px" }}>{part}</span>
          )}
        </span>
      ))}
    </div>
  );
}

// ─── File Editor ─────────────────────────────────────────────────────────────

function FileEditor({ token, repo, fileItem, onBack, onDeleted }) {
  const [content, setContent] = useState("");
  const [original, setOriginal] = useState("");
  const [sha, setSha]         = useState(fileItem.sha);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");
  const [commitMsg, setCommitMsg] = useState(`Update ${fileItem.name}`);
  const [saving, setSaving]   = useState(false);
  const [saveResult, setSaveResult] = useState(null);
  const [search, setSearch]   = useState("");
  const [matchIdx, setMatchIdx] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [aiGenerating, setAiGenerating] = useState(false);

  const textareaRef = useRef(null);
  const gutterRef    = useRef(null);

  const isDirty = content !== original;
  const isBinary = !content && !loading;

  // ── line numbers ──
  const lineCount = content ? content.split("\n").length : 1;
  const handleScroll = () => {
    if (gutterRef.current && textareaRef.current) {
      gutterRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  };

  // ── find in file ──
  const matches = search
    ? [...content.matchAll(new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"))].map(m => m.index)
    : [];

  useEffect(() => { setMatchIdx(0); }, [search]);

  const jumpToMatch = (idx) => {
    if (!matches.length || !textareaRef.current) return;
    const pos = matches[idx];
    const ta = textareaRef.current;
    ta.focus();
    ta.setSelectionRange(pos, pos + search.length);
    const lineNo = content.slice(0, pos).split("\n").length;
    ta.scrollTop = Math.max(0, (lineNo - 6) * 18.7);
    if (gutterRef.current) gutterRef.current.scrollTop = ta.scrollTop;
  };

  const goNext = () => { if (!matches.length) return; const n = (matchIdx + 1) % matches.length; setMatchIdx(n); jumpToMatch(n); };
  const goPrev = () => { if (!matches.length) return; const n = (matchIdx - 1 + matches.length) % matches.length; setMatchIdx(n); jumpToMatch(n); };

  // ── delete file (GitHub style: click once to arm, again to confirm) ──
  const handleDeleteClick = () => {
    if (!confirmDelete) { setConfirmDelete(true); setCommitMsg(`Delete ${fileItem.name}`); return; }
    handleDelete();
  };

  const handleDelete = async () => {
    setDeleting(true); setSaveResult(null);
    try {
      await gh(`/repos/${repo}/contents/${fileItem.path}`, token, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: commitMsg.trim() || `Delete ${fileItem.name}`, sha }),
      });
      onDeleted && onDeleted();
    } catch(e) {
      setSaveResult({ ok:false, msg:`❌ ${e.message}` });
      setConfirmDelete(false);
    } finally { setDeleting(false); }
  };

  useEffect(() => {
    (async () => {
      try {
        const data = await gh(`/repos/${repo}/contents/${fileItem.path}`, token);
        if (data.encoding === "base64") {
          const decoded = b64Decode(data.content);
          setContent(decoded); setOriginal(decoded); setSha(data.sha);
        } else {
          setContent(""); setOriginal("__binary__");
        }
      } catch(e) {
        if (/not found/i.test(e.message)) {
          // stale entry (already deleted on GitHub) — clean it up automatically
          onDeleted && onDeleted();
          return;
        }
        setError(e.message);
      }
      finally { setLoading(false); }
    })();
  }, []);

  const handleSave = async () => {
    if (!isDirty || !commitMsg.trim()) return;
    setSaving(true); setSaveResult(null);
    try {
      await gh(`/repos/${repo}/contents/${fileItem.path}`, token, {
        method:"PUT",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ message: commitMsg.trim(), content: b64Encode(content), sha }),
      });
      setOriginal(content);
      setCommitMsg("");
      setSaveResult({ ok:true, msg:"✅ Commit ho gaya!" });
    } catch(e) {
      setSaveResult({ ok:false, msg:`❌ ${e.message}` });
    } finally { setSaving(false); }
  };

  const handleGenerateCommitMsg = async () => {
    if (!isDirty || aiGenerating) return;
    setAiGenerating(true); setSaveResult(null);
    try {
      const res = await fetch("/api/ai/commit-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: fileItem.name, original, updated: content }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "AI commit message fail ho gaya");
      setCommitMsg(data.message);
    } catch(e) {
      setSaveResult({ ok:false, msg:`❌ ${e.message}` });
    } finally { setAiGenerating(false); }
  };

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"10px" }}>
      {/* File header */}
      <div style={{ display:"flex", alignItems:"center", gap:"8px", background:"#0d1117", border:"1px solid #30363d", borderRadius:"8px", padding:"10px 13px" }}>
        <button onClick={onBack} style={{ background:"none", border:"none", color:"#58a6ff", cursor:"pointer", fontSize:"16px", padding:"0", lineHeight:1 }}>←</button>
        <span style={{ fontSize:"15px" }}>{fileIcon(fileItem.name)}</span>
        <span style={{ fontSize:"12px", color:"#c9d1d9", fontWeight:700, flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{fileItem.path}</span>
        {isDirty && <span style={{ fontSize:"10px", color:"#e3b341", flexShrink:0 }}>● unsaved</span>}
        <button
          onClick={handleDeleteClick}
          disabled={saving || deleting}
          title="Delete file"
          style={{ background:"none", border:"none", color:"#f85149", cursor: deleting ? "not-allowed" : "pointer", fontSize:"15px", padding:"0", lineHeight:1, flexShrink:0 }}
        >
          {deleting ? "⏳" : "🗑️"}
        </button>
      </div>

      {confirmDelete && !deleting && (
        <div style={{ display:"flex", alignItems:"center", gap:"8px", background:"#2d1214", border:"1px solid #f85149", borderRadius:"8px", padding:"9px 13px", fontSize:"11.5px" }}>
          <span style={{ flex:1, color:"#f85149" }}>⚠️ "{fileItem.name}" delete karna pakka hai?</span>
          <button onClick={handleDeleteClick} style={{ ...S.btn(false, false), background:"#da3633", border:"1px solid #f85149", color:"#fff", padding:"5px 10px" }}>Confirm</button>
          <button onClick={() => { setConfirmDelete(false); setCommitMsg(`Update ${fileItem.name}`); }} style={{ ...S.btn(false, false), color:"#8b949e", padding:"5px 10px" }}>Cancel</button>
        </div>
      )}

      {loading && <div style={{ fontSize:"11px", color:"#6e7681", textAlign:"center", padding:"24px" }}>⏳ File load ho rahi hai…</div>}
      {error   && <div style={{ fontSize:"11px", color:"#f85149" }}>⚠️ {error}</div>}

      {!loading && original === "__binary__" && (
        <div style={{ fontSize:"11px", color:"#484f58", textAlign:"center", padding:"24px", background:"#0d1117", border:"1px solid #30363d", borderRadius:"8px" }}>
          🖼️ Binary file — preview supported nahi hai
        </div>
      )}

      {!loading && original !== "__binary__" && (
        <>
          {/* Find bar */}
          <div style={{ display:"flex", alignItems:"center", gap:"6px" }}>
            <input
              type="text" value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") (e.shiftKey ? goPrev() : goNext()); }}
              placeholder="🔍 Find in file..."
              style={{ ...S.inp, flex:1 }}
            />
            <span style={{ fontSize:"10.5px", color:"#6e7681", minWidth:"38px", textAlign:"center" }}>
              {matches.length ? `${matchIdx + 1}/${matches.length}` : search ? "0/0" : ""}
            </span>
            <button onClick={goPrev} disabled={!matches.length} style={{ ...S.btn(false, !matches.length), padding:"6px 10px" }}>↑</button>
            <button onClick={goNext} disabled={!matches.length} style={{ ...S.btn(false, !matches.length), padding:"6px 10px" }}>↓</button>
          </div>

          {/* Editor with line numbers */}
          <div style={{ display:"flex", border:"1px solid #30363d", borderRadius:"6px", overflow:"hidden" }}>
            <div
              ref={gutterRef}
              style={{ background:"#0d1117", color:"#484f58", fontFamily:"'JetBrains Mono','Fira Code',monospace", fontSize:"11px", lineHeight:1.7, padding:"12px 8px", textAlign:"right", userSelect:"none", overflow:"hidden", minHeight:"45vh", maxHeight:"45vh" }}
            >
              {Array.from({ length: lineCount }, (_, i) => <div key={i}>{i + 1}</div>)}
            </div>
            <textarea
              ref={textareaRef}
              value={content}
              onChange={e => { setContent(e.target.value); setSaveResult(null); }}
              onScroll={handleScroll}
              spellCheck={false}
              style={{ ...S.inp, border:"none", borderRadius:0, minHeight:"45vh", maxHeight:"45vh", fontFamily:"'JetBrains Mono','Fira Code',monospace", fontSize:"11px", lineHeight:1.7, padding:"12px", flex:1 }}
            />
          </div>

          <div style={{ background:"#0d1117", border:"1px solid #30363d", borderRadius:"8px", padding:"12px", display:"flex", flexDirection:"column", gap:"8px" }}>
            <div style={{ display:"flex", gap:"6px" }}>
              <input
                type="text" value={commitMsg}
                onChange={e => setCommitMsg(e.target.value)}
                onKeyDown={e => e.key === "Enter" && isDirty && !saving && handleSave()}
                placeholder="Commit message..."
                style={{ ...S.inp, flex:1 }}
              />
              <button
                onClick={handleGenerateCommitMsg}
                disabled={!isDirty || aiGenerating}
                title="AI se commit message banao"
                style={{ ...S.btn(false, !isDirty || aiGenerating), padding:"8px 12px", flexShrink:0 }}
              >
                {aiGenerating ? "⏳" : "✨"}
              </button>
            </div>
            <button onClick={handleSave} disabled={!isDirty || saving || !commitMsg.trim() || deleting} style={S.btn(true, !isDirty || saving || !commitMsg.trim() || deleting)}>
              {saving ? "⏳ Saving…" : isDirty ? "💾 Save & Commit" : "✅ No changes"}
            </button>
            {saveResult && <div style={{ fontSize:"11px", color: saveResult.ok ? "#3fb950":"#f85149" }}>{saveResult.msg}</div>}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Main ExplorerTab ─────────────────────────────────────────────────────────

export default function ExplorerTab({ token }) {
  // view: "repos" | "browser" | "editor"
  const [view, setView]           = useState("repos");
  const [selectedRepo, setSelectedRepo] = useState(null); // repo object
  const [currentPath, setCurrentPath]   = useState("");   // current dir path
  const [openFile, setOpenFile]         = useState(null); // file item being edited
  const [activeFilePath, setActiveFilePath] = useState("");
  const [refreshKey, setRefreshKey]     = useState(0);

  const handleSelectRepo = (repo) => {
    setSelectedRepo(repo);
    setCurrentPath("");
    setOpenFile(null);
    setActiveFilePath("");
    setView("browser");
  };

  const handleNavigate = (path) => {
    setCurrentPath(path);
    setOpenFile(null);
    setActiveFilePath("");
  };

  const handleOpenFile = (item) => {
    setOpenFile(item);
    setActiveFilePath(item.path);
    setView("editor");
  };

  const handleBackToDir = () => {
    setView("browser");
    setOpenFile(null);
  };

  const handleFileDeleted = () => {
    setView("browser");
    setOpenFile(null);
    setActiveFilePath("");
    setRefreshKey(k => k + 1);
  };

  const handleGoRepo = () => {
    setView("repos");
    setSelectedRepo(null);
    setCurrentPath("");
    setOpenFile(null);
    setActiveFilePath("");
  };

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"0" }}>

      {/* ── Repo list ── */}
      {view === "repos" && (
        <RepoList token={token} onSelectRepo={handleSelectRepo} />
      )}

      {/* ── File browser ── */}
      {(view === "browser" || view === "editor") && selectedRepo && (
        <>
          {/* Breadcrumb */}
          <Breadcrumb
            repo={selectedRepo.full_name}
            path={view === "editor" ? openFile?.path : currentPath}
            onGoRepo={handleGoRepo}
            onNavigate={(p) => { handleNavigate(p); setView("browser"); }}
          />

          {/* Back button for parent dir */}
          {view === "browser" && currentPath && (
            <button
              onClick={() => {
                const parts = currentPath.split("/");
                parts.pop();
                setCurrentPath(parts.join("/"));
              }}
              style={{ ...S.row(false), marginBottom:"4px", color:"#58a6ff" }}
            >
              <span>📁</span> <span>..</span>
            </button>
          )}

          {/* Dir contents */}
          {view === "browser" && (
            <div style={{ background:"#0d1117", border:"1px solid #30363d", borderRadius:"8px", padding:"6px", marginTop:"4px" }}>
              <DirView
                token={token}
                repo={selectedRepo.full_name}
                path={currentPath}
                onNavigate={handleNavigate}
                onOpenFile={handleOpenFile}
                activeFilePath={activeFilePath}
                refreshKey={refreshKey}
              />
            </div>
          )}

          {/* Editor */}
          {view === "editor" && openFile && (
            <FileEditor
              token={token}
              repo={selectedRepo.full_name}
              fileItem={openFile}
              onBack={handleBackToDir}
              onDeleted={handleFileDeleted}
            />
          )}
        </>
      )}
    </div>
  );
}
