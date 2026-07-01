import { NextResponse } from "next/server";
import { adminDb } from "../../../../lib/firebaseAdmin";

const GITHUB_API = "https://api.github.com";
const SKIP_DIRS = ["node_modules/", ".git/", ".next/", "dist/", "build/", ".vercel/"];
const SKIP_EXT = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".woff", ".woff2", ".ttf", ".eot", ".mp4", ".zip", ".lock"];
const MAX_FILE_BYTES = 200 * 1024;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024;
const MAX_FILES = 600;

function skip(path) {
  if (SKIP_DIRS.some((d) => path.startsWith(d) || path.includes("/" + d))) return true;
  if (SKIP_EXT.some((e) => path.toLowerCase().endsWith(e))) return true;
  return false;
}

// GET /api/agent/[token] — is link ke saath bandhe hue account+repo ka pura
// read-only source fetch karta hai (tree + file contents). Kisi bhi tool jo
// URL fetch kar sake usse yeh directly use ho sakta hai — repo padhne ke liye.
export async function GET(request, { params }) {
  const { token } = params;
  if (!token) return NextResponse.json({ error: "Invalid link" }, { status: 400 });

  const linkSnap = await adminDb.collection("agentLinks").doc(token).get();
  if (!linkSnap.exists) return NextResponse.json({ error: "Link invalid or revoked" }, { status: 404 });
  const link = linkSnap.data();

  const ownerSnap = await adminDb.collection("users").doc(link.ownerUid).get();
  const acc = (ownerSnap.exists ? ownerSnap.data().accounts || [] : []).find((a) => a.id === link.accountId);
  if (!acc) return NextResponse.json({ error: "Account no longer available" }, { status: 404 });

  const pat = acc.pat;
  const headers = { Authorization: `token ${pat}`, Accept: "application/vnd.github.v3+json" };
  const { owner, repo } = link;

  try {
    const repoRes = await fetch(`${GITHUB_API}/repos/${owner}/${repo}`, { headers });
    if (!repoRes.ok) return NextResponse.json({ error: `Repo fetch failed: ${repoRes.status}` }, { status: repoRes.status });
    const repoData = await repoRes.json();
    const branch = repoData.default_branch;

    const refRes = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/git/ref/heads/${branch}`, { headers });
    const refData = await refRes.json();
    const commitSha = refData.object.sha;

    const commitRes = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/git/commits/${commitSha}`, { headers });
    const treeSha = (await commitRes.json()).tree.sha;

    const treeRes = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/git/trees/${treeSha}?recursive=1`, { headers });
    const treeData = await treeRes.json();
    const blobs = (treeData.tree || []).filter((i) => i.type === "blob" && !skip(i.path) && i.size <= MAX_FILE_BYTES);

    const files = [];
    let totalBytes = 0;
    let truncated = treeData.truncated || false;
    for (const item of blobs) {
      if (files.length >= MAX_FILES || totalBytes >= MAX_TOTAL_BYTES) { truncated = true; break; }
      const blobRes = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/git/blobs/${item.sha}`, { headers });
      if (!blobRes.ok) continue;
      const blobData = await blobRes.json();
      let content;
      try {
        content = Buffer.from(blobData.content, "base64").toString("utf-8");
      } catch {
        continue; // binary/undecodable — skip
      }
      files.push({ path: item.path, content });
      totalBytes += content.length;
    }

    return NextResponse.json({
      owner,
      repo,
      branch,
      fileCount: files.length,
      truncated,
      files,
    });
  } catch (e) {
    return NextResponse.json({ error: "Fetch failed", detail: String(e) }, { status: 500 });
  }
}
