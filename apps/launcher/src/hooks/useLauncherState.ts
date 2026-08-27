import { useState, useEffect, useCallback, useMemo } from "react"
import {
  ThemeMode,
  LauncherScreen,
  LauncherView,
  SkinItem,
  CapeItem,
  GlobalSkin,
  PlayerSkin,
  DEFAULT_SKINS,
  DEFAULT_CAPES,
} from "../types"
import { CANVAS_W, MIN_WINDOW_W, MIN_WINDOW_H, hexToRGB } from "../theme/tokens"
import {
  fetchGlobalSkins,
  fetchMyPlayerSkin,
  fetchMyActiveSkin,
  setMyActiveSkin,
  uploadPlayerSkin,
  deleteMyPlayerSkin,
} from "../services/skinService"
import { authService, UserProfile } from "../services/authService"

export function useLauncherState() {
  const [screen, setScreen] = useState<LauncherScreen>(() => {
    if (typeof window !== "undefined") {
      const token = authService.getStoredToken()
      if (token) return "home"
    }
    return "login"
  })

  const [username, setUsername] = useState<string>(() => {
    if (typeof window !== "undefined") {
      const cached = authService.getCachedUser()
      if (cached) return cached.displayName || cached.username || "Jugador"
    }
    return "Jugador"
  })

  const [view, setView] = useState<LauncherView>("home")

  /* Theme state with localStorage persistence */
  const [theme, setTheme] = useState<ThemeMode>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("hikat_theme")
      if (saved === "light" || saved === "dark") return saved
    }
    return "dark"
  })

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme)
    try {
      localStorage.setItem("hikat_theme", theme)
    } catch (_) {}
  }, [theme])

  /* Skins and Capes Domain State */
  const [appliedSkin, setAppliedSkin] = useState<string>("player-custom")
  const [appliedCape, setAppliedCape] = useState<string>("none")
  const [globalSkins, setGlobalSkins] = useState<GlobalSkin[]>([])
  const [playerSkin, setPlayerSkin] = useState<PlayerSkin | null>(null)
  const [skinsLoading, setSkinsLoading] = useState<boolean>(false)
  const [skinsError, setSkinsError] = useState<string | null>(null)

  // Capes collection (preserved for capes subsystem)
  const [customCapes, setCustomCapes] = useState<CapeItem[]>([])

  /**
   * Loads public global skins catalog (can be called unauthenticated or offline)
   */
  const loadGlobalCatalog = useCallback(async () => {
    try {
      const globals = await fetchGlobalSkins()
      setGlobalSkins(globals)
    } catch (err: any) {
      // Offline fallback
    }
  }, [])

  /**
   * Refreshes the authenticated player's personal custom skin and active selection
   */
  const refreshPlayerSkin = useCallback(async () => {
    const token = authService.getStoredToken()
    if (!token) {
      setPlayerSkin(null)
      return
    }
    try {
      setSkinsLoading(true)
      const [mine, active] = await Promise.all([
        fetchMyPlayerSkin(),
        fetchMyActiveSkin(),
      ])
      setPlayerSkin(mine)
      if (active) {
        if (active.type === "CUSTOM") {
          setAppliedSkin("player-custom")
        } else if (active.type === "GLOBAL" && active.skinId) {
          setAppliedSkin(active.skinId)
        }
      } else if (mine) {
        setAppliedSkin("player-custom")
      }
      setSkinsError(null)
    } catch (err: any) {
      setSkinsError(err?.message || "No se pudo sincronizar la skin del jugador.")
    } finally {
      setSkinsLoading(false)
    }
  }, [])

  /**
   * Applies and persists the active skin selection
   */
  const handleApplySkin = useCallback(async (skinId: string) => {
    setAppliedSkin(skinId)
    const token = authService.getStoredToken()
    if (!token) return

    try {
      if (skinId === "player-custom") {
        await setMyActiveSkin("CUSTOM")
      } else if (skinId && skinId !== "none") {
        await setMyActiveSkin("GLOBAL", skinId)
      }
    } catch {
      // Background sync
    }
  }, [])

  // Initial load: fetch global catalog on mount, and player skin if authenticated
  useEffect(() => {
    loadGlobalCatalog()
    if (authService.getStoredToken()) {
      refreshPlayerSkin()
    }
  }, [loadGlobalCatalog, refreshPlayerSkin])

  /**
   * Unified derived skins list:
   * 1. Player Custom Skin (if uploaded: badge 'CUSTOM')
   * 2. Backend Global Skins Catalog (badge 'OFFICIAL')
   * 3. Fallback DEFAULT_SKINS (only used when global catalog is empty, e.g. offline mode)
   */
  const allSkins = useMemo<SkinItem[]>(() => {
    const items: SkinItem[] = []

    if (playerSkin) {
      items.push({
        id: "player-custom",
        name: "Mi Skin",
        badge: "CUSTOM",
        accent: "#38bdf8",
        customImgUrl: playerSkin.imageUrl,
        skinUrl: playerSkin.imageUrl,
        model: (playerSkin.model?.toLowerCase() as any) || "classic",
      })
    }

    for (const gs of globalSkins) {
      items.push({
        id: gs.id,
        name: gs.name,
        badge: "OFFICIAL",
        accent: "#6366f1",
        customImgUrl: gs.imageUrl,
        skinUrl: gs.imageUrl,
        model: (gs.model?.toLowerCase() as any) || "classic",
      })
    }

    // Offline fallback policy: show DEFAULT_SKINS only if no remote skins available
    if (globalSkins.length === 0 && !playerSkin) {
      return DEFAULT_SKINS
    }

    return items
  }, [playerSkin, globalSkins])

  // Resolve active skin data for 3D preview and player badge
  const activeSkinData = useMemo(() => {
    const found = allSkins.find((s) => s.id === appliedSkin)
    return found || allSkins[0] || DEFAULT_SKINS[0]
  }, [allSkins, appliedSkin])

  const activeSkinAccent = useMemo(() => {
    return hexToRGB(
      activeSkinData?.accent || activeSkinData?.shirt || "#38bdf8",
    )
  }, [activeSkinData])

  /* Dynamic Responsive Window Scaling */
  const [scale, setScale] = useState(() => {
    if (typeof window === "undefined") return 1
    const width = Math.max(window.innerWidth, MIN_WINDOW_W)
    return width / CANVAS_W
  })

  useEffect(() => {
    const handleResize = () => {
      const currentW = window.innerWidth
      const s = Math.max(currentW, MIN_WINDOW_W) / CANVAS_W
      setScale(s)
    }
    handleResize()
    window.addEventListener("resize", handleResize)
    return () => window.removeEventListener("resize", handleResize)
  }, [])

  /**
   * Upload and link a player custom skin with safe replacement
   */
  const handleUploadSkin = useCallback(
    async (file: File): Promise<PlayerSkin> => {
      const uploaded = await uploadPlayerSkin(file)
      setPlayerSkin(uploaded)
      setAppliedSkin("player-custom")
      return uploaded
    },
    [],
  )

  /**
   * Delete player personal custom skin
   */
  const handleDeleteSkin = useCallback(async (): Promise<boolean> => {
    const res = await deleteMyPlayerSkin()
    if (res.success) {
      setPlayerSkin(null)
      if (appliedSkin === "player-custom") {
        setAppliedSkin("none")
      }
      return true
    }
    return false
  }, [appliedSkin])

  /**
   * Handle user login success
   */
  const handleLogin = useCallback((name: string) => {
    setUsername(name)
    setScreen("home")
    setView("home")
    refreshPlayerSkin()
    loadGlobalCatalog()
  }, [refreshPlayerSkin, loadGlobalCatalog])

  /**
   * Handle user logout cleanly
   */
  const handleLogout = useCallback(() => {
    authService.logout()
    setPlayerSkin(null)
    setUsername("Jugador")
    setScreen("login")
    setView("home")
    if (appliedSkin === "player-custom") {
      setAppliedSkin("none")
    }
  }, [appliedSkin])

  return {
    screen,
    setScreen,
    username,
    setUsername,
    view,
    setView,
    theme,
    setTheme,
    appliedSkin,
    setAppliedSkin: handleApplySkin,
    appliedCape,
    setAppliedCape,
    globalSkins,
    playerSkin,
    skinsLoading,
    skinsError,
    customCapes,
    setCustomCapes,
    allSkins,
    activeSkinData,
    activeSkinAccent,
    scale,
    handleUploadSkin,
    handleDeleteSkin,
    refreshPlayerSkin,
    handleLogin,
    handleLogout,
  }
}
