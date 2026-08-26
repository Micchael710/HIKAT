import { useState, useEffect, useCallback } from "react"

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

import { fetchGlobalSkins, fetchMyPlayerSkin } from "../services/skinService"

export function useLauncherState() {
  const [screen, setScreen] = useState<LauncherScreen>("login")

  const [username, setUsername] = useState("Jugador")

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

  /* Skins and capes */

  const [appliedSkin, setAppliedSkin] = useState("none")

  const [appliedCape, setAppliedCape] = useState("none")

  const [globalSkins, setGlobalSkins] = useState<GlobalSkin[]>([])

  const [playerSkin, setPlayerSkin] = useState<PlayerSkin | null>(null)

  const [customSkins, setCustomSkins] = useState<SkinItem[]>([])

  const [customCapes, setCustomCapes] = useState<CapeItem[]>([])

  const loadSkins = useCallback(async () => {
    try {
      const [globals, mine] = await Promise.all([
        fetchGlobalSkins(),

        fetchMyPlayerSkin(),
      ])

      setGlobalSkins(globals)

      setPlayerSkin(mine)
    } catch {
      // Graceful offline fallback
    }
  }, [])

  useEffect(() => {
    loadSkins()
  }, [loadSkins])

  // Build combined skin list

  const computedSkins: SkinItem[] = []

  if (playerSkin) {
    computedSkins.push({
      id: "player-custom",

      name: "Mi Skin",

      badge: "CUSTOM",

      accent: "#38bdf8",

      customImgUrl: playerSkin.imageUrl,

      skinUrl: playerSkin.imageUrl,

      model: playerSkin.model.toLowerCase() as any,
    })
  }

  for (const gs of globalSkins) {
    computedSkins.push({
      id: gs.id,

      name: gs.name,

      badge: "OFFICIAL",

      accent: "#6366f1",

      customImgUrl: gs.imageUrl,

      skinUrl: gs.imageUrl,

      model: gs.model.toLowerCase() as any,
    })
  }

  for (const cs of customSkins) {
    if (!computedSkins.some((s) => s.id === cs.id)) {
      computedSkins.push(cs)
    }
  }

  const allSkins = [...computedSkins, ...DEFAULT_SKINS]

  const activeSkinData =
    allSkins.find((s) => s.id === appliedSkin) ?? allSkins[0]

  const activeSkinAccent = hexToRGB(
    activeSkinData?.accent || activeSkinData?.shirt || "#38bdf8",
  )

  /* Dynamic Responsive Window Scaling (Supports Min Window Size & Fullscreen) */

  const [scale, setScale] = useState(() => {
    if (typeof window === "undefined") return 1

    const width = Math.max(window.innerWidth, MIN_WINDOW_W)

    return width / CANVAS_W
  })

  useEffect(() => {
    const handleResize = () => {
      const currentW = window.innerWidth

      const currentH = window.innerHeight

      // Calculate responsive scale factor

      const s = Math.max(currentW, MIN_WINDOW_W) / CANVAS_W

      setScale(s)
    }

    handleResize()

    window.addEventListener("resize", handleResize)

    return () => window.removeEventListener("resize", handleResize)
  }, [])

  const handleLogin = (name: string) => {
    setUsername(name)

    setScreen("home")

    setView("home")
  }

  const handleLogout = () => {
    setScreen("login")

    setView("home")
  }

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

    setAppliedSkin,

    appliedCape,

    setAppliedCape,

    customSkins,

    setCustomSkins,

    customCapes,

    setCustomCapes,

    allSkins,

    activeSkinData,

    activeSkinAccent,

    scale,

    handleLogin,

    handleLogout,
  }
}
