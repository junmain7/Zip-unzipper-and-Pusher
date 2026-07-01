// FILE LOCATION: app/api/agent/[token]/file/[...path]/route.js
// (SINGLE FILE route — returns one file's full content by path)

import { NextResponse } from "next/server";
import { resolveAgentLink, githubHeaders, getDefaultBranch, GITHUB_API_BASE } from "../../../../../../lib/agentAuth";

const MAX_FILE_BYTES = 200 * 1024;

export const dynamic = "force-dynamic";

// GET /api/agent/[token]/file/<...path>  -> single file's full content
// Example: /api/agent/917499.../file/app/layout.js
export async function GET(request, { params }) {
  const { token, path } = params;
  if (!token) return NextResponse.json({ error: "Invalid link" }, { status: 400 });
  if (!path || path.length === 0) return NextResponse.json({ error: "No file path given" }, { status: 400 });

  const filePath = path.join("/");

  const resolved = await resolveAgentLink(token);
  if (resolved.error) return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  const { pat, owner, repo } = resolved;
  const headers = githubHeaders(pat);

  try {
    const branch = await getDefaultBranch(owner, repo, headers);

    const contentRes = await fetch(
      `${GITHUB_API_BASE}/repos/${owner}/${repo}/contents/${encodeURI(filePath)}?ref=${branch}`,
      { headers }
    );

    if (!contentRes.ok) {
      return NextResponse.json({ path: filePath, error: `Not found (${contentRes.status})` }, { status: contentRes.status });
    }

    const data = await contentRes.json();

    if (Array.isArray(data)) {
      return NextResponse.json({ path: filePath, error: "Path is a directory, not a file" }, { status: 400 });
    }

    if (data.size > MAX_FILE_BYTES) {
      return NextResponse.json({ path: filePath, error: `File too large (${data.size} bytes)` }, { status: 413 });
    }

    let content;
    try {
      content = Buffer.from(data.content, "base64").toString("utf-8");
    } catch {
      return NextResponse.json({ path: filePath, error: "Binary/undecodable file" }, { status: 415 });
    }

    return NextResponse.json({ owner, repo, branch, path: filePath, size: data.size, content });
  } catch (e) {
    return NextResponse.json({ error: "Fetch failed", detail: String(e) }, { status: 500 });
  }
}
