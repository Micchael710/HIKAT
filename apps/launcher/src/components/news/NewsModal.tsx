import React, { useEffect } from "react"
import { ThemeMode, NewsCardItem } from "../../types"

interface NewsModalProps {
  card: NewsCardItem
  onClose: () => void
  theme?: ThemeMode
}

export default function NewsModal({
  card,
  onClose,
  theme = "dark",
}: NewsModalProps) {
  const isDark = theme === "dark"

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [onClose])

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 500,
        background: "rgba(0,0,0,0.78)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backdropFilter: "blur(7px)",
        animation: "fadeIn .18s ease",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 680,
          maxWidth: "90vw",
          background: isDark ? "#131d25" : "#ffffff",
          borderRadius: 18,
          overflow: "hidden",
          border: isDark
            ? "1px solid rgba(255,255,255,0.1)"
            : "1px solid rgba(0,0,0,0.1)",
          boxShadow: isDark
            ? "0 24px 80px rgba(0,0,0,0.7)"
            : "0 24px 80px rgba(0,0,0,0.18)",
          animation: "slideUp .22s ease",
        }}
      >
        <div style={{ position: "relative", height: 320 }}>
          <img
            src={card.img}
            alt={card.title}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
            }}
          />
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: isDark
                ? "linear-gradient(to top, rgba(19,29,37,.9) 0%, transparent 55%)"
                : "linear-gradient(to top, rgba(255,255,255,.9) 0%, transparent 55%)",
            }}
          />
          <button
            type="button"
            onClick={onClose}
            style={{
              position: "absolute",
              top: 14,
              right: 14,
              width: 32,
              height: 32,
              borderRadius: "50%",
              background: isDark ? "rgba(0,0,0,.5)" : "rgba(255,255,255,.8)",
              border: isDark
                ? "1px solid rgba(255,255,255,.18)"
                : "1px solid rgba(0,0,0,.15)",
              color: isDark ? "white" : "#111822",
              fontSize: 16,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            ✕
          </button>
        </div>
        <div style={{ padding: "24px 28px 32px" }}>
          <h2
            style={{
              margin: "0 0 12px",
              color: isDark ? "white" : "#111822",
              fontFamily: "Inter, sans-serif",
              fontWeight: 700,
              fontSize: 22,
            }}
          >
            {card.title}
          </h2>
          <p
            style={{
              margin: 0,
              color: isDark ? "rgba(255,255,255,.6)" : "#556677",
              fontFamily: "Inter, sans-serif",
              fontSize: 15,
              lineHeight: 1.65,
            }}
          >
            {card.desc}
          </p>
        </div>
      </div>
    </div>
  )
}
