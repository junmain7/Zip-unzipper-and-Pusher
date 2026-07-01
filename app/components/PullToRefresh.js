"use client";

import { useRef, useEffect, useState, useCallback } from "react";

const THRESHOLD = 70;   // kitna neeche khainche tab refresh trigger ho
const MAX_PULL  = 110;  // indicator kitne tak neeche jayega max
const RESISTANCE = 0.45; // finger movement ka kitna hissa reflect ho (rubber-band feel)

export default function PullToRefresh({ children, scrollRef }) {
  const startYRef   = useRef(null);
  const pullDist    = useRef(0);
  const isPulling   = useRef(false);
  const indicatorRef = useRef(null);
  const spinnerRef   = useRef(null);
  const [refreshing, setRefreshing] = useState(false);

  const setIndicator = useCallback((dist, spinning = false) => {
    if (!indicatorRef.current || !spinnerRef.current) return;
    const el  = indicatorRef.current;
    const sp  = spinnerRef.current;
    const clamped = Math.min(dist, MAX_PULL);
    const opacity = Math.min(clamped / THRESHOLD, 1);
    const scale   = 0.6 + 0.4 * Math.min(clamped / THRESHOLD, 1);
    const rotate  = spinning ? "" : `rotate(${Math.min(clamped / THRESHOLD, 1) * 220}deg)`;

    el.style.transform  = `translateY(${clamped - 50}px)`;
    el.style.opacity    = opacity;
    sp.style.transform  = rotate;
    sp.style.animation  = spinning ? "ptr-spin 0.7s linear infinite" : "none";
    sp.textContent      = spinning ? "↻" : (clamped >= THRESHOLD ? "↻" : "↓");
    el.style.color      = clamped >= THRESHOLD ? "#3fb950" : "#58a6ff";
    el.style.borderColor = clamped >= THRESHOLD ? "#3fb95044" : "#58a6ff44";
  }, []);

  const hideIndicator = useCallback(() => {
    if (!indicatorRef.current) return;
    indicatorRef.current.style.transition = "transform 0.3s ease, opacity 0.3s ease";
    indicatorRef.current.style.transform  = "translateY(-50px)";
    indicatorRef.current.style.opacity    = "0";
    setTimeout(() => {
      if (indicatorRef.current) indicatorRef.current.style.transition = "";
    }, 300);
  }, []);

  useEffect(() => {
    const el = scrollRef?.current;
    if (!el) return;

    const onTouchStart = (e) => {
      if (el.scrollTop > 0) return; // sirf top par ho to hi
      startYRef.current = e.touches[0].clientY;
      isPulling.current = false;
      pullDist.current  = 0;
    };

    const onTouchMove = (e) => {
      if (startYRef.current === null) return;
      if (el.scrollTop > 0) { startYRef.current = null; return; }

      const dy = e.touches[0].clientY - startYRef.current;
      if (dy <= 0) return; // upar scroll ho raha hai, ignore

      isPulling.current = true;
      pullDist.current  = dy * RESISTANCE;
      e.preventDefault(); // page scroll rok
      setIndicator(pullDist.current);
    };

    const onTouchEnd = () => {
      if (!isPulling.current) { startYRef.current = null; return; }
      isPulling.current = false;
      startYRef.current = null;

      if (pullDist.current >= THRESHOLD) {
        setRefreshing(true);
        setIndicator(THRESHOLD, true); // spinner on
        // Thoda delay do taaki spinner dikhe, phir reload
        setTimeout(() => { window.location.reload(); }, 700);
      } else {
        hideIndicator();
      }
      pullDist.current = 0;
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove",  onTouchMove,  { passive: false });
    el.addEventListener("touchend",   onTouchEnd,   { passive: true });

    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove",  onTouchMove);
      el.removeEventListener("touchend",   onTouchEnd);
    };
  }, [scrollRef, setIndicator, hideIndicator]);

  return (
    <div style={{ position: "relative", flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
      {/* Pull indicator — normally hidden upar */}
      <div
        ref={indicatorRef}
        style={{
          position: "absolute", top: 0, left: "50%",
          transform: "translate(-50%, -50px)",
          zIndex: 100, opacity: 0, pointerEvents: "none",
          width: "40px", height: "40px",
          background: "#0d1117",
          border: "1.5px solid #58a6ff44",
          borderRadius: "50%",
          display: "flex", alignItems: "center", justifyContent: "center",
          color: "#58a6ff",
          fontSize: "20px",
          boxShadow: "0 4px 16px #00000066",
          // translateY sirf Y axis ke liye hai, X center karne ke liye marginLeft use
          marginLeft: "-20px",
        }}
      >
        <span ref={spinnerRef} style={{ display: "inline-block", lineHeight: 1 }}>↓</span>
      </div>

      {/* Spin animation */}
      <style>{`
        @keyframes ptr-spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>

      {children}
    </div>
  );
}
