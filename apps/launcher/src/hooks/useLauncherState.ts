import { useState, useEffect, useCallback, useMemo } from "react"
import {
  ThemeMode,
  LauncherScreen,
  LauncherView,
  SkinItem,
  CapeItem,
  GlobalSkin,
  PlayerSkin,
  GlobalCape,
  PlayerCape,
  DEFAULT_SKINS,
  DEFAULT_CAPES,
} from "../types"
import { CANVAS_W, MIN_WINDOW_W, hexToRGB } from "../theme/tokens"
import {
  fetchGlobalSkins,
  fetchMyPlayerSkin,
  fetchMyActiveSkin,
  setMyActiveSkin,
  uploadPlayerSkin,
  deleteMyPlayerSkin,
} from "../services/skinService"
import {
  fetchGlobalCapes,
  fetchMyPlayerCapes,
  fetchMyActiveCape,
  setMyActiveCape,
  uploadPlayerCape,
  deleteMyPlayerCape,
} from "../services/capeService"
import { authService } from "../services/authService"

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

  /* Skins Domain State */
  const [appliedSkin, setAppliedSkin] = useState<string>("player-custom")
  const [globalSkins, setGlobalSkins] = useState<GlobalSkin[]>([])
  const [playerSkin, setPlayerSkin] = useState<PlayerSkin | null>(null)
  const [skinsLoading, setSkinsLoading] = useState<boolean>(false)
  const [skinsError, setSkinsError] = useState<string | null>(null)

  /* Capes Domain State */
  const [appliedCape, setAppliedCape] = useState<string>("none")
  const [globalCapes, setGlobalCapes] = useState<GlobalCape[]>([])
  const [playerCapes, setPlayerCapes] = useState<PlayerCape[]>([])
  const [capesLoading, setCapesLoading] = useState<boolean>(false)
  const [capesError, setCapesError] = useState<string | null>(null)

  /**
   * Loads public catalogs (skins & capes)
   */
  const loadGlobalCatalog = useCallback(async () => {
    try {
      const [globals, gCapes] = await Promise.all([
        fetchGlobalSkins().catch(() => []),
        fetchGlobalCapes().catch(() => []),
      ])
      setGlobalSkins(globals)
      setGlobalCapes(gCapes)
    } catch (_) {}
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
   * Refreshes the authenticated player's capes collection and active cape selection
   */
  const refreshPlayerCapes = useCallback(async () => {
    const token = authService.getStoredToken()
    if (!token) {
      setPlayerCapes([])
      setAppliedCape("none")
      return
    }
    try {
      setCapesLoading(true)
      const [mine, active] = await Promise.all([
        fetchMyPlayerCapes(),
        fetchMyActiveCape(),
      ])
      setPlayerCapes(mine)
      if (active) {
        if (active.type === "NONE") {
          setAppliedCape("none")
        } else if (active.type === "CUSTOM" && active.playerCapeId) {
          setAppliedCape(active.playerCapeId)
        } else if (active.type === "GLOBAL" && active.capeId) {
          setAppliedCape(active.capeId)
        }
      }
      setCapesError(null)
    } catch (err: any) {
      setCapesError(err?.message || "No se pudo sincronizar las capas.")
    } finally {
      setCapesLoading(false)
    }
  }, [])

  /**
   * Applies and persists active skin selection
   */
  const handleApplySkin = useCallback(
    async (skinId: string) => {
      const previousSkin = appliedSkin
      setAppliedSkin(skinId)
      const token = authService.getStoredToken()
      if (!token) return

      try {
        let res: { success: boolean; data?: any; error?: string }
        if (skinId === "player-custom") {
          res = await setMyActiveSkin("CUSTOM")
        } else if (skinId && skinId !== "none") {
          res = await setMyActiveSkin("GLOBAL", skinId)
        } else {
          return
        }

        if (!res.success) {
          setAppliedSkin(previousSkin)
          setSkinsError(res.error || "No se pudo actualizar la skin activa")
        } else {
          setSkinsError(null)
        }
      } catch (err: any) {
        setAppliedSkin(previousSkin)
        setSkinsError(err?.message || "Error al actualizar la skin activa")
      }
    },
    [appliedSkin],
  )

  /**
   * Applies and persists active cape selection (NONE, GLOBAL, or CUSTOM)
   */
  const handleApplyCape = useCallback(
    async (capeId: string) => {
      const previousCape = appliedCape
      setAppliedCape(capeId)
      const token = authService.getStoredToken()
      if (!token) return

      try {
        let res: { success: boolean; data?: any; error?: string }
        if (!capeId || capeId === "none") {
          res = await setMyActiveCape("NONE")
        } else if (playerCapes.some((pc) => pc.id === capeId)) {
          res = await setMyActiveCape("CUSTOM", null, capeId)
        } else {
          res = await setMyActiveCape("GLOBAL", capeId, null)
        }

        if (!res.success) {
          setAppliedCape(previousCape)
          setCapesError(res.error || "No se pudo actualizar la capa activa")
        } else {
          setCapesError(null)
        }
      } catch (err: any) {
        setAppliedCape(previousCape)
        setCapesError(err?.message || "Error al actualizar la capa activa")
      }
    },
    [appliedCape, playerCapes],
  )

  // Initial load: fetch global catalog on mount, and player data if authenticated
  useEffect(() => {
    loadGlobalCatalog()
    if (authService.getStoredToken()) {
      refreshPlayerSkin()
      refreshPlayerCapes()
    }
  }, [loadGlobalCatalog, refreshPlayerSkin, refreshPlayerCapes])

  /**
   * Unified derived skins list (No model interpretation)
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
      })
    }

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

  /**
   * Unified derived capes list
   */
  const allCapes = useMemo<CapeItem[]>(() => {
    const items: CapeItem[] = [
      {
        id: "none",
        name: "Sin Capa",
        badge: "N/A",
        accent: "#64748b",
      },
    ]

    for (const pc of playerCapes) {
      items.push({
        id: pc.id,
        name: pc.name,
        badge: "CUSTOM",
        accent: "#10b981",
        customImgUrl: pc.imageUrl,
        capeUrl: pc.imageUrl,
      })
    }

    for (const gc of globalCapes) {
      items.push({
        id: gc.id,
        name: gc.name,
        badge: "OFFICIAL",
        accent: "#6366f1",
        customImgUrl: gc.imageUrl,
        capeUrl: gc.imageUrl,
      })
    }

    return items
  }, [playerCapes, globalCapes])

  const activeCapeData = useMemo(() => {
    const found = allCapes.find((c) => c.id === appliedCape)
    return found || allCapes[0] || DEFAULT_CAPES[0]
  }, [allCapes, appliedCape])

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
   * Upload and link a player custom skin
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
   * Upload and add a player custom cape
   */
  const handleUploadCape = useCallback(
    async (file: File, name?: string): Promise<PlayerCape> => {
      const uploaded = await uploadPlayerCape(file, name)
      setPlayerCapes((prev) => [uploaded, ...prev])
      setAppliedCape(uploaded.id)
      return uploaded
    },
    [],
  )

  /**
   * Delete a player custom cape
   */
  const handleDeleteCape = useCallback(
    async (id: string): Promise<boolean> => {
      const res = await deleteMyPlayerCape(id)
      if (res.success) {
        setPlayerCapes((prev) => prev.filter((c) => c.id !== id))
        if (appliedCape === id) {
          setAppliedCape("none")
        }
        return true
      }
      return false
    },
    [appliedCape],
  )

  /**
   * Handle user login success
   */
  const handleLogin = useCallback((name: string) => {
    setUsername(name)
    setScreen("home")
    setView("home")
    refreshPlayerSkin()
    refreshPlayerCapes()
    loadGlobalCatalog()
  }, [refreshPlayerSkin, refreshPlayerCapes, loadGlobalCatalog])

  /**
   * Handle user logout cleanly
   */
  const handleLogout = useCallback(() => {
    authService.logout()
    setPlayerSkin(null)
    setPlayerCapes([])
    setUsername("Jugador")
    setScreen("login")
    setView("home")
    if (appliedSkin === "player-custom") {
      setAppliedSkin("none")
    }
    setAppliedCape("none")
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
    setAppliedCape: handleApplyCape,
    globalSkins,
    playerSkin,
    skinsLoading,
    skinsError,
    globalCapes,
    playerCapes,
    capesLoading,
    capesError,
    allSkins,
    activeSkinData,
    activeSkinAccent,
    allCapes,
    activeCapeData,
    scale,
    handleUploadSkin,
    handleDeleteSkin,
    handleUploadCape,
    handleDeleteCape,
    refreshPlayerSkin,
    refreshPlayerCapes,
    handleLogin,
    handleLogout,
  }
}
