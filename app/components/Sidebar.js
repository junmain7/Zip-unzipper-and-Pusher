"use client";

import { useState, useEffect, useRef } from "react";
import {
  loadVercelAccountFromCloud, saveVercelAccountToCloud, disconnectVercelAccount,
  fetchVercelProjects, fetchVercelEnvs, addVercelEnv, updateVercelEnv, deleteVercelEnv,
  fetchVercelEnvValue, fetchVercelDeployments, fetchVercelDeploymentLogs, triggerVercelRedeploy,
} from "../../lib/vercel";

const VERCEL_API = "https://api.vercel.com";
const VERCEL_TARGETS = [
  ["production", "Production"],
  ["preview", "Preview"],
  ["development", "Development"],
];

function statusMeta(state) {
  switch (state) {
    case "READY": return { label: "Ready", color: "#3fb950", bg: "rgba(63,185,80,0.12)", icon: "✅" };
    case "ERROR": return { label: "Failed", color: "#f85149", bg: "rgba(248,81,73,0.12)", icon: "❌" };
    case "CANCELED": return { label: "Canceled", color: "#8b949e", bg: "rgba(139,148,158,0.12)", icon: "⛔" };
    case "BUILDING": return { label: "Building", color: "#d29922", bg: "rgba(210,153,34,0.12)", icon: "🔨" };
    case "INITIALIZING": return { label: "Initializing", color: "#d29922", bg: "rgba(210,153,34,0.12)", icon: "⚙️" };
    case "QUEUED": return { label: "Queued", color: "#58a6ff", bg: "rgba(88,166,255,0.12)", icon: "⏳" };
    default: return { label: state || "Unknown", color: "#8b949e", bg: "rgba(139,148,158,0.12)", icon: "•" };
  }
}

function ElapsedTimer({ startMs }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const secs = Math.max(0, Math.floor((now - startMs) / 1000));
  const mm = Math.floor(secs / 60), ss = secs % 60;
  return <span>{mm}:{String(ss).padStart(2, "0")}</span>;
}

function DeploymentStatusPanel({ token, project, teamId }) {
  const [deployments, setDeployments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const pollRef = useRef(null);

  // Error deployment ke logs ka expand/fetch/copy state — uid se keyed taaki
  // ek time par multiple deployments ke logs alag-alag track ho sakein.
  const [expandedLogId, setExpandedLogId] = useState(null);
  const [logsById, setLogsById] = useState({});
  const [logsLoadingId, setLogsLoadingId] = useState(null);
  const [logsErrorId, setLogsErrorId] = useState({});
  const [copiedId, setCopiedId] = useState(null);

  const toggleLogs = async (d) => {
    if (expandedLogId === d.uid) { setExpandedLogId(null); return; }
    setExpandedLogId(d.uid);
    if (logsById[d.uid]) return; // already fetched, cache se dikha do
    setLogsLoadingId(d.uid);
    setLogsErrorId(prev => ({ ...prev, [d.uid]: "" }));
    try {
      const text = await fetchVercelDeploymentLogs(token, d.uid, teamId);
      setLogsById(prev => ({ ...prev, [d.uid]: text || "(Koi log text nahi mila)" }));
    } catch (e) {
      setLogsErrorId(prev => ({ ...prev, [d.uid]: e.message }));
    } finally {
      setLogsLoadingId(null);
    }
  };

  const copyLogs = async (d) => {
    const text = logsById[d.uid] || "";
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(d.uid);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // clipboard API blocked ho sakta hai (http/permission) — fallback textarea trick
      try {
        const ta = document.createElement("textarea");
        ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta); ta.focus(); ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        setCopiedId(d.uid);
        setTimeout(() => setCopiedId(null), 2000);
      } catch {}
    }
  };

  const load = async () => {
    try {
      const list = await fetchVercelDeployments(token, project.id, teamId, 8);
      setDeployments(list);
      setError("");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true); setDeployments([]);
    load();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [project?.id]);

  const isActive = (d) => ["BUILDING", "INITIALIZING", "QUEUED"].includes(d.readyState || d.state);

  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    const anyActive = deployments.some(isActive);
    if (anyActive) {
      pollRef.current = setInterval(load, 4000);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [deployments, project?.id]);

  if (loading) {
    return <div style={{ fontSize: "11px", color: "#6e7681", padding: "10px 0" }}>⏳ Deployments load ho rahe hain…</div>;
  }
  if (error) {
    return <div style={{ fontSize: "11px", color: "#f85149", padding: "8px 0" }}>⚠️ {error}</div>;
  }
  if (!deployments.length) {
    return <div style={{ fontSize: "11px", color: "#484f58", padding: "8px 0" }}>Koi deployment nahi mila.</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      <div style={{ fontSize: "11px", fontWeight: 700, color: "#58a6ff", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span>🚀 Deployments</span>
        <button onClick={load} style={{ background: "none", border: "none", color: "#6e7681", fontSize: "11px", cursor: "pointer" }}>⟳</button>
      </div>
      {deployments.map((d) => {
        const state = d.readyState || d.state;
        const meta = statusMeta(state);
        const active = isActive(d);
        const created = d.createdAt || d.created;
        return (
          <div key={d.uid} style={{ background: "#0d1117", border: "1px solid #30363d", borderRadius: "8px", padding: "9px 10px", display: "flex", flexDirection: "column", gap: "4px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px", minWidth: 0 }}>
                <span style={{ fontSize: "10px", fontWeight: 700, color: meta.color, background: meta.bg, borderRadius: "5px", padding: "2px 6px", flexShrink: 0, display: "flex", alignItems: "center", gap: "4px" }}>
                  {meta.icon} {meta.label}
                </span>
                <span style={{ fontSize: "10.5px", color: "#8b949e", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {(d.meta?.githubCommitMessage || d.target || "deployment").toString().slice(0, 40)}
                </span>
              </div>
              <span style={{ fontSize: "10px", color: "#6e7681", flexShrink: 0 }}>
                {active ? <>⏱ <ElapsedTimer startMs={created} /></> : new Date(created).toLocaleString()}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
              <code style={{ fontSize: "10px", color: "#6e7681" }}>{d.target || "preview"}</code>
              {d.url && (
                <a href={`https://${d.url}`} target="_blank" rel="noreferrer" style={{ fontSize: "10px", color: "#58a6ff", textDecoration: "none" }}>
                  {d.url} ↗
                </a>
              )}
            </div>

            {state === "ERROR" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <button
                  onClick={() => toggleLogs(d)}
                  style={{ alignSelf: "flex-start", padding: "4px 9px", borderRadius: "5px", fontSize: "10px", fontFamily: "inherit", fontWeight: 600, cursor: "pointer", background: "#21262d", color: "#f85149", border: "1px solid #30363d" }}
                >
                  {expandedLogId === d.uid ? "▲ Logs chhupao" : "📋 Error Logs dekho"}
                </button>

                {expandedLogId === d.uid && (
                  <div style={{ background: "#010409", border: "1px solid #30363d", borderRadius: "6px", padding: "8px" }}>
                    {logsLoadingId === d.uid && (
                      <div style={{ fontSize: "10.5px", color: "#6e7681" }}>⏳ Logs load ho rahe hain…</div>
                    )}
                    {logsErrorId[d.uid] && (
                      <div style={{ fontSize: "10.5px", color: "#f85149" }}>⚠️ {logsErrorId[d.uid]}</div>
                    )}
                    {!logsLoadingId && logsById[d.uid] && (
                      <>
                        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "6px" }}>
                          <button
                            onClick={() => copyLogs(d)}
                            style={{ padding: "4px 9px", borderRadius: "5px", fontSize: "10px", fontFamily: "inherit", fontWeight: 600, cursor: "pointer", background: copiedId === d.uid ? "#238636" : "#21262d", color: copiedId === d.uid ? "#fff" : "#58a6ff", border: "1px solid #30363d" }}
                          >
                            {copiedId === d.uid ? "✅ Copied!" : "📄 Copy Logs"}
                          </button>
                        </div>
                        <pre style={{ margin: 0, maxHeight: "260px", overflowY: "auto", fontSize: "10px", lineHeight: 1.5, color: "#c9d1d9", whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "monospace" }}>
                          {logsById[d.uid]}
                        </pre>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

          </div>
        );
      })}
    </div>
  );
}

function VercelEnvPanel({ open, activeAccountId }) {
  const [account, setAccount] = useState(null); // {token, teamId, login, name, avatar}
  const [loadingAccount, setLoadingAccount] = useState(true);

  const [patInput, setPatInput] = useState("");
  const [teamIdInput, setTeamIdInput] = useState("");
  const [patVisible, setPatVisible] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [connectError, setConnectError] = useState("");

  const [projects, setProjects] = useState([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState("");

  const [envs, setEnvs] = useState([]);
  const [envsLoading, setEnvsLoading] = useState(false);
  const [envsError, setEnvsError] = useState("");

  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [newTargets, setNewTargets] = useState(["production", "preview", "development"]);
  const [adding, setAdding] = useState(false);
  const [addMsg, setAddMsg] = useState(null);

  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState("");
  const [editLoading, setEditLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [deleteConfirmEnv, setDeleteConfirmEnv] = useState(null); // env pending delete confirmation
  const [deleting, setDeleting] = useState(false);
  const [deployMsg, setDeployMsg] = useState(null); // {ok, text} — redeploy status

  // Sidebar ke andar 2 sub-tabs — "Deployment" (default, status/history dikhata
  // hai) aur "Variables" (env vars add/update/delete). Project switch hone par
  // wapas Deployment tab par reset ho jaata hai.
  const [panelTab, setPanelTab] = useState("deployment");
  useEffect(() => { setPanelTab("deployment"); }, [selectedProjectId]);

  const loadedOnce = useRef(false);

  // Load saved Vercel account jab component mount ho (page load par hi,
  // background mein) aur jab bhi active GitHub account switch ho — sidebar
  // open/close karne se ab dobara fetch NAHI hota, kyunki "open" ab dependency
  // nahi hai. Isse jab user sidebar kholega tab data already ready milega,
  // koi wait nahi karna padega.
  useEffect(() => {
    loadedOnce.current = true;
    setProjects([]); setSelectedProjectId(""); setEnvs([]);
    (async () => {
      setLoadingAccount(true);
      const acc = await loadVercelAccountFromCloud(activeAccountId);
      setAccount(acc);
      setLoadingAccount(false);
    })();
  }, [activeAccountId]);

  // Once connected, load projects
  useEffect(() => {
    if (!account?.token) return;
    setProjectsLoading(true);
    fetchVercelProjects(account.token, account.teamId)
      .then(setProjects)
      .catch(e => setConnectError(e.message))
      .finally(() => setProjectsLoading(false));
  }, [account]);

  // Once a project is selected, load its env vars
  const loadEnvs = async (projectId) => {
    if (!account?.token || !projectId) return;
    setEnvsLoading(true); setEnvsError("");
    try { setEnvs(await fetchVercelEnvs(account.token, projectId, account.teamId)); }
    catch (e) { setEnvsError(e.message); }
    finally { setEnvsLoading(false); }
  };

  const [pendingRedeploy, setPendingRedeploy] = useState(false);
  const [redeploying, setRedeploying] = useState(false);

  useEffect(() => { setDeployMsg(null); setDeleteConfirmEnv(null); setEditingId(null); setPendingRedeploy(false); if (selectedProjectId) loadEnvs(selectedProjectId); else setEnvs([]); }, [selectedProjectId]);

  // PAT test — verifies the token works and fetches the user's profile
  const handleTestPat = async () => {
    if (!patInput.trim()) return;
    setTesting(true); setTestResult(null); setConnectError("");
    try {
      const res = await fetch(`${VERCEL_API}/v2/user`, { headers: { Authorization: `Bearer ${patInput.trim()}` } });
      if (!res.ok) throw new Error("Invalid token");
      const data = await res.json();
      const user = data.user || data;
      setTestResult({ ok: true, login: user.username || user.name || "vercel-user", name: user.name, avatar: user.avatar ? `https://vercel.com/api/www/avatar/${user.avatar}` : "" });
    } catch (e) { setTestResult({ ok: false }); }
    finally { setTesting(false); }
  };

  const handleConnectPat = async () => {
    if (!testResult?.ok) return;
    const acc = { token: patInput.trim(), teamId: teamIdInput.trim() || null, login: testResult.login, name: testResult.name, avatar: testResult.avatar };
    setAccount(acc);
    await saveVercelAccountToCloud(acc, activeAccountId);
    setPatInput(""); setTeamIdInput(""); setTestResult(null); setPatVisible(false);
  };

  const handleDisconnect = async () => {
    await disconnectVercelAccount(activeAccountId);
    setAccount(null); setProjects([]); setSelectedProjectId(""); setEnvs([]);
  };

  const toggleTarget = (t) => setNewTargets(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]);

  // Redeploy status message kuch der baad apne aap hat jaata hai
  useEffect(() => {
    if (!deployMsg || deployMsg.ok === null) return; // "in progress" wala message tab tak rahega jab tak result na aa jaaye
    const t = setTimeout(() => setDeployMsg(null), 6000);
    return () => clearTimeout(t);
  }, [deployMsg]);

  const selectedProject = projects.find(p => p.id === selectedProjectId) || null;

  // Har add/update/delete ke baad turant redeploy nahi hota — sirf "pending"
  // flag set hota hai. Jab saari keys add/edit ho jaayein tab ek hi baar
  // "Redeploy Karo" button dabao, taaki baar baar redeploy na ho.
  const handleRedeployNow = async () => {
    if (!selectedProject) return;
    setRedeploying(true);
    setDeployMsg({ ok: null, text: "🔁 Redeploy ho raha hai…" });
    try {
      await triggerVercelRedeploy(account.token, selectedProject, account.teamId);
      setDeployMsg({ ok: true, text: "✅ Redeploy trigger ho gaya, 1-2 min mein live ho jayega" });
      setPendingRedeploy(false);
    } catch (e) {
      setDeployMsg({ ok: false, text: `⚠️ Redeploy nahi ho saka: ${e.message}` });
    } finally {
      setRedeploying(false);
    }
  };

  const duplicateEnv = newKey.trim() ? envs.find(e => e.key === newKey.trim()) : null;

  const handleAddEnv = async () => {
    if (!newKey.trim() || !newValue || !newTargets.length || !selectedProjectId) return;
    if (duplicateEnv) { setAddMsg({ ok: false, text: `❌ "${newKey.trim()}" pehle se exist karta hai — neeche se Update karo` }); return; }
    setAdding(true); setAddMsg(null);
    try {
      await addVercelEnv(account.token, selectedProjectId, account.teamId, { key: newKey.trim(), value: newValue, target: newTargets });
      setAddMsg({ ok: true, text: `✅ ${newKey.trim()} added` });
      setNewKey(""); setNewValue("");
      await loadEnvs(selectedProjectId);
      setPendingRedeploy(true);
    } catch (e) { setAddMsg({ ok: false, text: `❌ ${e.message}` }); }
    finally { setAdding(false); }
  };

  // Update par click karte hi existing (decrypted) value fetch karke textarea
  // mein pehle se bhar deta hai, taaki blank se overwrite na ho jaaye.
  const handleStartEdit = async (env) => {
    setEditingId(env.id); setEditValue(""); setEditLoading(true); setEnvsError("");
    try {
      const v = await fetchVercelEnvValue(account.token, selectedProjectId, env.id, account.teamId);
      setEditValue(v);
    } catch (e) {
      setEnvsError(`Existing value load nahi hui: ${e.message}`);
    } finally {
      setEditLoading(false);
    }
  };

  const handleUpdateEnv = async (env) => {
    setSaving(true);
    try {
      await updateVercelEnv(account.token, selectedProjectId, env.id, account.teamId, { value: editValue, target: env.target });
      setEditingId(null); setEditValue("");
      await loadEnvs(selectedProjectId);
      setPendingRedeploy(true);
    } catch (e) { setEnvsError(e.message); }
    finally { setSaving(false); }
  };

  // Delete seedha nahi hota — pehle confirm modal khulta hai (handleDeleteEnv
  // sirf request kholta hai, asli delete confirmDeleteEnv se hoti hai).
  const handleDeleteEnv = (env) => setDeleteConfirmEnv(env);

  const confirmDeleteEnv = async () => {
    if (!deleteConfirmEnv) return;
    setDeleting(true);
    try {
      await deleteVercelEnv(account.token, selectedProjectId, deleteConfirmEnv.id, account.teamId);
      await loadEnvs(selectedProjectId);
      setPendingRedeploy(true);
    } catch (e) { setEnvsError(e.message); }
    finally { setDeleting(false); setDeleteConfirmEnv(null); }
  };

  const inp = { width: "100%", boxSizing: "border-box", background: "#0d1117", border: "1px solid #30363d", color: "#c9d1d9", borderRadius: "6px", padding: "8px 10px", fontSize: "11.5px", outline: "none", fontFamily: "inherit" };

  if (loadingAccount) {
    return <div style={{ padding: "16px", fontSize: "12px", color: "#6e7681" }}>Loading…</div>;
  }

  if (!account) {
    return (
      <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "10px" }}>
        <div style={{ fontSize: "11.5px", color: "#8b949e", lineHeight: 1.6 }}>
          Vercel Personal Access Token se connect karo taaki apne projects ke env variables yahin se add/update kar sako.
        </div>
        <div>
          <div style={{ fontSize: "11px", color: "#8b949e", marginBottom: "4px" }}>
            🔑 Vercel Token &nbsp;
            <a href="https://vercel.com/account/tokens" target="_blank" rel="noopener noreferrer" style={{ color: "#58a6ff", textDecoration: "none" }}>Generate karo ↗</a>
          </div>
          <div style={{ position: "relative" }}>
            <input type={patVisible ? "text" : "password"} value={patInput} onChange={e => { setPatInput(e.target.value); setTestResult(null); }} placeholder="vercel_xxxxxxxxxxxx" style={{ ...inp, paddingRight: "55px" }} />
            <button onClick={() => setPatVisible(p => !p)} style={{ position: "absolute", right: "8px", top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#6e7681", cursor: "pointer", fontSize: "11px", fontFamily: "inherit" }}>
              {patVisible ? "Hide" : "Show"}
            </button>
          </div>
        </div>
        <div>
          <div style={{ fontSize: "11px", color: "#8b949e", marginBottom: "4px" }}>👥 Team ID (optional — sirf team account ho to)</div>
          <input type="text" value={teamIdInput} onChange={e => setTeamIdInput(e.target.value)} placeholder="team_xxxxxxxx" style={inp} />
        </div>

        {testResult && (
          <div style={{ background: testResult.ok ? "#0d1f0d" : "#1f0d0d", border: `1px solid ${testResult.ok ? "#2ea043" : "#da3633"}`, borderRadius: "6px", padding: "8px 10px", fontSize: "11px", display: "flex", alignItems: "center", gap: "8px" }}>
            {testResult.ok ? (
              <><img src={testResult.avatar} alt="" style={{ width: "18px", height: "18px", borderRadius: "50%" }} /><span style={{ color: "#3fb950" }}>✅ @{testResult.login}</span></>
            ) : <span style={{ color: "#f85149" }}>❌ Invalid token</span>}
          </div>
        )}

        <div style={{ display: "flex", gap: "8px" }}>
          <button onClick={handleTestPat} disabled={testing || !patInput.trim()} style={{ flex: 1, padding: "9px", borderRadius: "6px", fontSize: "12px", fontFamily: "inherit", fontWeight: 600, cursor: testing || !patInput.trim() ? "not-allowed" : "pointer", background: testing || !patInput.trim() ? "#161b22" : "#1f6feb", color: testing || !patInput.trim() ? "#6e7681" : "#fff", border: "1px solid #388bfd" }}>
            {testing ? "⏳…" : "🔍 Test Karo"}
          </button>
          <button onClick={handleConnectPat} disabled={!testResult?.ok} style={{ flex: 1, padding: "9px", borderRadius: "6px", fontSize: "12px", fontFamily: "inherit", fontWeight: 600, cursor: !testResult?.ok ? "not-allowed" : "pointer", background: !testResult?.ok ? "#161b22" : "#238636", color: !testResult?.ok ? "#6e7681" : "#fff", border: "1px solid #2ea043" }}>
            ✅ Connect Karo
          </button>
        </div>
        {connectError && <div style={{ fontSize: "11px", color: "#f85149" }}>❌ {connectError}</div>}
        <div style={{ fontSize: "10px", color: "#484f58", textAlign: "center" }}>Token Firestore mein save hota hai · Scope: full account ya specific team</div>
      </div>
    );
  }

  return (
    <div style={{ padding: "14px", display: "flex", flexDirection: "column", gap: "14px" }}>
      {/* Connected account */}
      <div style={{ display: "flex", alignItems: "center", gap: "10px", background: "#0d1117", border: "1px solid #30363d", borderRadius: "8px", padding: "10px 12px" }}>
        <div style={{ width: "30px", height: "30px", borderRadius: "50%", overflow: "hidden", background: "#30363d", flexShrink: 0, border: "2px solid #000" }}>
          {account.avatar && <img src={account.avatar} alt="" style={{ width: "100%", height: "100%" }} />}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: "12px", fontWeight: 700, color: "#f0f6fc", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{account.name || account.login}</div>
          <div style={{ fontSize: "10px", color: "#6e7681" }}>@{account.login}{account.teamId ? " · team" : ""}</div>
        </div>
        <button onClick={handleDisconnect} style={{ background: "none", border: "1px solid #30363d", color: "#f85149", borderRadius: "6px", padding: "5px 8px", fontSize: "10px", cursor: "pointer", fontFamily: "inherit" }}>Disconnect</button>
      </div>

      {/* Project selector */}
      <div>
        <div style={{ fontSize: "11px", color: "#8b949e", marginBottom: "5px" }}>📦 Project</div>
        <select value={selectedProjectId} onChange={e => setSelectedProjectId(e.target.value)} style={inp}>
          <option value="">{projectsLoading ? "Loading projects…" : "— Project choose karo —"}</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {connectError && <div style={{ fontSize: "11px", color: "#f85149" }}>⚠️ {connectError}</div>}

      {selectedProjectId && selectedProject && (
        <>
          {/* Deployment | Variables sub-tabs */}
          <div style={{ display: "flex", background: "#0d1117", border: "1px solid #30363d", borderRadius: "8px", padding: "3px", gap: "3px" }}>
            <button
              onClick={() => setPanelTab("deployment")}
              style={{ flex: 1, padding: "7px", borderRadius: "6px", fontSize: "11px", fontFamily: "inherit", fontWeight: 700, cursor: "pointer", border: "none", background: panelTab === "deployment" ? "#1f6feb" : "transparent", color: panelTab === "deployment" ? "#fff" : "#8b949e" }}
            >
              🚀 Deployment
            </button>
            <button
              onClick={() => setPanelTab("variables")}
              style={{ flex: 1, padding: "7px", borderRadius: "6px", fontSize: "11px", fontFamily: "inherit", fontWeight: 700, cursor: "pointer", border: "none", background: panelTab === "variables" ? "#1f6feb" : "transparent", color: panelTab === "variables" ? "#fff" : "#8b949e" }}
            >
              🔑 Variables
            </button>
          </div>

          {panelTab === "deployment" && (
            <DeploymentStatusPanel token={account.token} project={selectedProject} teamId={account.teamId} />
          )}
        </>
      )}

      {selectedProjectId && panelTab === "variables" && (
        <>
          {/* Add new env var */}
          <div style={{ background: "#0d1117", border: "1px solid #30363d", borderRadius: "8px", padding: "12px", display: "flex", flexDirection: "column", gap: "8px" }}>
            <div style={{ fontSize: "11px", fontWeight: 700, color: "#58a6ff" }}>➕ Naya Env Variable</div>
            <input type="text" placeholder="KEY_NAME" value={newKey} onChange={e => setNewKey(e.target.value.toUpperCase().replace(/\s/g, "_"))} style={{ ...inp, borderColor: duplicateEnv ? "#f85149" : "#30363d" }} />
            {duplicateEnv && (
              <div style={{ fontSize: "10.5px", color: "#f85149", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", flexWrap: "wrap" }}>
                <span>⚠️ "{duplicateEnv.key}" pehle se hai</span>
                <button
                  onClick={() => { setNewKey(""); setNewValue(""); handleStartEdit(duplicateEnv); }}
                  style={{ padding: "3px 8px", borderRadius: "4px", fontSize: "10px", fontFamily: "inherit", fontWeight: 600, cursor: "pointer", background: "#21262d", color: "#58a6ff", border: "1px solid #30363d" }}
                >
                  Update karo →
                </button>
              </div>
            )}
            <textarea placeholder="value" value={newValue} onChange={e => setNewValue(e.target.value)} rows={2} style={{ ...inp, resize: "vertical", fontFamily: "monospace" }} />
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              {VERCEL_TARGETS.map(([t, label]) => (
                <label key={t} style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "10.5px", color: "#c9d1d9", cursor: "pointer" }}>
                  <input type="checkbox" checked={newTargets.includes(t)} onChange={() => toggleTarget(t)} />
                  {label}
                </label>
              ))}
            </div>
            <button onClick={handleAddEnv} disabled={adding || !newKey.trim() || !newValue || !newTargets.length || !!duplicateEnv} style={{ padding: "9px", borderRadius: "6px", fontSize: "12px", fontFamily: "inherit", fontWeight: 600, cursor: adding ? "not-allowed" : "pointer", background: adding || !newKey.trim() || !newValue || duplicateEnv ? "#161b22" : "#1f6feb", color: adding || !newKey.trim() || !newValue || duplicateEnv ? "#6e7681" : "#fff", border: "1px solid #388bfd" }}>
              {adding ? "⏳ Add ho raha hai…" : "✅ Add Karo"}
            </button>
            {addMsg && <div style={{ fontSize: "10.5px", color: addMsg.ok ? "#3fb950" : "#f85149" }}>{addMsg.text}</div>}
          </div>

          {/* Existing env vars */}
          <div>
            <div style={{ fontSize: "11px", color: "#8b949e", marginBottom: "6px" }}>🔑 Existing ({envs.length})</div>
            {envsLoading && <div style={{ fontSize: "11px", color: "#6e7681" }}>Loading…</div>}
            {envsError && <div style={{ fontSize: "11px", color: "#f85149" }}>❌ {envsError}</div>}
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {envs.map(env => (
                <div key={env.id} style={{ background: "#0d1117", border: "1px solid #21262d", borderRadius: "8px", padding: "9px 10px", display: "flex", flexDirection: "column", gap: "6px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
                    <code style={{ fontSize: "11.5px", color: "#f0f6fc", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{env.key}</code>
                    <div style={{ display: "flex", gap: "4px", flexShrink: 0 }}>
                      {env.target?.map(t => <span key={t} style={{ fontSize: "8.5px", background: "#21262d", color: "#8b949e", borderRadius: "4px", padding: "1px 4px" }}>{t[0].toUpperCase()}</span>)}
                    </div>
                  </div>
                  {editingId === env.id ? (
                    <>
                      <textarea value={editLoading ? "⏳ Loading existing value…" : editValue} onChange={e => setEditValue(e.target.value)} disabled={editLoading} rows={2} style={{ ...inp, resize: "vertical", fontFamily: "monospace", opacity: editLoading ? 0.6 : 1 }} />
                      <div style={{ display: "flex", gap: "6px" }}>
                        <button onClick={() => handleUpdateEnv(env)} disabled={saving || editLoading} style={{ flex: 1, padding: "6px", borderRadius: "5px", fontSize: "10.5px", fontFamily: "inherit", fontWeight: 600, cursor: "pointer", background: "#238636", color: "#fff", border: "1px solid #2ea043" }}>{saving ? "⏳" : "Save"}</button>
                        <button onClick={() => { setEditingId(null); setEditValue(""); }} style={{ flex: 1, padding: "6px", borderRadius: "5px", fontSize: "10.5px", fontFamily: "inherit", fontWeight: 600, cursor: "pointer", background: "#161b22", color: "#8b949e", border: "1px solid #30363d" }}>Cancel</button>
                      </div>
                    </>
                  ) : (
                    <div style={{ display: "flex", gap: "6px" }}>
                      <button onClick={() => handleStartEdit(env)} style={{ flex: 1, padding: "6px", borderRadius: "5px", fontSize: "10.5px", fontFamily: "inherit", fontWeight: 600, cursor: "pointer", background: "#161b22", color: "#58a6ff", border: "1px solid #30363d" }}>✏️ Update</button>
                      <button onClick={() => handleDeleteEnv(env)} style={{ padding: "6px 8px", borderRadius: "5px", fontSize: "10.5px", fontFamily: "inherit", fontWeight: 600, cursor: "pointer", background: "#161b22", color: "#f85149", border: "1px solid #30363d" }}>🗑️</button>
                    </div>
                  )}
                </div>
              ))}
              {!envsLoading && envs.length === 0 && <div style={{ fontSize: "11px", color: "#484f58", textAlign: "center", padding: "10px" }}>Koi env variable nahi hai</div>}
            </div>
          </div>

          {(pendingRedeploy || deployMsg) && (
            <div style={{ position: "sticky", bottom: "8px", background: "#0d1117", border: "1px solid #30363d", borderRadius: "8px", padding: "9px 10px", display: "flex", flexDirection: "column", gap: "6px", boxShadow: "0 4px 12px rgba(0,0,0,0.4)" }}>
              {pendingRedeploy && (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
                  <span style={{ fontSize: "10.5px", color: "#d29922" }}>⚠️ Changes save hue hain, abhi live nahi hain</span>
                  <button onClick={handleRedeployNow} disabled={redeploying} style={{ padding: "6px 12px", borderRadius: "6px", fontSize: "11px", fontFamily: "inherit", fontWeight: 700, cursor: redeploying ? "not-allowed" : "pointer", background: redeploying ? "#161b22" : "#1f6feb", color: redeploying ? "#6e7681" : "#fff", border: "1px solid #388bfd", flexShrink: 0 }}>
                    {redeploying ? "⏳…" : "🔁 Redeploy Karo"}
                  </button>
                </div>
              )}
              {deployMsg && (
                <div style={{ fontSize: "10.5px", color: deployMsg.ok === false ? "#f85149" : deployMsg.ok === true ? "#3fb950" : "#8b949e" }}>
                  {deployMsg.text}
                </div>
              )}
            </div>
          )}

          {/* Delete confirmation — galti se tap hone par seedha delete nahi hota */}
          {deleteConfirmEnv && (
            <div
              onClick={() => !deleting && setDeleteConfirmEnv(null)}
              style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}
            >
              <div
                onClick={e => e.stopPropagation()}
                style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: "10px", padding: "16px", width: "100%", maxWidth: "280px", display: "flex", flexDirection: "column", gap: "10px" }}
              >
                <div style={{ fontSize: "13px", fontWeight: 700, color: "#f0f6fc" }}>🗑️ Env variable delete karein?</div>
                <div style={{ fontSize: "11.5px", color: "#8b949e" }}>
                  <code style={{ color: "#f0f6fc", fontWeight: 700 }}>{deleteConfirmEnv.key}</code> hamesha ke liye delete ho jayega aur project apne aap redeploy hoga.
                </div>
                <div style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
                  <button onClick={() => setDeleteConfirmEnv(null)} disabled={deleting} style={{ flex: 1, padding: "8px", borderRadius: "6px", fontSize: "11.5px", fontFamily: "inherit", fontWeight: 600, cursor: "pointer", background: "#0d1117", color: "#c9d1d9", border: "1px solid #30363d" }}>Cancel</button>
                  <button onClick={confirmDeleteEnv} disabled={deleting} style={{ flex: 1, padding: "8px", borderRadius: "6px", fontSize: "11.5px", fontFamily: "inherit", fontWeight: 600, cursor: "pointer", background: "#da3633", color: "#fff", border: "1px solid #f85149" }}>{deleting ? "⏳ Delete ho raha…" : "Delete Karo"}</button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ForkRepoPanel({ token }) {
  const [input, setInput]       = useState("");
  const [forking, setForking]   = useState(false);
  const [result, setResult]     = useState(null); // {ok, msg, url}

  const parseRepo = (val) => {
    val = val.trim();
    // Accept: "owner/repo" or "https://github.com/owner/repo"
    const urlMatch = val.match(/github\.com\/([^/]+\/[^/]+)/);
    if (urlMatch) return urlMatch[1].replace(/\.git$/, "");
    if (/^[^/]+\/[^/]+$/.test(val)) return val;
    return null;
  };

  const handleFork = async () => {
    const repoPath = parseRepo(input);
    if (!repoPath) { setResult({ ok: false, msg: "❌ Sahi format daalo: owner/repo ya GitHub URL" }); return; }
    const [owner, repo] = repoPath.split("/");
    setForking(true); setResult(null);
    try {
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/forks`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Fork nahi ho saka");
      setResult({ ok: true, msg: `✅ Fork ho gaya!`, url: data.html_url, name: data.full_name });
      setInput("");
    } catch (e) {
      setResult({ ok: false, msg: `❌ ${e.message}` });
    } finally {
      setForking(false);
    }
  };

  const inp = { width: "100%", boxSizing: "border-box", background: "#0d1117", border: "1px solid #30363d", color: "#c9d1d9", borderRadius: "6px", padding: "8px 10px", fontSize: "11.5px", outline: "none", fontFamily: "inherit" };

  return (
    <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
      <div style={{ fontSize: "11.5px", color: "#8b949e", lineHeight: 1.6 }}>
        Kisi bhi public repo ko apne GitHub account mein fork karo — seedha yahin se, GitHub.com pe jaane ki zaroorat nahi.
      </div>
      <div>
        <div style={{ fontSize: "11px", color: "#8b949e", marginBottom: "5px" }}>🔗 Repo URL ya <code style={{ color: "#c9d1d9" }}>owner/repo</code></div>
        <input
          type="text"
          value={input}
          onChange={e => { setInput(e.target.value); setResult(null); }}
          onKeyDown={e => e.key === "Enter" && !forking && input.trim() && handleFork()}
          placeholder="e.g. vercel/next.js"
          style={inp}
        />
      </div>

      <button
        onClick={handleFork}
        disabled={forking || !input.trim() || !token}
        style={{
          padding: "10px", borderRadius: "6px", fontSize: "12px", fontFamily: "inherit",
          fontWeight: 700, cursor: forking || !input.trim() || !token ? "not-allowed" : "pointer",
          background: forking || !input.trim() || !token ? "#161b22" : "#238636",
          color: forking || !input.trim() || !token ? "#6e7681" : "#fff",
          border: "1px solid #2ea043",
        }}
      >
        {forking ? "⏳ Fork ho raha hai…" : "🍴 Fork Karo"}
      </button>

      {!token && (
        <div style={{ fontSize: "10.5px", color: "#e3b341", textAlign: "center" }}>
          ⚠️ Pehle Accounts tab mein GitHub account add karo
        </div>
      )}

      {result && (
        <div style={{
          background: result.ok ? "#0d1f0d" : "#1f0d0d",
          border: `1px solid ${result.ok ? "#2ea04344" : "#da363344"}`,
          borderRadius: "8px", padding: "12px",
          display: "flex", flexDirection: "column", gap: "8px",
        }}>
          <div style={{ fontSize: "12px", color: result.ok ? "#3fb950" : "#f85149" }}>{result.msg}</div>
          {result.ok && result.url && (
            <>
              <code style={{ fontSize: "11px", color: "#8b949e" }}>{result.name}</code>
              <a
                href={result.url} target="_blank" rel="noreferrer"
                style={{ fontSize: "11px", color: "#58a6ff", textDecoration: "none", display: "flex", alignItems: "center", gap: "4px" }}
              >
                GitHub par dekho ↗
              </a>
            </>
          )}
        </div>
      )}

      <div style={{ fontSize: "10px", color: "#484f58", textAlign: "center" }}>
        Fork hone ke baad repo teri list mein automatically aa jayega
      </div>
    </div>
  );
}

const SIDEBAR_TABS = [
  { id: "vercel", label: "⚡ Vercel" },
  { id: "fork",   label: "🍴 Fork Repo" },
];

export default function Sidebar({ open, onClose, activeAccountId, token }) {
  const [sidebarTab, setSidebarTab] = useState("vercel");

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 150,
          opacity: open ? 1 : 0, pointerEvents: open ? "auto" : "none",
          transition: "opacity 0.2s ease",
        }}
      />
      {/* Drawer */}
      <div
        style={{
          position: "fixed", top: 0, left: 0, bottom: 0, width: "300px", maxWidth: "85vw",
          background: "#161b22", borderRight: "1px solid #30363d", zIndex: 151,
          transform: open ? "translateX(0)" : "translateX(-100%)",
          transition: "transform 0.22s ease", display: "flex", flexDirection: "column",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", borderBottom: "1px solid #21262d", flexShrink: 0 }}>
          <span style={{ fontSize: "13px", fontWeight: 700, color: "#f0f6fc" }}>⚙️ Tools</span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#6e7681", fontSize: "18px", cursor: "pointer" }}>✕</button>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", padding: "8px 10px", gap: "6px", borderBottom: "1px solid #21262d", flexShrink: 0 }}>
          {SIDEBAR_TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setSidebarTab(t.id)}
              style={{
                flex: 1, padding: "7px 4px", borderRadius: "6px", fontSize: "11px",
                fontFamily: "inherit", fontWeight: 700, cursor: "pointer", border: "none",
                background: sidebarTab === t.id ? "#1f6feb" : "#0d1117",
                color: sidebarTab === t.id ? "#fff" : "#8b949e",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Panel */}
        <div style={{ overflowY: "auto", flex: 1 }}>
          {sidebarTab === "vercel" && <VercelEnvPanel open={open} activeAccountId={activeAccountId} />}
          {sidebarTab === "fork"   && <ForkRepoPanel token={token} />}
        </div>
      </div>
    </>
  );
}

