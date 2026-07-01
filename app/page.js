"use client";

import { useState, useRef, useEffect } from "react";
import { useSession, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";

import { loadAccountsFromCloud, saveAccountsToCloud } from "../lib/storage";

import TopBar from "./components/TopBar";
import BottomNav from "./components/BottomNav";
import Sidebar from "./components/Sidebar";
import ZipTab from "./components/ZipTab";
import FilesTab from "./components/FilesTab";
import HistoryTab from "./components/HistoryTab";
import AccountsTab, { AddAccountModal, SwitchAccountModal, AccountsSkeleton } from "./components/AccountsTab";
import PullToRefresh from "./components/PullToRefresh";

export default function ZipPusherPage() {
  const { data: session, status: sessionStatus } = useSession();
  const router = useRouter();

  const [activeTab, setActiveTab] = useState("zip");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState("");
  const [accounts, setAccounts] = useState([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [activeAccountId, setActiveAccountId] = useState(null);
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showSwitchModal, setShowSwitchModal] = useState(false);
  const [installPrompt, setInstallPrompt] = useState(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const scrollRef = useRef(null);
  const menuRef = useRef();

  useEffect(() => { if (sessionStatus === "unauthenticated") router.push("/login"); }, [sessionStatus, router]);

  // PWA install prompt capture
  useEffect(() => {
    const onBeforeInstall = (e) => { e.preventDefault(); setInstallPrompt(e); };
    const onInstalled = () => { setIsInstalled(true); setInstallPrompt(null); };
    if (window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone) {
      setIsInstalled(true);
    }
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  async function handleInstallClick() {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  }

  useEffect(() => {
    if (sessionStatus !== "authenticated") return;
    setAccountsLoading(true);
    (async () => {
      const cloud = await loadAccountsFromCloud(); // null only if doc doesn't exist yet
      const finalAccounts = cloud?.accounts || [];
      const finalActive = cloud?.activeId || null;

      setAccounts(finalAccounts);
      if (finalActive && finalAccounts.find(a => a.id === finalActive)) {
        setActiveAccountId(finalActive);
      } else if (finalAccounts.length > 0) {
        setActiveAccountId(finalAccounts[0].id);
      } else {
        setActiveAccountId(null);
      }
      setAccountsLoading(false);
    })();
  }, [sessionStatus]);

  // Har baar accounts/active change ho, Firestore mein sync kar do (initial load ke baad hi —
  // warna load hote hi khaali state Firestore mein overwrite ho jayega)
  useEffect(() => {
    if (sessionStatus !== "authenticated" || accountsLoading) return;
    saveAccountsToCloud(accounts, activeAccountId);
  }, [accounts, activeAccountId, sessionStatus, accountsLoading]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!showAccountMenu) return;
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setShowAccountMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, [showAccountMenu]);

  const activeAccount = accounts.find(a => a.id === activeAccountId);
  const token = activeAccount?.pat || session?.accessToken || "";

  if (sessionStatus === "loading") return <div style={{ minHeight: "100vh", background: "#0d1117", color: "#8b949e", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "monospace" }}>Loading...</div>;
  if (sessionStatus !== "authenticated") return null;
  if (accountsLoading) return <AccountsSkeleton />;

  const tabs = [
    { id: "zip", label: "ZIP Push", icon: "📦" },
    { id: "files", label: "Files Push", icon: "🗂️" },
    { id: "history", label: "History", icon: "📜" },
  ];

  return (
    <div style={{ height: "100dvh", maxHeight: "100dvh", background: "#0d1117", color: "#c9d1d9", fontFamily: "'JetBrains Mono','Fira Code',monospace", display: "flex", flexDirection: "column", overflow: "hidden" }}>


      {/* Header */}
      <TopBar
        session={session}
        activeAccount={activeAccount}
        accounts={accounts}
        showAccountMenu={showAccountMenu}
        setShowAccountMenu={setShowAccountMenu}
        menuRef={menuRef}
        setSidebarOpen={setSidebarOpen}
        setShowSwitchModal={setShowSwitchModal}
        setShowAddModal={setShowAddModal}
        isInstalled={isInstalled}
        installPrompt={installPrompt}
        handleInstallClick={handleInstallClick}
      />
      {/* Content */}
      <PullToRefresh scrollRef={scrollRef}>
        <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "16px", paddingBottom: "80px" }}>
        {!token && activeTab !== "accounts" && (
          <div style={{ background: "#1f1207", border: "1px solid #e3b34144", borderRadius: "8px", padding: "14px", fontSize: "12px", color: "#e3b341", textAlign: "center", marginBottom: "14px" }}>
            ⚠️ Pehle <strong>Accounts</strong> tab mein ek account add karo
          </div>
        )}
        {/* zip/files tabs ko hamesha mounted rakha hai (display:none se chhupaya
            hai, unmount nahi kiya) — taaki push chal raha ho aur beech mein
            tab switch ho jaaye, to wapas us tab par aane par push logs zinda
            milein, dobara se shuru na karna pade. */}
        {token && (
          <div style={{ display: activeTab === "zip" ? "block" : "none" }}>
            <ZipTab token={token} selectedRepo={selectedRepo} setSelectedRepo={setSelectedRepo} />
          </div>
        )}
        {token && (
          <div style={{ display: activeTab === "files" ? "block" : "none" }}>
            <FilesTab token={token} selectedRepo={selectedRepo} setSelectedRepo={setSelectedRepo} />
          </div>
        )}
        {activeTab === "history" && token && <HistoryTab token={token} />}
        </div>
      </PullToRefresh>

      {/* Bottom Nav */}
      <BottomNav tabs={tabs} activeTab={activeTab} setActiveTab={setActiveTab} />

      {/* Left Sidebar drawer — Vercel env variables */}
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} activeAccountId={activeAccountId} token={token} />

      {/* Add Account Modal */}
      {showAddModal && (
        <AddAccountModal
          onClose={() => setShowAddModal(false)}
          accounts={accounts}
          setAccounts={setAccounts}
          activeAccountId={activeAccountId}
          setActiveAccountId={setActiveAccountId}
        />
      )}

      {/* Switch Account Modal */}
      {showSwitchModal && (
        <SwitchAccountModal
          onClose={() => setShowSwitchModal(false)}
          accounts={accounts}
          setAccounts={setAccounts}
          activeAccountId={activeAccountId}
          setActiveAccountId={setActiveAccountId}
          setSelectedRepo={setSelectedRepo}
          onAddNew={() => setShowAddModal(true)}
        />
      )}
    </div>
  );
}
