import React from "react"
import { ThemeMode, NewsCardItem } from "../../types"
import { useDynamicAccent } from "../../utils/dynamicAccent"

interface NewsCardProps {
  card: NewsCardItem
  CARD_W: number
  CARD_H: number
  onClick: () => void
  theme?: ThemeMode
}

export default function NewsCard({
  card,
  CARD_W,
  CARD_H,
  onClick,
}: NewsCardProps) {
  // Extract dominant accent dynamically from thumbnail image
  const accent = useDynamicAccent(card.img, card.accentColor || "#38bdf8")

  const hasVideo = Boolean(card.youtubeVideoId || card.videoUrl)

  return (
    <div
      onClick={onClick}
      className="news-card-item"
      style={{
        width: CARD_W,
        height: CARD_H,
        borderRadius: 18,
        position: "relative",
        overflow: "hidden",
        cursor: "pointer",
        userSelect: "none",
        flexShrink: 0,
        isolation: "isolate",
        transform: "translate3d(0, 0, 0)",
        willChange: "transform",
        ["--card-border-color" as any]: `rgba(${accent.css}, 0.85)`,
        ["--card-glow-color" as any]: `rgba(${accent.css}, 0.28)`,
      }}
    >
      {/* Full-bleed background thumbnail image */}
      <img
        src={card.img}
        alt={card.title}
        draggable={false}
        className="news-thumbnail-img"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          display: "block",
          transition: "transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)",
          pointerEvents: "none",
        }}
      />

      {/* Dynamic bottom accent glow wash */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `linear-gradient(to top, rgba(${accent.css}, 0.42) 0%, rgba(${accent.css}, 0.12) 35%, transparent 65%)`,
          pointerEvents: "none",
        }}
      />

      {/* Deep black gradient overlay for crisp text readability */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(to top, rgba(8, 12, 16, 0.95) 0%, rgba(8, 12, 16, 0.65) 42%, rgba(8, 12, 16, 0.1) 75%, transparent 100%)",
          pointerEvents: "none",
        }}
      />

      {/* Video Indicator Badge (Clean & Formal) */}
      {hasVideo && (
        <div
          style={{
            position: "absolute",
            top: 14,
            right: 14,
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 10px",
            borderRadius: 8,
            background: "rgba(0, 0, 0, 0.65)",
            backdropFilter: "blur(8px)",
            border: `1px solid rgba(${accent.css}, 0.4)`,
            color: "#ffffff",
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: "0.02em",
            pointerEvents: "none",
          }}
        >
          <svg width={12} height={12} viewBox="0 0 24 24" fill="currentColor">
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
          <span>VIDEO</span>
        </div>
      )}

      {/* Bottom Title Container */}
      <div
        style={{
          position: "absolute",
          left: 18,
          right: 18,
          bottom: 16,
          display: "flex",
          flexDirection: "column",
          gap: 4,
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            color: "#ffffff",
            fontFamily: "Inter, sans-serif",
            fontWeight: 800,
            fontSize: 20,
            lineHeight: 1.25,
            letterSpacing: "-0.015em",
            textShadow: "0 2px 10px rgba(0, 0, 0, 0.9)",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {card.title}
        </div>
      </div>
    </div>
  )
}
