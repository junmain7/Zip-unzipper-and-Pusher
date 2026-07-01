import { adminDb } from "./firebaseAdmin";

const GITHUB_API = "https://api.github.com";

export async function resolveAgentLink(token) {
  const linkSnap = await adminDb.collection("agentLinks").doc(token).get();
  if (!linkSnap.exists) return { error: "Link invalid or revoked", status: 404 };
  const link = linkSnap.data();

  const ownerSnap = await adminDb.collection("users").doc(link.ownerUid).get();
  const acc = (ownerSnap.exists ? ownerSnap.data().accounts || [] : []).find((a) => a.id === link.accountId);
  if (!acc) return { error: "Account no longer available", status: 404 };

  return { pat: acc.pat, owner: link.owner, repo: link.repo };
}

export function githubHeaders(pat) {
  return { Authorization: `token ${pat}`, Accept: "application/vnd.github.v3+json" };
}

export async function getDefaultBranch(owner, repo, headers) {
  const repoRes = await fetch(`${GITHUB_API}/repos/${owner}/${repo}`, { headers });
  if (!repoRes.ok) throw new Error(`Repo fetch failed: ${repoRes.status}`);
  const data = await repoRes.json();
  return data.default_branch;
}

export const GITHUB_API_BASE = GITHUB_API;
