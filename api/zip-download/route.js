import { NextResponse } from "next/server";

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const owner = searchParams.get("owner");
  const repo = searchParams.get("repo");
  const branch = searchParams.get("branch");
  const token = req.headers.get("authorization");

  if (!owner || !repo || !branch || !token) {
    return NextResponse.json({ error: "Missing owner/repo/branch/token" }, { status: 400 });
  }

  const ghRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/zipball/${branch}`,
    { headers: { Authorization: token, Accept: "application/vnd.github.v3+json" } }
  );

  if (!ghRes.ok) {
    return NextResponse.json({ error: `ZIP error: ${ghRes.status}` }, { status: ghRes.status });
  }

  const buf = await ghRes.arrayBuffer();
  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${repo}-${branch}.zip"`,
    },
  });
}
