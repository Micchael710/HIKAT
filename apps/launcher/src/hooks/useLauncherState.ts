import { useState, useEffect, useCallback, useMemo, useRef } from "react"
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
  fetchPlayerActiveSkinPreview,
  fetchCosmeticsSnapshot,
  type PlayerActiveSkinPreview,
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
import { serverService, LauncherServer, LauncherReleaseSummary } from "../services/serverService"
import { gameService, ReleaseActivatedEvent } from "../services/gameService"
import { getStoredBoolean, STORAGE_KEYS, SETTINGS_CHANGED_EVENT } from "../utils/settingsStorage"
import type { PublishedModpack } from "../vite-env"

export type LauncherGameState = {
  releaseSummary?: LauncherReleaseSummary | null
  publishedModpack: PublishedModpack | null
  installedVersion: string | null
  integrityDirty: boolean
}

export function useLauncherState() {
  const [screen, setScreen] = useState<LauncherScreen>("login")

  const [username, setUsername] = useState<string>(() => {
    if (typeof window !== "undefined") {
      const cached = authService.getCachedUser()
      if (cached?.displayName && cached.displayName.trim()) {
        return cached.displayName.trim()
      }
    }
    return ""
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

  /* Multi-Server Catalog State */
  const [servers, setServers] = useState<LauncherServer[]>([])
  const [gameStates, setGameStates] = useState<Record<string, LauncherGameState>>({})
  const gameStatesRef = useRef<Record<string, LauncherGameState>>({})
  useEffect(() => {
    gameStatesRef.current = gameStates
  }, [gameStates])

  const serversRef = useRef<LauncherServer[]>([])
  useEffect(() => {
    serversRef.current = servers
  }, [servers])

  const triggerAutoUpdateIfNeeded = useCallback(
    async (
      serverId: string,
      published: PublishedModpack,
      installedVer: string | null,
      serverName?: string,
    ) => {
      const autoUpdatesEnabled = getStoredBoolean(STORAGE_KEYS.AUTO_UPDATES, true)
      if (!autoUpdatesEnabled) return
      if (!installedVer) return // No existing installation: do not auto-install fresh game
      if (published.version === installedVer) return
      if (!Array.isArray(published.clientFiles)) return

      try {
        const launchStatus = await window.electronAPI?.getLaunchStatus?.({ gameId: serverId })
        const isSameActive =
          launchStatus?.activeOperationGameId === serverId &&
          launchStatus?.activeOperationState !== "IDLE"
        if (isSameActive) {
          // If the same server is currently active/recovering, do not interrupt; wait for IDLE
          return
        }

        const targetName = serverName || serversRef.current.find((s) => s.id === serverId)?.name
        if (!targetName) return

        await gameService.startSync(
          published.clientFiles,
          published.version,
          published.minecraftVersion,
          published.modLoader,
          published.modLoaderVersion,
          published.neoForgeVersion,
          false,
          published.directoryPolicies || [],
          { gameId: serverId, gameName: targetName },
        )
      } catch (_) {}
    },
    [],
  )

  const [selectedGameId, setSelectedGameIdState] = useState<string | null>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("hikat_selected_game_id")
      if (saved) return saved
    }
    return null
  })

  const setSelectedGameId = useCallback((id: string | null) => {
    setSelectedGameIdState(id)
    try {
      if (id) {
        localStorage.setItem("hikat_selected_game_id", id)
      } else {
        localStorage.removeItem("hikat_selected_game_id")
      }
    } catch (_) {}
  }, [])

  const loadServers = useCallback(async () => {
    try {
      const list = await serverService.getLauncherServers()
      if (list.length > 0) {
        const existingStates = gameStatesRef.current
        const serversToFetch = list.filter((server) => !existingStates[server.id])

        if (serversToFetch.length > 0) {
          const autoUpdatesEnabled = getStoredBoolean(STORAGE_KEYS.AUTO_UPDATES, true)
          const entries = await Promise.all(
            serversToFetch.map(async (server) => {
              const installedState = window.electronAPI?.getInstalledState
                ? await window.electronAPI
                    .getInstalledState({ gameId: server.id, gameName: server.name })
                    .catch(() => null)
                : null
              const installedVersion = installedState?.installedModpackVersion ?? null
              const integrityDirty = Boolean(installedState?.integrityDirty)
              let releaseSummary: LauncherReleaseSummary | null = null
              let publishedModpack: PublishedModpack | null = null

              if (server.activeRelease !== undefined) {
                // Modern lightweight bootstrap: NO getPublishedModpack() call!
                releaseSummary = server.activeRelease
              } else {
                // Legacy mock fallback when activeRelease was not provided in server object
                const full = await gameService.getPublishedModpack(server.id).catch(() => null)
                if (full) {
                  publishedModpack = full
                  releaseSummary = {
                    version: full.version,
                    minecraftVersion: full.minecraftVersion,
                    modLoader: (full.modLoader as any) || "NEOFORGE",
                    modLoaderVersion: full.modLoaderVersion ?? null,
                    notes: full.notes ?? null,
                  }
                }
              }

              return [
                server.id,
                {
                  releaseSummary,
                  publishedModpack,
                  installedVersion,
                  integrityDirty,
                },
              ] as const
            }),
          )

          setGameStates((prev) => {
            const next = { ...prev }
            for (const [id, state] of entries) {
              next[id] = {
                releaseSummary: state.releaseSummary,
                publishedModpack: prev[id]?.publishedModpack ?? state.publishedModpack,
                installedVersion: state.installedVersion,
                integrityDirty: prev[id]?.integrityDirty ?? state.integrityDirty,
              }
            }
            return next
          })

          // Bootstrap auto-update check ONLY for servers with pending update and AUTO_UPDATES is ON
          if (autoUpdatesEnabled) {
            for (const server of list) {
              const state = entries.find(([id]) => id === server.id)?.[1] || existingStates[server.id]
              const pubVersion = server.activeRelease?.version || state?.releaseSummary?.version || state?.publishedModpack?.version
              if (pubVersion && state?.installedVersion && pubVersion !== state.installedVersion) {
                let fullModpack = state?.publishedModpack
                if (!fullModpack) {
                  fullModpack = await gameService.getPublishedModpack(server.id).catch(() => null)
                }
                if (fullModpack) {
                  setGameStates((prev) => ({
                    ...prev,
                    [server.id]: {
                      ...prev[server.id],
                      publishedModpack: fullModpack,
                    },
                  }))
                  void triggerAutoUpdateIfNeeded(server.id, fullModpack, state.installedVersion, server.name)
                }
              }
            }
          }
        }

        setServers(list)

        setSelectedGameIdState((current) => {
          if (current && list.some((s) => s.id === current)) {
            return current
          }
          const fallbackId = list[0].id
          try {
            localStorage.setItem("hikat_selected_game_id", fallbackId)
          } catch (_) {}
          return fallbackId
        })
      } else {
        setServers([])
        setSelectedGameIdState(null)
        try {
          localStorage.removeItem("hikat_selected_game_id")
        } catch (_) {}
      }
      return list
    } catch (_) {
      return []
    }
  }, [triggerAutoUpdateIfNeeded])

  const [lastReleaseEvent, setLastReleaseEvent] = useState<ReleaseActivatedEvent | null>(null)

  useEffect(() => {
    loadServers()
  }, [loadServers])

  /* Skins Domain State */
  const [appliedSkin, setAppliedSkin] = useState<string>("player-custom")
  const [globalSkins, setGlobalSkins] = useState<GlobalSkin[]>([])
  const [playerSkin, setPlayerSkin] = useState<PlayerSkin | null>(null)
  const [activeSkinPreview, setActiveSkinPreview] = useState<PlayerActiveSkinPreview | null>(null)
  const cosmeticsLoadedRef = useRef(false)
  const isCosmeticsRefreshingRef = useRef(false)
  const [skinsLoading, setSkinsLoading] = useState<boolean>(false)
  const [skinsError, setSkinsError] = useState<string | null>(null)

  /* Capes Domain State */
  const [appliedCape, setAppliedCape] = useState<string>("none")
  const [globalCapes, setGlobalCapes] = useState<GlobalCape[]>([])
  const [playerCapes, setPlayerCapes] = useState<PlayerCape[]>([])
  const [capesLoading, setCapesLoading] = useState<boolean>(false)
  const [capesError, setCapesError] = useState<string | null>(null)

  const refreshCosmeticsSnapshot = useCallback(async () => {
    if (isCosmeticsRefreshingRef.current) return
    isCosmeticsRefreshingRef.current = true
    try {
      setSkinsLoading(true)
      setCapesLoading(true)
      const snapshot = await fetchCosmeticsSnapshot()
      setGlobalSkins(snapshot.globalSkins)
      setGlobalCapes(snapshot.globalCapes)
      setPlayerSkin(snapshot.playerSkin)
      setPlayerCapes(snapshot.playerCapes)

      if (snapshot.activeSkin) {
        if (snapshot.activeSkin.type === "CUSTOM") {
          setAppliedSkin("player-custom")
        } else if (snapshot.activeSkin.type === "GLOBAL" && snapshot.activeSkin.skinId) {
          setAppliedSkin(snapshot.activeSkin.skinId)
        }
        setActiveSkinPreview({
          type: snapshot.activeSkin.type,
          skinId: snapshot.activeSkin.skinId,
          imageUrl: snapshot.activeSkin.imageUrl || snapshot.activeSkin.skin?.imageUrl || snapshot.activeSkin.playerSkin?.imageUrl || "",
          name: snapshot.activeSkin.name || snapshot.activeSkin.skin?.name || null,
        })
      }

      if (snapshot.activeCape) {
        if (snapshot.activeCape.type === "NONE") {
          setAppliedCape("none")
        } else if (snapshot.activeCape.type === "CUSTOM" && snapshot.activeCape.playerCapeId) {
          setAppliedCape(snapshot.activeCape.playerCapeId)
        } else if (snapshot.activeCape.type === "GLOBAL" && snapshot.activeCape.capeId) {
          setAppliedCape(snapshot.activeCape.capeId)
        }
      }

      setSkinsError(null)
      setCapesError(null)
      cosmeticsLoadedRef.current = true
    } catch (err: any) {
      setSkinsError(err?.message || "No se pudo sincronizar cosméticos.")
    } finally {
      setSkinsLoading(false)
      setCapesLoading(false)
      isCosmeticsRefreshingRef.current = false
    }
  }, [])

  const loadPlayerActiveSkinPreview = useCallback(async () => {
    if (!authService.getAccessToken()) {
      setActiveSkinPreview(null)
      return
    }
    try {
      const preview = await fetchPlayerActiveSkinPreview()
      if (preview) {
        setActiveSkinPreview(preview)
        if (preview.type === "CUSTOM") {
          setAppliedSkin("player-custom")
        } else if (preview.type === "GLOBAL" && preview.skinId) {
          setAppliedSkin(preview.skinId)
        }
      }
    } catch (_) {}
  }, [])

  // Listen for settings change: when AUTO_UPDATES is turned ON, re-evaluate all known servers
  useEffect(() => {
    const handleSettingsChange = (e: Event) => {
      const customEvent = e as CustomEvent<{ key: string; value: any }>
      if (!customEvent.detail || customEvent.detail.key !== STORAGE_KEYS.AUTO_UPDATES) {
        return
      }
      if (!Boolean(customEvent.detail.value)) {
        return
      }

      const currentStates = gameStatesRef.current
      for (const server of serversRef.current) {
        const state = currentStates[server.id]
        const pubVer = server.activeRelease?.version || state?.releaseSummary?.version || state?.publishedModpack?.version
        if (pubVer && state?.installedVersion && pubVer !== state.installedVersion) {
          void gameService.getPublishedModpack(server.id).then((fullModpack) => {
            if (fullModpack) {
              setGameStates((prev) => ({
                ...prev,
                [server.id]: {
                  ...prev[server.id],
                  publishedModpack: fullModpack,
                },
              }))
              void triggerAutoUpdateIfNeeded(server.id, fullModpack, state.installedVersion, server.name)
            }
          }).catch(() => {})
        }
      }
    }

    window.addEventListener(SETTINGS_CHANGED_EVENT, handleSettingsChange)
    return () => {
      window.removeEventListener(SETTINGS_CHANGED_EVENT, handleSettingsChange)
    }
  }, [triggerAutoUpdateIfNeeded])

  useEffect(() => {
    if (screen === "login") {
      return
    }

    const unsubscribe = gameService.subscribeReleaseEvents((event) => {
      if (event.type === "RELEASE_ACTIVATED") {
        setLastReleaseEvent(event)
        if (event.serverId) {
          const isKnown = serversRef.current.some((s) => s.id === event.serverId)
          if (!isKnown) {
            void loadServers()
            return
          }

          const currentStates = gameStatesRef.current
          const serverState = currentStates[event.serverId]
          const knownPublishedVersion =
            serverState?.releaseSummary?.version ||
            serverState?.publishedModpack?.version ||
            serversRef.current.find((s) => s.id === event.serverId)?.activeRelease?.version

          // 1. If event.version === knownPublishedVersion: do NOT do unnecessary GraphQL query!
          if (knownPublishedVersion && event.version === knownPublishedVersion) {
            return
          }

          // 2. New version: update lightweight summary immediately in memory
          const newSummary: LauncherReleaseSummary = {
            version: event.version,
            minecraftVersion: event.minecraftVersion,
            modLoader: event.modLoader || "NEOFORGE",
            modLoaderVersion: event.modLoaderVersion || null,
            notes: null,
          }

          const installedVer = serverState?.installedVersion ?? null
          const autoUpdatesEnabled = getStoredBoolean(STORAGE_KEYS.AUTO_UPDATES, true)

          setGameStates((prev) => {
            const cur = prev[event.serverId!]
            return {
              ...prev,
              [event.serverId!]: {
                releaseSummary: newSummary,
                publishedModpack: null,
                installedVersion: cur?.installedVersion ?? null,
                integrityDirty: cur?.integrityDirty ?? false,
              },
            }
          })

          // 3. Auto-update check: only if enabled and installedVer exists and differs
          if (autoUpdatesEnabled && installedVer && event.version !== installedVer) {
            void gameService
              .getPublishedModpack(event.serverId)
              .then((published) => {
                if (!published) return
                setGameStates((prev) => ({
                  ...prev,
                  [event.serverId!]: {
                    ...prev[event.serverId!],
                    publishedModpack: published,
                  },
                }))
                void triggerAutoUpdateIfNeeded(event.serverId!, published, installedVer)
              })
              .catch(() => {})
          }
        } else {
          void loadServers()
        }
        return
      }

      if (event.type === "SERVER_UPDATED") {
        void loadServers()
        return
      }

      if (event.type === "COSMETICS_UPDATED") {
        void refreshCosmeticsSnapshot()
        return
      }
    })

    return unsubscribe
  }, [screen, loadServers, triggerAutoUpdateIfNeeded, refreshCosmeticsSnapshot])

  // Global listener for phase changes (updates installed state upon completion of any operation)
  useEffect(() => {
    const unsubPhase = window.electronAPI?.onPhaseChange?.((phase: string, eventGameId?: string | null) => {
      if (phase === "IDLE" && eventGameId) {
        const targetServer = serversRef.current.find((s) => s.id === eventGameId)
        const gameName = targetServer?.name
        if (window.electronAPI?.getInstalledState) {
          window.electronAPI
            .getInstalledState({ gameId: eventGameId, gameName })
            .then((installedState: { installedModpackVersion: string | null; integrityDirty?: boolean } | null | undefined) => {
              if (!installedState) return
              const installedVersion = installedState.installedModpackVersion ?? null
              const integrityDirty = Boolean(installedState.integrityDirty)
              setGameStates((prev) => {
                const current = prev[eventGameId]
                const pub = current?.publishedModpack
                if (pub && installedVersion && pub.version !== installedVersion) {
                  void triggerAutoUpdateIfNeeded(eventGameId, pub, installedVersion)
                }
                return {
                  ...prev,
                  [eventGameId]: {
                    publishedModpack: pub ?? null,
                    installedVersion,
                    integrityDirty,
                  },
                }
              })
            })
            .catch(() => {})
        }
      }
    })
    return () => unsubPhase?.()
  }, [triggerAutoUpdateIfNeeded])

  // Global listener for file integrity changes across any server
  useEffect(() => {
    const unsub = window.electronAPI?.onGameFileIntegrityChanged?.((data: any) => {
      const gId = data?.gameId
      if (gId) {
        setGameStates((prev) => {
          const current = prev[gId]
          if (!current) {
            return {
              ...prev,
              [gId]: {
                publishedModpack: null,
                installedVersion: null,
                integrityDirty: true,
              },
            }
          }
          return {
            ...prev,
            [gId]: {
              ...current,
              integrityDirty: true,
            },
          }
        })
      }
    })
    return () => unsub?.()
  }, [])

  const updateInstalledVersion = useCallback((gameId: string, version: string | null) => {
    setGameStates((prev) => {
      const current = prev[gameId]
      if (!current) return prev
      return {
        ...prev,
        [gameId]: {
          ...current,
          installedVersion: version,
          integrityDirty: false,
        },
      }
    })
  }, [])

  const clearIntegrityDirty = useCallback((gameId: string) => {
    setGameStates((prev) => {
      const current = prev[gameId]
      if (!current) return prev
      return {
        ...prev,
        [gameId]: {
          ...current,
          integrityDirty: false,
        },
      }
    })
  }, [])

  useEffect(() => {
    const handleActionStatus = (e: Event) => {
      const detail = (e as CustomEvent)?.detail
      if (detail?.action === "uninstall" && detail?.state === "finished" && detail?.success && detail?.gameId) {
        updateInstalledVersion(detail.gameId, null)
      }
    }
    window.addEventListener("hikat:game-action-status", handleActionStatus)
    return () => window.removeEventListener("hikat:game-action-status", handleActionStatus)
  }, [updateInstalledVersion])

  // Computed selected server
  const selectedServer = useMemo(() => {
    if (servers.length === 0) return null
    if (selectedGameId) {
      const found = servers.find((s) => s.id === selectedGameId)
      if (found) return found
    }
    return servers[0] || null
  }, [servers, selectedGameId])

  const [pendingAuthDeepLink, setPendingAuthDeepLink] = useState<string | null>(null)
  const pendingAuthActionRef = useRef<boolean>(false)


  /**
   * Authoritative Auth Session Lifecycle Subscription & Bootstrap
   */
  useEffect(() => {
    let isMounted = true

    const checkColdStartAndBootstrap = async () => {
      if (typeof window !== "undefined" && window.electronAPI?.getPendingOAuthCallback) {
        try {
          const pendingUrl = await window.electronAPI.getPendingOAuthCallback()
          if (pendingUrl && isMounted) {
            try {
              const urlObj = new URL(pendingUrl)
              if (urlObj.protocol === "hikat:") {
                const host = urlObj.hostname || urlObj.host
                if (host === "auth") {
                  const cleanPath = urlObj.pathname.replace(/\/+$/, "")
                  if (cleanPath === "/verify-email" || cleanPath === "/reset-password") {
                    pendingAuthActionRef.current = true
                    setPendingAuthDeepLink(pendingUrl)
                    setScreen("login")
                  } else {
                    setPendingAuthDeepLink(pendingUrl)
                  }
                }
              }
            } catch (_) {
              setPendingAuthDeepLink(pendingUrl)
            }
          }
        } catch (_) {}
      }

      await authService.bootstrap().catch(() => {})
    }

    const unsubscribe = authService.subscribe((session, status) => {
      if (!isMounted) return
      if (status === "AUTHENTICATED" && session?.user && (session.user.role === "PLAYER" || session.user.role === "ADMIN")) {
        const hasValidDisplayName = Boolean(session.user.displayName && session.user.displayName.trim())
        if (hasValidDisplayName) {
          if (!pendingAuthActionRef.current) {
            setScreen("home")
          }
          setUsername(session.user.displayName!.trim())
        } else {
          // Incomplete OAuth account without chosen username must complete onboarding
          setScreen("login")
          setUsername("")
        }
      } else if (status === "UNAUTHENTICATED") {
        setScreen("login")
        setPlayerSkin(null)
        setPlayerCapes([])
        setActiveSkinPreview(null)
        cosmeticsLoadedRef.current = false
      }
    })

    checkColdStartAndBootstrap()

    return () => {
      isMounted = false
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

  // Automatically refresh player skin preview when transitioning to home with active session
  useEffect(() => {
    if (
      screen === "home" &&
      authService.getAccessToken()
    ) {
      void loadPlayerActiveSkinPreview()
    }
  }, [screen, loadPlayerActiveSkinPreview])

  // Refresh complete cosmetics snapshot on first entry to "skins" view
  useEffect(() => {
    if (view === "skins") {
      if (!cosmeticsLoadedRef.current) {
        void refreshCosmeticsSnapshot()
      }
    }
  }, [view, refreshCosmeticsSnapshot])

  /**
   * Unified derived skins list (No model interpretation)
   */
  const allSkins = useMemo<SkinItem[]>(() => {
    const items: SkinItem[] = []

    if (playerSkin) {
      items.push({
        id: "player-custom",
        name: "",
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
          name: "",
          badge: "CUSTOM" as const,
          accent: "#38bdf8",
          customImgUrl: playerSkin.imageUrl,
          skinUrl: playerSkin.imageUrl,
        }
      }
      if (activeSkinPreview?.imageUrl) {
        return {
          id: "player-custom",
          name: activeSkinPreview.name || "",
          badge: (activeSkinPreview.type === "CUSTOM" ? "CUSTOM" : "OFFICIAL") as any,
          accent: activeSkinPreview.type === "CUSTOM" ? "#38bdf8" : "#6366f1",
          customImgUrl: activeSkinPreview.imageUrl,
          skinUrl: activeSkinPreview.imageUrl,
        }
      }
      return {
        id: "player-custom",
        name: "",
        badge: "CUSTOM" as const,
        accent: "#38bdf8",
        customImgUrl: undefined,
        skinUrl: undefined,
      }
    }
    const found = allSkins.find((s) => s.id === appliedSkin)
    if (found) return found
    if (activeSkinPreview?.imageUrl) {
      return {
        id: activeSkinPreview.skinId || appliedSkin,
        name: activeSkinPreview.name || "",
        badge: (activeSkinPreview.type === "CUSTOM" ? "CUSTOM" : "OFFICIAL") as any,
        accent: activeSkinPreview.type === "CUSTOM" ? "#38bdf8" : "#6366f1",
        customImgUrl: activeSkinPreview.imageUrl,
        skinUrl: activeSkinPreview.imageUrl,
      }
    }
    return allSkins[0] || DEFAULT_SKINS[0]
  }, [allSkins, appliedSkin, playerSkin, activeSkinPreview])

  const activeSkinTexture =
    activeSkinData?.customImgUrl || activeSkinData?.skinUrl
  const activeSkinFallback =
    activeSkinData?.accent || (activeSkinData as any)?.shirt || "#38bdf8"
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
        name: "",
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
  }, [])

  /**
   * Handle user logout cleanly
   */
  const handleLogout = useCallback(() => {
    authService.logout()
    setPlayerSkin(null)
    setPlayerCapes([])
    setActiveSkinPreview(null)
    cosmeticsLoadedRef.current = false
    setUsername("")
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
    pendingAuthDeepLink,
    setPendingAuthDeepLink,
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
    servers,
    selectedGameId,
    setSelectedGameId,
    selectedServer,
    refreshServers: loadServers,
    lastReleaseEvent,
    gameStates,
    updateInstalledVersion,
    clearIntegrityDirty,
    refreshCosmeticsSnapshot,
  }
}
