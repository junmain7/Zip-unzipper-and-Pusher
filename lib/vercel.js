// ── Vercel account storage + REST API ─────────────────────

// Har GitHub account (accountId) ka apna alag Vercel connection save hota hai,
// taaki GitHub account switch karne par Vercel disconnect na karna pade.
export function vercelQueryParam(accountId) {
  return accountId ? `?accountId=${encodeURIComponent(accountId)}` : "";
}
export async function loadVercelAccountFromCloud(accountId) {
  try {
    const res = await fetch(`/api/vercel-account${vercelQueryParam(accountId)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.vercelAccount || null;
  } catch (e) { console.error("Vercel account load failed:", e); return null; }
}
export async function saveVercelAccountToCloud(vercelAccount, accountId) {
  try {
    await fetch("/api/vercel-account", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vercelAccount, accountId }),
    });
  } catch (e) { console.error("Vercel account save failed:", e); }
}
export async function disconnectVercelAccount(accountId) {
  try { await fetch(`/api/vercel-account${vercelQueryParam(accountId)}`, { method: "DELETE" }); } catch {}
}

const VERCEL_API = "https://api.vercel.com";
export function vercelQS(teamId) { return teamId ? `?teamId=${encodeURIComponent(teamId)}` : ""; }

export async function fetchVercelProjects(token, teamId) {
  const res = await fetch(`${VERCEL_API}/v9/projects${vercelQS(teamId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Projects fetch nahi hue");
  const data = await res.json();
  return data.projects || [];
}

export async function fetchVercelEnvs(token, projectId, teamId) {
  const res = await fetch(`${VERCEL_API}/v9/projects/${projectId}/env${vercelQS(teamId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Env vars fetch nahi hue");
  const data = await res.json();
  return data.envs || [];
}

export async function addVercelEnv(token, projectId, teamId, { key, value, target }) {
  const res = await fetch(`${VERCEL_API}/v10/projects/${projectId}/env${vercelQS(teamId)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ key, value, target, type: "encrypted" }),
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error?.message || "Env add nahi hua"); }
  return res.json();
}

export async function updateVercelEnv(token, projectId, envId, teamId, { value, target }) {
  const res = await fetch(`${VERCEL_API}/v9/projects/${projectId}/env/${envId}${vercelQS(teamId)}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ value, target }),
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error?.message || "Env update nahi hua"); }
  return res.json();
}

export async function deleteVercelEnv(token, projectId, envId, teamId) {
  const res = await fetch(`${VERCEL_API}/v9/projects/${projectId}/env/${envId}${vercelQS(teamId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error?.message || "Env delete nahi hua"); }
  return res.json();
}

export async function fetchVercelEnvValue(token, projectId, envId, teamId) {
  const qs = teamId ? `?decrypt=true&teamId=${encodeURIComponent(teamId)}` : "?decrypt=true";
  const res = await fetch(`${VERCEL_API}/v9/projects/${projectId}/env/${envId}${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error?.message || "Value fetch nahi hua"); }
  const data = await res.json();
  return data.value ?? "";
}

export async function fetchLatestVercelDeployment(token, projectId, teamId) {
  const qs = teamId ? `&teamId=${encodeURIComponent(teamId)}` : "";
  const res = await fetch(`${VERCEL_API}/v6/deployments?projectId=${projectId}&limit=1${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Deployments fetch nahi hue");
  const data = await res.json();
  return data.deployments?.[0] || null;
}

// Recent deployments list (for history/status panel) — readyState includes
// QUEUED, BUILDING, INITIALIZING, READY, ERROR, CANCELED
export async function fetchVercelDeployments(token, projectId, teamId, limit = 8) {
  const qs = teamId ? `&teamId=${encodeURIComponent(teamId)}` : "";
  const res = await fetch(`${VERCEL_API}/v6/deployments?projectId=${projectId}&limit=${limit}${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Deployments fetch nahi hue");
  const data = await res.json();
  return data.deployments || [];
}

// Deployment ke build/error logs fetch karta hai (Vercel "events" API) — jab
// deployment ERROR state mein ho, ye function us deployment ke poore build
// output ko text lines mein nikaal ke deta hai taaki user dekh/copy kar sake.
export async function fetchVercelDeploymentLogs(token, deploymentId, teamId) {
  const qs = teamId ? `&teamId=${encodeURIComponent(teamId)}` : "";
  const res = await fetch(`${VERCEL_API}/v3/deployments/${deploymentId}/events?direction=forward&limit=1000${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Logs fetch nahi hue");
  const data = await res.json();
  const events = Array.isArray(data) ? data : (data.events || []);
  return events
    .map(e => (typeof e.payload?.text === "string" ? e.payload.text : (typeof e.text === "string" ? e.text : "")))
    .filter(Boolean)
    .join("\n");
}


// hai — taaki env variable add/update/delete karne ke baad naya value/build
// live ho jaaye (warna purana build hi serve hota rehta hai).
export async function triggerVercelRedeploy(token, project, teamId) {
  const latest = await fetchLatestVercelDeployment(token, project.id, teamId);
  if (!latest) throw new Error("Koi pehle se deployment nahi mila — Vercel dashboard se ek baar manually deploy karo");
  const res = await fetch(`${VERCEL_API}/v13/deployments${vercelQS(teamId)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: project.name,
      project: project.id,
      deploymentId: latest.uid,
      target: latest.target || "production",
    }),
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error?.message || "Redeploy nahi hua"); }
  return res.json();
}
