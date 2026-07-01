import { NextResponse } from "next/server";
import { adminDb } from "../../../../lib/firebaseAdmin";

const GITHUB_API = "https://api.github.com";
const SKIP_DIRS = ["node_modules/", ".git/", ".next/", "dist/", "build/", ".vercel/"];
const SKIP_EXT = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".woff", ".woff2", ".ttf", ".eot", ".mp4", ".zip", ".lock"];
const MAX_FILE_BYTES = 200 * 1024;

function skip(path) {
  if (SKIP_DIRS.some((d) => path.startsWith(d) || path.includes("/" + d))) return true;
  if (SKIP_EXT.some((e) => path.toLowerCase().endsWith(e))) return true;
  return false;
}

async function resolveLink(token) {
  const linkSnap = await adminDb.collection("agentLinks").doc(token).get();
  if (!linkSnap.exists) return { error: "Link invalid or revoked", status: 404 };
  const link = linkSnap.data();

  const ownerSnap = await adminDb.collection("users").doc(link.ownerUid).get();
  const acc = (ownerSnap.exists ? ownerSnap.data().accounts || [] : []).find((a) => a.id === link.accountId);
  if (!acc) return { error: "Account no longer available", status: 404 };

  return { pat: acc.pat, owner: link.owner, repo: link.repo };
}

// GET /api/agent/[token]                 -> lightweight file list (paths + sizes only)
// GET /api/agent/[token]?file=some/path  -> single file's full content
// GET /api/agent/[token]?file=a,b,c      -> multiple files (comma-separated paths) in one call
export async function GET(request, { params }) {
  const { token } = params;
  if (!token) return NextResponse.json({ error: "Invalid link" }, { status: 400 });

  const resolved = await resolveLink(token);
  if (resolved.error) return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  const { pat, owner, repo } = resolved;

  const headers = { Authorization: `token ${pat}`, Accept: "application/vnd.github.v3+json" };
  const { searchParams } = new URL(request.url);
  const fileParam = searchParams.get("file");

  try {
    const repoRes = await fetch(`${GITHUB_API}/repos/${owner}/${repo}`, { headers });
    if (!repoRes.ok) return NextResponse.json({ error: `Repo fetch failed: ${repoRes.status}` }, { status: repoRes.status });
    const branch = (await repoRes.json()).default_branch;

    // ---- Single/multi file content mode ----
    if (fileParam) {
      const paths = fileParam.split(",").map((p) => p.trim()).filter(Boolean);
      const results = [];
      for (const path of paths) {
        const contentRes = await fetch(
          `${GITHUB_API}/repos/${owner}/${repo}/contents/${encodeURI(path)}?ref=${branch}`,
          { headers }
        );
        if (!contentRes.ok) {
          results.push({ path, error: `Not found (${contentRes.status})` });
          continue;
        }
        const data = await contentRes.json();
        if (Array.isArray(data)) {
          results.push({ path, error: "Path is a directory, not a file" });
          continue;
        }
        if (data.size > MAX_FILE_BYTES) {
          results.push({ path, error: `File too large (${data.size} bytes)` });
          continue;
        }
        let content;
        try {
          content = Buffer.from(data.content, "base64").toString("utf-8");
        } catch {
          results.push({ path, error: "Binary/undecodable file" });
          continue;
        }
        results.push({ path, content, size: data.size });
      }
      return NextResponse.json({ owner, repo, branch, files: results });
    }

    // ---- List-only mode (default) ----
    const refRes = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/git/ref/heads/${branch}`, { headers });
    const refData = await refRes.json();
    const commitSha = refData.object.sha;

    const commitRes = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/git/commits/${commitSha}`, { headers });
    const treeSha = (await commitRes.json()).tree.sha;

    const treeRes = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/git/trees/${treeSha}?recursive=1`, { headers });
    const treeData = await treeRes.json();

    const files = (treeData.tree || [])
      .filter((i) => i.type === "blob" && !skip(i.path))
      .map((i) => ({ path: i.path, size: i.size }));

    return NextResponse.json({
      owner,
      repo,
      branch,
      fileCount: files.length,
      truncated: treeData.truncated || false,
      files,
      hint: "Fetch a file's content with ?file=<path> (comma-separate multiple paths for a batch).",
    });
  } catch (e) {
    return NextResponse.json({ error: "Fetch failed", detail: String(e) }, { status: 500 });
  }
}
