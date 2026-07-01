// FILE LOCATION: app/api/agent/[token]/route.js
// (LIST route — returns file paths + sizes only, no content)

import { NextResponse } from "next/server";
import { resolveAgentLink, githubHeaders, getDefaultBranch, GITHUB_API_BASE } from "../../../../lib/agentAuth";

const SKIP_DIRS = ["node_modules/", ".git/", ".next/", "dist/", "build/", ".vercel/"];
const SKIP_EXT = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".woff", ".woff2", ".ttf", ".eot", ".mp4", ".zip", ".lock"];

function skip(path) {
  if (SKIP_DIRS.some((d) => path.startsWith(d) || path.includes("/" + d))) return true;
  if (SKIP_EXT.some((e) => path.toLowerCase().endsWith(e))) return true;
  return false;
}

export const dynamic = "force-dynamic";

// GET /api/agent/[token]  -> lightweight file list only (paths + sizes, no content)
// For actual file content use: /api/agent/[token]/file/<path/to/file>
export async function GET(request, { params }) {
  const { token } = params;
  if (!token) return NextResponse.json({ error: "Invalid link" }, { status: 400 });

  const resolved = await resolveAgentLink(token);
  if (resolved.error) return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  const { pat, owner, repo } = resolved;
  const headers = githubHeaders(pat);

  try {
    const branch = await getDefaultBranch(owner, repo, headers);

    const refRes = await fetch(`${GITHUB_API_BASE}/repos/${owner}/${repo}/git/ref/heads/${branch}`, { headers });
    const refData = await refRes.json();
    const commitSha = refData.object.sha;

    const commitRes = await fetch(`${GITHUB_API_BASE}/repos/${owner}/${repo}/git/commits/${commitSha}`, { headers });
    const treeSha = (await commitRes.json()).tree.sha;

    const treeRes = await fetch(`${GITHUB_API_BASE}/repos/${owner}/${repo}/git/trees/${treeSha}?recursive=1`, { headers });
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
      hint: `Fetch a file's content at: /api/agent/${token}/file/<path>  e.g. /api/agent/${token}/file/app/layout.js`,
    });
  } catch (e) {
    return NextResponse.json({ error: "Fetch failed", detail: String(e) }, { status: 500 });
  }
}
