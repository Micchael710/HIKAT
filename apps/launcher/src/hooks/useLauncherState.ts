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
import { useDynamicAccent } from "../utils/dynamicAccent"
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
  const [screen, setScreen] = useState<LauncherScreen>("login")

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
   * Authoritative Auth Session Lifecycle Subscription & Bootstrap
   */
  useEffect(() => {
    const unsubscribe = authService.subscribe((session, status) => {
      if (status === "AUTHENTICATED" && session?.user?.role === "PLAYER") {
        setScreen("home")
        setUsername(session.user.displayName || session.user.email.split("@")[0] || "Jugador")
      } else if (status === "UNAUTHENTICATED") {
        setScreen("login")
        setPlayerSkin(null)
        setPlayerCapes([])
      }
    })

    authService.bootstrap().catch(() => {})

    return () => {
      unsubscribe()
    }
  }, [])

  /**
   * Loads public catalogs (skins & capes)
   * Failures are isolated: catalog failures preserve existing catalog state.
   */
  const loadGlobalCatalog = useCallback(async () => {
    try {
      const [globalsRes, gCapesRes] = await Promise.allSettled([
        fetchGlobalSkins(),
        fetchGlobalCapes(),
      ])
      if (globalsRes.status === "fulfilled" && Array.isArray(globalsRes.value)) {
        setGlobalSkins(globalsRes.value)
      }
      if (gCapesRes.status === "fulfilled" && Array.isArray(gCapesRes.value)) {
        setGlobalCapes(gCapesRes.value)
      }
    } catch (_) {}
  }, [])

  /**
   * Refreshes the authenticated player's personal custom skin and active selection
   * Network errors preserve existing custom skin data and do not wipe to null.
   */
  const refreshPlayerSkin = useCallback(async () => {
    if (!authService.getAccessToken()) {
      setPlayerSkin(null)
      return
    }
    try {
      setSkinsLoading(true)
      const [mineRes, activeRes] = await Promise.allSettled([
        fetchMyPlayerSkin(),
        fetchMyActiveSkin(),
      ])

      if (mineRes.status === "fulfilled") {
        // Legitimate null (player has no custom skin) or player skin object
        setPlayerSkin(mineRes.value)
      }
      if (activeRes.status === "fulfilled" && activeRes.value) {
        const active = activeRes.value
        if (active.type === "CUSTOM") {
          setAppliedSkin("player-custom")
        } else if (active.type === "GLOBAL" && active.skinId) {
          setAppliedSkin(active.skinId)
        }
      } else if (mineRes.status === "fulfilled" && mineRes.value) {
        setAppliedSkin("player-custom")
      }

      if (mineRes.status === "rejected") {
        setSkinsError(mineRes.reason?.message || "No se pudo sincronizar la skin del jugador.")
      } else {
        setSkinsError(null)
      }
    } catch (err: any) {
      setSkinsError(err?.message || "No se pudo sincronizar la skin del jugador.")
    } finally {
      setSkinsLoading(false)
    }
  }, [])

  /**
   * Refreshes the authenticated player's capes collection and active cape selection
   * Network errors preserve existing capes data.
   */
  const refreshPlayerCapes = useCallback(async () => {
    if (!authService.getAccessToken()) {
      setPlayerCapes([])
      setAppliedCape("none")
      return
    }
    try {
      setCapesLoading(true)
      const [mineRes, activeRes] = await Promise.allSettled([
        fetchMyPlayerCapes(),
        fetchMyActiveCape(),
      ])

      if (mineRes.status === "fulfilled" && Array.isArray(mineRes.value)) {
        setPlayerCapes(mineRes.value)
      }
      if (activeRes.status === "fulfilled" && activeRes.value) {
        const active = activeRes.value
        if (active.type === "NONE") {
          setAppliedCape("none")
        } else if (active.type === "CUSTOM" && active.playerCapeId) {
          setAppliedCape(active.playerCapeId)
        } else if (active.type === "GLOBAL" && active.capeId) {
          setAppliedCape(active.capeId)
        }
      }

      if (mineRes.status === "rejected") {
        setCapesError(mineRes.reason?.message || "No se pudo sincronizar las capas.")
      } else {
        setCapesError(null)
      }
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
      if (!authService.getAccessToken()) return

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
      if (!authService.getAccessToken()) return

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
    if (authService.getAccessToken()) {
      refreshPlayerSkin()
      refreshPlayerCapes()
    }
  }, [loadGlobalCatalog, refreshPlayerSkin, refreshPlayerCapes])

  // Refresh catalogs & player cosmetics on entry to "skins" view
  useEffect(() => {
    if (view === "skins") {
      loadGlobalCatalog()
      if (authService.getAccessToken()) {
        refreshPlayerSkin()
        refreshPlayerCapes()
      }
    }
  }, [view, loadGlobalCatalog, refreshPlayerSkin, refreshPlayerCapes])

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
    if (appliedSkin === "player-custom") {
      if (playerSkin) {
        return {
          id: "player-custom",
          name: "Mi Skin",
          badge: "CUSTOM" as const,
          accent: "#38bdf8",
          customImgUrl: playerSkin.imageUrl,
          skinUrl: playerSkin.imageUrl,
        }
      }
      return {
        id: "player-custom",
        name: "Mi Skin",
        badge: "CUSTOM" as const,
        accent: "#38bdf8",
        customImgUrl: undefined,
        skinUrl: undefined,
      }
    }
    const found = allSkins.find((s) => s.id === appliedSkin)
    return found || allSkins[0] || DEFAULT_SKINS[0]
  }, [allSkins, appliedSkin, playerSkin])

  const activeSkinTexture =
    activeSkinData?.customImgUrl || activeSkinData?.skinUrl
  const activeSkinFallback =
    activeSkinData?.accent || activeSkinData?.shirt || "#38bdf8"
  const activeSkinAccent = useDynamicAccent(
    activeSkinTexture,
    activeSkinFallback,
  )

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
