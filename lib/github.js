// ── GitHub REST/Git-data API + Smart Push logic ──────────────
import { uint8ToBase64, computeGitBlobSha } from "./zip";
import { addBackup } from "./storage";

const GITHUB_API = "https://api.github.com";

export async function fetchUserRepos(token) {
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

export async function createRepo(name, isPrivate, token) {
  const res = await fetch(`${GITHUB_API}/user/repos`, {
    method: "POST",
    headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json", "Content-Type": "application/json" },
    body: JSON.stringify({ name, private: isPrivate, auto_init: true }),
  });
  if (!res.ok) { const e = await res.json(); throw new Error(e.message || "Repo create nahi hua"); }
  return res.json();
}

export async function getDefaultBranch(owner, repo, token) {
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}`, {
    headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json" },
  });
  if (!res.ok) throw new Error(`Repo not found: ${res.status}`);
  return (await res.json()).default_branch;
}

export async function getLatestCommitSha(owner, repo, branch, token) {
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/git/ref/heads/${branch}`, {
    headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json" },
  });
  if (!res.ok) throw new Error(`Branch not found: ${res.status}`);
  return (await res.json()).object.sha;
}

export async function getTreeSha(owner, repo, commitSha, token) {
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/git/commits/${commitSha}`, {
    headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json" },
  });
  return (await res.json()).tree.sha;
}

export async function fetchRepoTree(owner, repo, treeSha, token) {
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/git/trees/${treeSha}?recursive=1`, {
    headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json" },
  });
  if (!res.ok) throw new Error(`Tree fetch error: ${res.status}`);
  const data = await res.json();
  const map = {};
  for (const item of data.tree) if (item.type === "blob") map[item.path] = item.sha;
  return map;
}

export async function fetchRepoFolders(owner, repo, token) {
  const branch = await getDefaultBranch(owner, repo, token);
  const commitSha = await getLatestCommitSha(owner, repo, branch, token);
  const treeSha = await getTreeSha(owner, repo, commitSha, token);
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/git/trees/${treeSha}?recursive=1`, {
    headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json" },
  });
  if (!res.ok) throw new Error(`Tree fetch error: ${res.status}`);
  const data = await res.json();
  const folders = new Set([""]); // "" = repo root
  for (const item of data.tree) {
    if (item.type === "tree") folders.add(item.path);
    else if (item.type === "blob" && item.path.includes("/")) folders.add(item.path.slice(0, item.path.lastIndexOf("/")));
  }
  return Array.from(folders).sort((a, b) => a.localeCompare(b));
}

export async function createBlob(owner, repo, content, token) {
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/git/blobs`, {
    method: "POST",
    headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json", "Content-Type": "application/json" },
    body: JSON.stringify({ content, encoding: "base64" }),
  });
  if (!res.ok) { const e = await res.json(); throw new Error(`Blob error: ${e.message}`); }
  return (await res.json()).sha;
}

export async function createTree(owner, repo, baseTreeSha, treeItems, token) {
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/git/trees`, {
    method: "POST",
    headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json", "Content-Type": "application/json" },
    body: JSON.stringify({ base_tree: baseTreeSha, tree: treeItems }),
  });
  if (!res.ok) { const e = await res.json(); throw new Error(`Tree error: ${e.message}`); }
  return (await res.json()).sha;
}

export async function createCommit(owner, repo, message, treeSha, parentSha, token) {
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/git/commits`, {
    method: "POST",
    headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json", "Content-Type": "application/json" },
    body: JSON.stringify({ message, tree: treeSha, parents: [parentSha] }),
  });
  if (!res.ok) { const e = await res.json(); throw new Error(`Commit error: ${e.message}`); }
  return (await res.json()).sha;
}

export async function updateRef(owner, repo, branch, commitSha, token, force = false) {
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
    method: "PATCH",
    headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json", "Content-Type": "application/json" },
    body: JSON.stringify({ sha: commitSha, force }),
  });
  if (!res.ok) { const e = await res.json(); throw new Error(`Ref update error: ${e.message}`); }
}

export async function downloadRepoZip(owner, repo, branch, token) {
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

export function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Push se PEHLE call karo — ye sirf diff compute karta hai (kuch bhi push nahi karta).
// Confirm modal mein exact file list + path dikhane ke liye use hota hai, taaki
// galti se galat location/repo mein push na ho.
export async function computeDiff({ filesToProcess, owner, repo, token, log = () => {} }) {
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

  return { branch, latestSha, baseTreeSha, toPush, skipped };
}

// Diff confirm hone ke baad actual push karta hai. Agar latestSha mismatch ho
// (kisi aur ne meanwhile push kar diya), to safety ke liye error throw karta hai
// taaki stale diff ke upar blind push na ho jaye.
export async function pushDiff({ owner, repo, branch, latestSha, baseTreeSha, toPush, commitMsg, token, log, backupEnabled }) {
  const currentSha = await getLatestCommitSha(owner, repo, branch, token);
  if (currentSha !== latestSha) {
    throw new Error("⚠️ Repo meanwhile change ho gaya (kisi aur ne push kiya) — dobara diff check karke push karo.");
  }

  if (backupEnabled) {
    addBackup({ owner, repo, branch, sha: latestSha, timestamp: Date.now(), label: commitMsg });
    log(`📦 Backup point saved: ${latestSha.slice(0, 7)} (revert ke liye use hoga)`);
  }

  if (toPush.length === 0) {
    log(`🎉 Sab files already up-to-date!`, "success");
    return { added: 0, updated: 0, skipped: 0, branch, prevSha: latestSha, newSha: null };
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
  return { added, updated, skipped: 0, branch, prevSha: latestSha, newSha: newCommitSha };
}

// Backward-compatible single-call wrapper (diff + push, bina preview ke).
export async function smartPush({ filesToProcess, owner, repo, token, commitMsg, log, backupEnabled }) {
  const diff = await computeDiff({ filesToProcess, owner, repo, token, log });
  const result = await pushDiff({ owner, repo, ...diff, commitMsg, token, log, backupEnabled });
  return { ...result, skipped: diff.skipped };
}
