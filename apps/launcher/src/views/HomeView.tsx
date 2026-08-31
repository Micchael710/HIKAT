import React from "react"
import { ThemeMode } from "../types"
import { getThemeTokens, CANVAS_W, CANVAS_H } from "../theme/tokens"
import { heroHomeBg, apparatiaLogo } from "../assets"
import DownloadPlayButton from "../components/server/DownloadPlayButton"
import NewsCarousel from "../components/news/NewsCarousel"
import ServerStatsGrid from "../components/server/ServerStatsGrid"
import CommunityHubGrid from "../components/server/CommunityHubGrid"
import { useTranslation } from "../context/LanguageContext"

interface HomeViewProps {
  theme?: ThemeMode
  onPlay?: () => void
  isActive?: boolean
}

export default function HomeView({
  theme = "dark",
  onPlay,
  isActive = true,
}: HomeViewProps) {
  const { t } = useTranslation()
  const tokens = getThemeTokens(theme)
  const CONTENT_LEFT = 184

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        position: "relative",
        animation: "viewFadeIn 0.24s ease",
      }}
    >
      {/* Hero Background */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: CANVAS_W,
          height: 1080,
        }}
      >
        <img
          alt="Apparatia World"
          src={heroHomeBg}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            display: "block",
          }}
        />
      </div>
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 1080,
          width: CANVAS_W,
          height: CANVAS_H - 1080,
          background: tokens.bgBase,
        }}
      />

      {/* Left gradient */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: CANVAS_W,
          height: 1080,
          background: tokens.homeLeftGradient,
          pointerEvents: "none",
        }}
      />

      {/* Bottom gradient overlay (Blends image smoothly into deep background before news section) */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 480,
          width: CANVAS_W,
          height: 600,
          background: tokens.homeBottomGradient,
          pointerEvents: "none",
        }}
      />

      {/* Angular Geometric Section Cut */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 1310,
          width: CANVAS_W,
          height: CANVAS_H - 1310,
          background: tokens.homeBottomCutBg,
          clipPath: "polygon(0 32px, 100% 0, 100% 100%, 0 100%)",
          pointerEvents: "none",
        }}
      />

      {/* APPARATIA title logo */}
      <div
        style={{
          position: "absolute",
          left: 152,
          top: 185,
          width: 610,
          height: 140,
        }}
      >
        <img
          alt="APPARATIA"
          src={apparatiaLogo}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
            objectPosition: "left center",
            display: "block",
          }}
        />
      </div>

      {/* Action Download / Play button */}
      <DownloadPlayButton
        left={CONTENT_LEFT}
        top={355}
        theme={theme}
        onPlay={onPlay}
      />

      {/* Description */}
      <div
        style={{
          position: "absolute",
          left: CONTENT_LEFT,
          top: 485,
          width: 580,
          color: tokens.textSecondary,
          fontFamily: "Inter, sans-serif",
          fontWeight: 400,
          fontSize: 22,
          lineHeight: 1.55,
        }}
      >
        {t("home.heroSubtitle")}
      </div>

      {/* ÚLTIMAS NOVEDADES (Positioned to peek smoothly at the bottom fold) */}
      <div
        style={{
          position: "absolute",
          left: CONTENT_LEFT,
          top: 860,
          color: tokens.textPrimary,
          fontFamily: "Inter, sans-serif",
          fontWeight: 800,
          fontSize: 26,
          letterSpacing: "-0.02em",
        }}
      >
        {t("news.sectionTitle")}
      </div>

      {/* News carousel (Top ~170px of the thumbnail is visible before scrolling) */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 908,
          height: 420,
        }}
      >
        <NewsCarousel
          canvasLeft={CONTENT_LEFT}
          canvasWidth={CANVAS_W}
          theme={theme}
          isActive={isActive}
        />
      </div>

      {/* Server Stats & Community Hub Section */}
      <div
        style={{
          position: "absolute",
          left: CONTENT_LEFT,
          top: 1410,
          width: CANVAS_W - CONTENT_LEFT - 80,
          display: "flex",
          flexDirection: "column",
          gap: 56,
          fontFamily: "Inter, sans-serif",
          paddingBottom: 90,
        }}
      >
        <ServerStatsGrid theme={theme} isActive={isActive} />
        <CommunityHubGrid theme={theme} />
      </div>
    </div>
  )
}
