// ── Storage Helpers: Accounts (cloud), Backups, Push History (localStorage) ──

export function saveAccounts() {}
export function saveActiveId() {}
export function maskPat(pat) { if (!pat || pat.length < 8) return "••••••••"; return pat.slice(0, 4) + "••••••" + pat.slice(-4); }

export async function loadAccountsFromCloud() {
  try {
    const res = await fetch("/api/accounts");
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.accounts) return null;
    return data;
  } catch (e) { console.error("Cloud load failed:", e); return null; }
}
export async function saveAccountsToCloud(accounts, activeId) {
  try {
    await fetch("/api/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accounts, activeId }),
    });
  } catch (e) { console.error("Cloud save failed:", e); }
}

const BACKUPS_KEY = "ghpusher_backups";
export function loadBackups() { try { return JSON.parse(localStorage.getItem(BACKUPS_KEY) || "[]"); } catch { return []; } }
export function saveBackups(b) { localStorage.setItem(BACKUPS_KEY, JSON.stringify(b)); }
export function addBackup(record) {
  const all = loadBackups();
  all.unshift({ id: Math.random().toString(36).slice(2), ...record });
  // keep only last 8 restore points per owner/repo/branch to avoid bloat
  const key = `${record.owner}/${record.repo}@${record.branch}`;
  let countForKey = 0;
  const trimmed = all.filter(b => {
    const k = `${b.owner}/${b.repo}@${b.branch}`;
    if (k !== key) return true;
    countForKey++;
    return countForKey <= 8;
  });
  saveBackups(trimmed);
  return trimmed;
}


const HISTORY_KEY = "ghpusher_history";
export function loadHistory() { try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); } catch { return []; } }
export function saveHistory(h) { localStorage.setItem(HISTORY_KEY, JSON.stringify(h)); }
export function addHistoryEntry(record) {
  const all = loadHistory();
  all.unshift({ id: Math.random().toString(36).slice(2), timestamp: Date.now(), ...record });
  const trimmed = all.slice(0, 100); // keep last 100 entries total
  saveHistory(trimmed);
  return trimmed;
}
