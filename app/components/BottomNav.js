"use client";

export default function BottomNav({ tabs, activeTab, setActiveTab }) {
  return (
    <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "#161b22", borderTop: "1px solid #21262d", display: "flex", zIndex: 50 }}>
      {tabs.map(tab => (
        <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{ flex: 1, padding: "12px 8px 14px", background: "none", border: "none", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: "4px", fontFamily: "inherit", borderTop: activeTab === tab.id ? "2px solid #58a6ff" : "2px solid transparent", position: "relative" }}>
          <span style={{ fontSize: "20px" }}>{tab.icon}</span>
          <span style={{ fontSize: "10px", fontWeight: 600, color: activeTab === tab.id ? "#58a6ff" : "#6e7681" }}>{tab.label}</span>

        </button>
      ))}
    </div>
  );
}
