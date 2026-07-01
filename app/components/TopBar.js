"use client";

import { signOut } from "next-auth/react";

export default function TopBar({
  session, activeAccount, accounts, showAccountMenu, setShowAccountMenu, menuRef,
  setSidebarOpen, setShowSwitchModal, setShowAddModal, setShowInviteModal, setShowAgentModal, isInstalled, installPrompt, handleInstallClick,
}) {
  return (
    <>
      <div style={{ padding: "13px 18px", borderBottom: "1px solid #21262d", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0, gap: "10px", background: "linear-gradient(180deg, #11161d 0%, #0d1117 100%)", position: "sticky", top: 0, zIndex: 60 }}>
        {/* Hamburger + Logo + Title */}
        <div style={{ display: "flex", alignItems: "center", gap: "9px" }}>
          <button
            onClick={() => setSidebarOpen(true)}
            aria-label="Open menu"
            style={{ width: "34px", height: "34px", borderRadius: "8px", background: "#161b22", border: "1px solid #21262d", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, gap: "3px", flexDirection: "column" }}
          >
            <span style={{ width: "16px", height: "2px", background: "#c9d1d9", borderRadius: "2px" }} />
            <span style={{ width: "16px", height: "2px", background: "#c9d1d9", borderRadius: "2px" }} />
            <span style={{ width: "16px", height: "2px", background: "#c9d1d9", borderRadius: "2px" }} />
          </button>
          <div style={{ width: "30px", height: "30px", borderRadius: "8px", background: "#161b22", border: "1px solid #21262d", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "16px" }}>🐙</div>
          <div>
            <div style={{ fontSize: "13.5px", fontWeight: 700, color: "#f0f6fc", letterSpacing: "0.2px" }}>Smart Pusher</div>
            <div style={{ fontSize: "9.5px", color: "#6e7681", fontWeight: 500, marginTop: "-1px" }}>GitHub Deploy Tool</div>
          </div>
        </div>

        {/* Right: Avatar Dropdown */}
        <div ref={menuRef} style={{ position: "relative" }}>
          <button
            onClick={() => setShowAccountMenu(p => !p)}
            style={{ background: showAccountMenu ? "#161b22" : "none", border: "1px solid", borderColor: showAccountMenu ? "#30363d" : "transparent", borderRadius: "10px", cursor: "pointer", padding: "4px 8px 4px 4px", display: "flex", alignItems: "center", gap: "8px", transition: "all 0.15s ease" }}
          >
            {/* Avatar */}
            <div style={{ width: "30px", height: "30px", borderRadius: "50%", overflow: "hidden", border: `2px solid ${activeAccount ? "#2ea043" : "#30363d"}`, background: "#30363d", flexShrink: 0 }}>
              {activeAccount?.avatar
                ? <img src={activeAccount.avatar} alt="" style={{ width: "100%", height: "100%" }} />
                : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "14px" }}>👤</div>
              }
            </div>
            {/* Name + chevron */}
            <div style={{ textAlign: "left" }}>
              <div style={{ fontSize: "12px", fontWeight: 600, color: "#f0f6fc", maxWidth: "110px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {activeAccount ? activeAccount.label : (session?.user?.name || "Account")}
              </div>
              {activeAccount && <div style={{ fontSize: "10px", color: "#6e7681" }}>@{activeAccount.login}</div>}
            </div>
            <span style={{ color: "#6e7681", fontSize: "9px", transform: showAccountMenu ? "rotate(180deg)" : "none", transition: "transform 0.15s ease" }}>▾</span>
          </button>

          {/* Google-style Account Card */}
          {showAccountMenu && (
            <div style={{ position: "absolute", top: "calc(100% + 10px)", right: 0, width: "270px", maxWidth: "calc(100vw - 24px)", background: "#161b22", border: "1px solid #30363d", borderRadius: "14px", zIndex: 100, boxShadow: "0 16px 40px rgba(0,0,0,0.55), 0 2px 8px rgba(0,0,0,0.4)", overflow: "hidden", animation: "spDropdownIn 0.16s ease-out" }}>

              {/* Current account detail */}
              <div style={{ padding: "22px 16px 18px", display: "flex", flexDirection: "column", alignItems: "center", gap: "10px", borderBottom: "1px solid #21262d", background: "linear-gradient(180deg, #1a2029 0%, #161b22 100%)" }}>
                <div style={{ width: "54px", height: "54px", borderRadius: "50%", overflow: "hidden", border: "2px solid #2ea043", background: "#30363d", boxShadow: "0 0 0 4px rgba(46,160,67,0.12)" }}>
                  {activeAccount?.avatar
                    ? <img src={activeAccount.avatar} alt="" style={{ width: "100%", height: "100%" }} />
                    : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "22px" }}>👤</div>
                  }
                </div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: "13.5px", fontWeight: 700, color: "#f0f6fc" }}>
                    {activeAccount ? activeAccount.label : (session?.user?.name || "No account")}
                  </div>
                  <div style={{ fontSize: "11px", color: "#6e7681", marginTop: "2px" }}>
                    {activeAccount ? `@${activeAccount.login}` : (session?.user?.email || "")}
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div style={{ padding: "6px" }}>
                <button
                  onClick={() => { setShowSwitchModal(true); setShowAccountMenu(false); }}
                  className="sp-menu-item"
                  style={{ width: "100%", background: "none", border: "none", cursor: "pointer", padding: "10px 11px", display: "flex", alignItems: "center", gap: "11px", fontFamily: "inherit", borderRadius: "8px", transition: "background 0.12s ease" }}
                >
                  <span style={{ fontSize: "15px", width: "20px", textAlign: "center" }}>⇄</span>
                  <span style={{ fontSize: "12.5px", color: "#c9d1d9", fontWeight: 500 }}>Switch account</span>
                  {accounts.length > 0 && (
                    <span style={{ marginLeft: "auto", fontSize: "10px", background: "#21262d", color: "#8b949e", borderRadius: "10px", padding: "1px 7px" }}>{accounts.length}</span>
                  )}
                </button>

                <button
                  onClick={() => { setShowAddModal(true); setShowAccountMenu(false); }}
                  className="sp-menu-item"
                  style={{ width: "100%", background: "none", border: "none", cursor: "pointer", padding: "10px 11px", display: "flex", alignItems: "center", gap: "11px", fontFamily: "inherit", borderRadius: "8px", transition: "background 0.12s ease" }}
                >
                  <span style={{ fontSize: "15px", width: "20px", textAlign: "center" }}>➕</span>
                  <span style={{ fontSize: "12.5px", color: "#c9d1d9", fontWeight: 500 }}>Add account</span>
                </button>

                <button
                  onClick={() => { setShowInviteModal(true); setShowAccountMenu(false); }}
                  className="sp-menu-item"
                  style={{ width: "100%", background: "none", border: "none", cursor: "pointer", padding: "10px 11px", display: "flex", alignItems: "center", gap: "11px", fontFamily: "inherit", borderRadius: "8px", transition: "background 0.12s ease" }}
                >
                  <span style={{ fontSize: "15px", width: "20px", textAlign: "center" }}>🔗</span>
                  <span style={{ fontSize: "12.5px", color: "#c9d1d9", fontWeight: 500 }}>Invite link</span>
                </button>

                {accounts.length > 0 && (
                  <button
                    onClick={() => { setShowAgentModal(true); setShowAccountMenu(false); }}
                    className="sp-menu-item"
                    style={{ width: "100%", background: "none", border: "none", cursor: "pointer", padding: "10px 11px", display: "flex", alignItems: "center", gap: "11px", fontFamily: "inherit", borderRadius: "8px", transition: "background 0.12s ease" }}
                  >
                    <span style={{ fontSize: "15px", width: "20px", textAlign: "center" }}>🤖</span>
                    <span style={{ fontSize: "12.5px", color: "#c9d1d9", fontWeight: 500 }}>Agent link</span>
                  </button>
                )}
              </div>

              {/* Install App */}
              {!isInstalled && installPrompt && (
                <div style={{ borderTop: "1px solid #21262d", padding: "6px" }}>
                  <button
                    onClick={() => { setShowAccountMenu(false); handleInstallClick(); }}
                    className="sp-menu-item"
                    style={{ width: "100%", background: "none", border: "none", cursor: "pointer", padding: "10px 11px", display: "flex", alignItems: "center", gap: "11px", fontFamily: "inherit", borderRadius: "8px", transition: "background 0.12s ease" }}
                  >
                    <span style={{ fontSize: "15px", width: "20px", textAlign: "center" }}>📲</span>
                    <span style={{ fontSize: "12.5px", color: "#c9d1d9", fontWeight: 500 }}>Install App</span>
                  </button>
                </div>
              )}

              {/* Logout */}
              <div style={{ borderTop: "1px solid #21262d", padding: "6px" }}>
                <button
                  onClick={() => { setShowAccountMenu(false); signOut({ callbackUrl: "/login" }); }}
                  className="sp-menu-item-danger"
                  style={{ width: "100%", background: "none", border: "none", cursor: "pointer", padding: "10px 11px", display: "flex", alignItems: "center", gap: "11px", fontFamily: "inherit", borderRadius: "8px", transition: "background 0.12s ease" }}
                >
                  <span style={{ fontSize: "15px", width: "20px", textAlign: "center" }}>🚪</span>
                  <span style={{ fontSize: "12.5px", color: "#f85149", fontWeight: 500 }}>Logout</span>
                </button>
              </div>
            </div>
          )}
        </div>
        {/* end avatar wrapper */}
      </div>

      <style jsx global>{`
        @keyframes spDropdownIn {
          from { opacity: 0; transform: translateY(-6px) scale(0.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        .sp-menu-item:hover { background: #21262d; }
        .sp-menu-item-danger:hover { background: #2d1416; }
      `}</style>
    </>
  );
}
