import React, { useState, useEffect } from "react"
import { ThemeMode, NewsCardItem } from "../../types"
import { IconCross, IconPlay } from "../../theme/icons"
import { useTranslation } from "../../context/LanguageContext"
import { useDynamicAccent } from "../../utils/dynamicAccent"

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
  const { t, language } = useTranslation()
  const isDark = theme === "dark"
  const [isPlaying, setIsPlaying] = useState(false)

  const accent = useDynamicAccent(card.img, card.accentColor || "#38bdf8")

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [onClose])

  // Get localized type label
  const getTypeLabel = (type?: string): string => {
    switch (type?.toUpperCase()) {
      case "UPDATE":
        return t("news.typeUpdate")
      case "ANNOUNCEMENT":
        return t("news.typeAnnouncement")
      case "MAINTENANCE":
        return t("news.typeMaintenance")
      case "NEWS":
      default:
        return t("news.typeNews")
    }
  }

  // Format date if available
  const formattedDate = card.date
    ? (() => {
        try {
          const d = new Date(card.date)
          if (!isNaN(d.getTime())) {
            return d.toLocaleDateString(
              language === "es"
                ? "es-ES"
                : language === "fr"
                  ? "fr-FR"
                  : language === "pt"
                    ? "pt-BR"
                    : "en-US",
              { year: "numeric", month: "short", day: "numeric" },
            )
          }
        } catch (_) {}
        return card.date
      })()
    : null

  const hasYouTube = Boolean(card.youtubeVideoId)
  const hasUploadedVideo = Boolean(!card.youtubeVideoId && card.videoUrl)

  // Strictly constructed YouTube embed URL using only youtubeVideoId
  const youtubeEmbedUrl = card.youtubeVideoId
    ? `https://www.youtube.com/embed/${encodeURIComponent(card.youtubeVideoId)}?autoplay=1&rel=0`
    : null

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 500,
        background: "rgba(0, 0, 0, 0.8)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backdropFilter: "blur(8px)",
        animation: "fadeIn .18s ease",
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 720,
          maxWidth: "92vw",
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          background: isDark ? "#121b22" : "#ffffff",
          borderRadius: 20,
          overflow: "hidden",
          border: isDark
            ? `1.5px solid rgba(${accent.css}, 0.35)`
            : `1.5px solid rgba(${accent.css}, 0.45)`,
          boxShadow: isDark
            ? `0 24px 80px rgba(0, 0, 0, 0.75), 0 0 32px rgba(${accent.css}, 0.18)`
            : `0 24px 80px rgba(0, 0, 0, 0.18), 0 0 24px rgba(${accent.css}, 0.15)`,
          animation: "slideUp .22s ease",
        }}
      >
        {/* Media Container (Image, YouTube embed, or Native Video) */}
        <div
          style={{
            position: "relative",
            width: "100%",
            height: 350,
            background: "#000000",
            flexShrink: 0,
          }}
        >
          {hasYouTube ? (
            isPlaying && youtubeEmbedUrl ? (
              <iframe
                src={youtubeEmbedUrl}
                title={card.title}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
                style={{
                  width: "100%",
                  height: "100%",
                  border: "none",
                  display: "block",
                }}
              />
            ) : (
              <div
                style={{
                  position: "relative",
                  width: "100%",
                  height: "100%",
                }}
              >
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
                    background: "rgba(0, 0, 0, 0.35)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {/* Formal Play Button */}
                  <button
                    type="button"
                    onClick={() => setIsPlaying(true)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "12px 24px",
                      borderRadius: 14,
                      background: "rgba(0, 0, 0, 0.75)",
                      border: `1.5px solid rgba(${accent.css}, 0.6)`,
                      color: "#ffffff",
                      fontSize: 14,
                      fontWeight: 700,
                      cursor: "pointer",
                      backdropFilter: "blur(10px)",
                      boxShadow: `0 8px 30px rgba(0, 0, 0, 0.6), 0 0 20px rgba(${accent.css}, 0.3)`,
                      transition: "transform 0.16s ease, background 0.16s ease",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = "scale(1.05)"
                      e.currentTarget.style.background = "rgba(20, 20, 20, 0.9)"
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = "scale(1)"
                      e.currentTarget.style.background = "rgba(0, 0, 0, 0.75)"
                    }}
                  >
                    <IconPlay size={20} />
                    <span>{t("news.playVideo")}</span>
                  </button>
                </div>
              </div>
            )
          ) : hasUploadedVideo && card.videoUrl ? (
            <video
              controls
              src={card.videoUrl}
              poster={card.img}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                display: "block",
              }}
            />
          ) : (
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
          )}

          {/* Clean Close Button using formal theme icon */}
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            style={{
              position: "absolute",
              top: 14,
              right: 14,
              width: 34,
              height: 34,
              borderRadius: "50%",
              background: isDark ? "rgba(10, 15, 20, 0.75)" : "rgba(255, 255, 255, 0.85)",
              border: isDark
                ? "1px solid rgba(255, 255, 255, 0.2)"
                : "1px solid rgba(0, 0, 0, 0.15)",
              color: isDark ? "#ffffff" : "#111822",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              backdropFilter: "blur(8px)",
              transition: "transform 0.15s ease, background 0.15s ease",
              zIndex: 10,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = "scale(1.08)"
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "scale(1)"
            }}
          >
            <IconCross size={16} />
          </button>
        </div>

        {/* Text Details Area */}
        <div
          style={{
            padding: "24px 30px 32px",
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          {/* Top Meta Row: Type Badge + Date */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
            }}
          >
            <span
              style={{
                fontSize: 11,
                fontWeight: 800,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                padding: "3px 10px",
                borderRadius: 6,
                background: `rgba(${accent.css}, 0.15)`,
                border: `1px solid rgba(${accent.css}, 0.35)`,
                color: isDark ? `rgb(${accent.css})` : "#1e293b",
              }}
            >
              {getTypeLabel(card.type)}
            </span>

            {formattedDate && (
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  color: isDark ? "rgba(255, 255, 255, 0.5)" : "#64748b",
                }}
              >
                {formattedDate}
              </span>
            )}
          </div>

          {/* Title */}
          <h2
            style={{
              margin: 0,
              color: isDark ? "#ffffff" : "#111822",
              fontFamily: "Inter, sans-serif",
              fontWeight: 800,
              fontSize: 22,
              lineHeight: 1.3,
              letterSpacing: "-0.015em",
            }}
          >
            {card.title}
          </h2>

          {/* Body Content */}
          <p
            style={{
              margin: 0,
              color: isDark ? "rgba(255, 255, 255, 0.75)" : "#475569",
              fontFamily: "Inter, sans-serif",
              fontSize: 15,
              lineHeight: 1.65,
              whiteSpace: "pre-line",
            }}
          >
            {card.content || card.desc}
          </p>
        </div>
      </div>
    </div>
  )
}
