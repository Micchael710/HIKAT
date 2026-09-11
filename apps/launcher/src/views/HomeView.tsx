import React, { useState, useEffect, useMemo, useCallback } from "react"
import { ThemeMode } from "../types"
import { getThemeTokens, CANVAS_W, CANVAS_H } from "../theme/tokens"
import DownloadPlayButton from "../components/server/DownloadPlayButton"
import NewsCarousel from "../components/news/NewsCarousel"
import ServerStatsGrid from "../components/server/ServerStatsGrid"
import CommunityHubGrid from "../components/server/CommunityHubGrid"
import { useTranslation } from "../context/LanguageContext"
import { gameService, type ReleaseActivatedEvent } from "../services/gameService"
import { resolveApiAssetUrl } from "../config/api"
import { useServerAccent } from "../utils/dynamicAccent"
import type { PublishedModpack } from "../vite-env"
import type { LauncherServer } from "../services/serverService"
import type { LauncherGameState } from "../hooks/useLauncherState"

interface HomeViewProps {
  theme?: ThemeMode
  onPlay?: () => void
  isActive?: boolean
  selectedServer?: LauncherServer | null
  selectedGameId?: string | null
  servers?: LauncherServer[]
  lastReleaseEvent?: ReleaseActivatedEvent | null
  serverGameState?: LauncherGameState
  onInstalledVersionChange?: (version: string | null) => void
  onClearIntegrityDirty?: () => void
}

export default function HomeView({
  theme = "dark",
  onPlay,
  isActive = true,
  selectedServer,
  servers: _servers,
  lastReleaseEvent,
  serverGameState,
  onInstalledVersionChange,
  onClearIntegrityDirty,
}: HomeViewProps) {
  const { t } = useTranslation()
  const tokens = getThemeTokens(theme)
  const CONTENT_LEFT = 184

  const gameContext = useMemo(
    () =>
      selectedServer
        ? {
            gameId: selectedServer.id,
            gameName: selectedServer.name,
          }
        : null,
    [selectedServer?.id, selectedServer?.name],
  )

  const activeServerId = selectedServer?.id || null
  const serverName = selectedServer?.name || ""

  const mainLogoUrl = selectedServer?.mainLogo?.url
  const sidebarLogoUrl = selectedServer?.sidebarLogo?.url
  const logoUrlForAccent = mainLogoUrl || sidebarLogoUrl || null
  const resolvedAccent = useServerAccent(selectedServer?.accentColor, logoUrlForAccent, "#3ec4c0")

  const [localPublishedModpack, setLocalPublishedModpack] = useState<PublishedModpack | null>(null)
  const publishedModpack = serverGameState !== undefined ? serverGameState.publishedModpack : localPublishedModpack
  const [mediaError, setMediaError] = useState(false)
  const [mainLogoFailed, setMainLogoFailed] = useState(false)
  const [sidebarLogoFailed, setSidebarLogoFailed] = useState(false)

  // Immediately clear previous server visual state when selectedServer changes
  useEffect(() => {
    setLocalPublishedModpack(null)
    setMainLogoFailed(false)
    setSidebarLogoFailed(false)
    setMediaError(false)
  }, [selectedServer?.id])

  useEffect(() => {
    setMainLogoFailed(false)
    setSidebarLogoFailed(false)
  }, [
    selectedServer?.id,
    selectedServer?.mainLogo?.url,
    selectedServer?.sidebarLogo?.url,
  ])

  const loadPublished = useCallback(async () => {
    if (serverGameState !== undefined) return
    if (!activeServerId) {
      setLocalPublishedModpack(null)
      return
    }
    try {
      const data = await gameService.getPublishedModpack(activeServerId)
      setLocalPublishedModpack(data)
      setMediaError(false)
    } catch {
      // Leave publishedModpack null
    }
  }, [activeServerId, serverGameState])

  useEffect(() => {
    loadPublished()
  }, [loadPublished])

  useEffect(() => {
    if (serverGameState !== undefined) return
    if (!lastReleaseEvent || lastReleaseEvent.type !== "RELEASE_ACTIVATED") {
      return
    }
    if (!lastReleaseEvent.serverId || !activeServerId) {
      return
    }
    if (lastReleaseEvent.serverId === activeServerId) {
      loadPublished()
    }
  }, [lastReleaseEvent, activeServerId, loadPublished, serverGameState])

  const cover = publishedModpack?.cover
  const coverUrl = cover?.url ? resolveApiAssetUrl(cover.url) : ""

  const hasMainLogo = Boolean(!mainLogoFailed && mainLogoUrl)
  const hasSidebarLogo = Boolean(!sidebarLogoFailed && sidebarLogoUrl)

  let logoSrc: string | null = null
  let onLogoError: (() => void) | undefined = undefined

  if (hasMainLogo) {
    logoSrc = resolveApiAssetUrl(mainLogoUrl!)
    onLogoError = () => setMainLogoFailed(true)
  } else if (hasSidebarLogo) {
    logoSrc = resolveApiAssetUrl(sidebarLogoUrl!)
    onLogoError = () => setSidebarLogoFailed(true)
  }

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
          background: tokens.bgBase,
        }}
      >
        {!mediaError && cover?.mediaType === "VIDEO" && coverUrl ? (
          <video
            src={coverUrl}
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            onError={() => setMediaError(true)}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
            }}
          />
        ) : !mediaError && cover?.mediaType === "IMAGE" && coverUrl ? (
          <img
            alt={serverName ? `${serverName} World` : "World"}
            src={coverUrl}
            onError={() => setMediaError(true)}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
            }}
          />
        ) : null}
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

      {/* Server title logo */}
      <div
        style={{
          position: "absolute",
          left: 152,
          top: 185,
          width: 610,
          height: 140,
        }}
      >
        {logoSrc ? (
          <img
            alt={serverName}
            src={logoSrc}
            onError={onLogoError}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "contain",
              objectPosition: "left center",
              display: "block",
            }}
          />
        ) : null}
      </div>

      {/* Action Download / Play button */}
      <DownloadPlayButton
        key={selectedServer?.id || "no-server"}
        left={CONTENT_LEFT}
        top={355}
        theme={theme}
        onPlay={onPlay}
        serverId={activeServerId}
        gameId={activeServerId}
        gameContext={gameContext}
        accent={resolvedAccent}
        publishedModpack={serverGameState !== undefined ? serverGameState.publishedModpack : localPublishedModpack}
        installedVersion={serverGameState?.installedVersion}
        integrityDirty={serverGameState?.integrityDirty}
        onInstalledVersionChange={onInstalledVersionChange}
        onClearIntegrityDirty={onClearIntegrityDirty}
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
        {publishedModpack?.notes?.trim() ? publishedModpack.notes : ""}
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
          serverId={activeServerId}
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
        <ServerStatsGrid
          theme={theme}
          isActive={isActive}
          serverId={activeServerId}
          serverName={serverName}
          resolvedAccent={resolvedAccent}
        />
        <CommunityHubGrid theme={theme} />
      </div>
    </div>
  )
}
