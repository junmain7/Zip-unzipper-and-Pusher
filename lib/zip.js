// ── ZIP / file utility helpers ─────────────────────────────

export function uint8ToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export async function readFileAsArrayBuffer(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsArrayBuffer(file);
  });
}

export async function readFileAsUint8(file) {
  return new Uint8Array(await readFileAsArrayBuffer(file));
}

export async function computeGitBlobSha(uint8) {
  const header = new TextEncoder().encode(`blob ${uint8.byteLength}\0`);
  const combined = new Uint8Array(header.length + uint8.length);
  combined.set(header, 0);
  combined.set(uint8, header.length);
  const hashBuffer = await crypto.subtle.digest("SHA-1", combined);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// "members-page.js" → "members/page.js"
// "api-auth-route.js" → "api/auth/route.js"
export function autoConvertPath(filename) {
  const dotIdx = filename.lastIndexOf(".");
  const ext = dotIdx !== -1 ? filename.slice(dotIdx) : "";
  const base = dotIdx !== -1 ? filename.slice(0, dotIdx) : filename;
  return base.replace(/-/g, "/") + ext;
}

// ── ZIP Parser ────────────────────────────────────────────
export function parseZip(buffer) {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const files = [];
  let offset = 0;
  while (offset < bytes.length - 4) {
    const sig = view.getUint32(offset, true);
    if (sig !== 0x04034b50) break;
    const compression = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const fileNameLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);
    const name = new TextDecoder().decode(bytes.slice(offset + 30, offset + 30 + fileNameLen));
    const dataOffset = offset + 30 + fileNameLen + extraLen;
    const compressedData = bytes.slice(dataOffset, dataOffset + compressedSize);
    if (!name.endsWith("/")) files.push({ name, compressedData, compression, compressedSize });
    offset = dataOffset + compressedSize;
  }
  return files;
}

export async function decompressFile(file) {
  if (file.compression === 0) return file.compressedData;
  if (file.compression === 8) {
    const ds = new DecompressionStream("deflate-raw");
    const writer = ds.writable.getWriter();
    const reader = ds.readable.getReader();
    writer.write(file.compressedData);
    writer.close();
    const chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const total = chunks.reduce((s, c) => s + c.length, 0);
    const result = new Uint8Array(total);
    let pos = 0;
    for (const chunk of chunks) { result.set(chunk, pos); pos += chunk.length; }
    return result;
  }
  throw new Error(`Unsupported compression: ${file.compression}`);
}

export function detectWrapperFolder(rawFiles) {
  const fileEntries = rawFiles.filter(f => f.name && !f.name.endsWith("/"));
  if (fileEntries.length === 0) return false;
  let common = null;
  for (const f of fileEntries) {
    const idx = f.name.indexOf("/");
    if (idx === -1) return false; // a file sits at the true root → no single wrapper
    const top = f.name.slice(0, idx);
    if (common === null) common = top;
    else if (common !== top) return false; // different top-level folders → no single wrapper
  }
  return true;
}
