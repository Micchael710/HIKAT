import React, { useState, useEffect, useRef } from "react"
import type {
  ModProvider,
  ModProjectDetail,
  ModInstallationPlan,
  ServerContentInstallationPlan,
  ModVersionOverrideInput,
  ContentType,
  ModEnvironment,
  ThemeMode,
  QueuedModSelection,
  QueuedServerContentSelection,
  GameModLoader,
  GameHandoffPayload,
} from "../../../types"
import { graphqlClient } from "../../../services/graphqlClient"
import { getThemeTokens } from "../../../theme/tokens"
import { IconBox, IconSpinner, IconAlertCircle } from "../../../theme/icons"

interface NavStackItem {
  provider: ModProvider
  projectId: string
  contentType?: ContentType
  selectedVersionId: string
  manualOverrides: Record<string, string>
  selectedEnvironmentOverride: ModEnvironment | null
}

interface ModDetailModalProps {
  serverId: string
  provider: ModProvider
  projectId: string
  contentType?: ContentType
  initialVersionId?: string
  initialEnvironmentOverride?: ModEnvironment
  onClose: () => void
  onSuccess: () => void
  theme?: ThemeMode
  mode?: "RELEASE" | "SERVER"
  loaderOverride?: GameModLoader | null
  onQueueMod?: (item: QueuedModSelection) => void
  onQueueServerMod?: (item: QueuedServerContentSelection) => void
  onNavigateToGame?: (handoff: GameHandoffPayload) => void
}

export const ModDetailModal: React.FC<ModDetailModalProps> = ({
  serverId,
  provider,
  projectId,
  contentType = "MOD",
  initialVersionId,
  initialEnvironmentOverride,
  onClose,
  onSuccess,
  theme = "dark",
  mode = "RELEASE",
  loaderOverride,
  onQueueMod,
  onQueueServerMod,
  onNavigateToGame,
}) => {
  const isDark = theme === "dark"
  const tokens = getThemeTokens(theme)
  const isServer = mode === "SERVER"

  // Navigation Stack for clickable dependencies
  const [navStack, setNavStack] = useState<NavStackItem[]>([])
  const [activeItem, setActiveItem] = useState<{
    provider: ModProvider
    projectId: string
    contentType: ContentType
  }>({
    provider,
    projectId,
    contentType,
  })

  useEffect(() => {
    if (navStack.length === 0) {
      setActiveItem({ provider, projectId, contentType })
    }
  }, [provider, projectId, contentType, navStack.length])

  const currentProvider = activeItem.provider
  const currentProjectId = activeItem.projectId
  const currentContentType = activeItem.contentType || "MOD"

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<ModProjectDetail | null>(null)
  const [selectedVersionId, setSelectedVersionId] = useState<string>("")
  const [selectedEnvironmentOverride, setSelectedEnvironmentOverride] = useState<ModEnvironment | null>(
    initialEnvironmentOverride || null,
  )
  const [manualMode, setManualMode] = useState(false)
  const [manualOverrides, setManualOverrides] = useState<Record<string, string>>({})
  const [releasePlan, setReleasePlan] = useState<ModInstallationPlan | null>(null)
  const [serverPlan, setServerPlan] = useState<ServerContentInstallationPlan | null>(null)
  const [resolvingPlan, setResolvingPlan] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [queuedOptionalIds, setQueuedOptionalIds] = useState<Set<string>>(new Set())

  const isCurseForgeModUnknown =
    currentProvider === "CURSEFORGE" &&
    currentContentType === "MOD" &&
    (detail?.environment === "UNKNOWN" || !detail?.environment)

  const isBothEnvironment =
    isServer &&
    currentContentType === "MOD" &&
    (detail?.environment === "BOTH" || selectedEnvironmentOverride === "BOTH")

  // 1. Fetch project details whenever active target or loaderOverride changes
  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    setReleasePlan(null)
    setServerPlan(null)

    const fetchPromise = isServer
      ? (loaderOverride
          ? graphqlClient.getServerContentProjectDetail(
              currentProvider,
              currentProjectId,
              currentContentType,
              serverId,
              loaderOverride,
            )
          : graphqlClient.getServerContentProjectDetail(
              currentProvider,
              currentProjectId,
              currentContentType,
              serverId,
            ))
      : (loaderOverride
          ? graphqlClient.getModProjectDetail(
              currentProvider,
              currentProjectId,
              currentContentType,
              serverId,
              loaderOverride,
            )
          : graphqlClient.getModProjectDetail(
              currentProvider,
              currentProjectId,
              currentContentType,
              serverId,
            ))

    fetchPromise
      .then((data) => {
        if (!active) return
        setDetail(data)

        // If restoring from navStack, restore parent's selected version and overrides
        if (pendingRestoreRef.current) {
          const restore = pendingRestoreRef.current
          pendingRestoreRef.current = null
          if (restore.versionId) {
            setSelectedVersionId(restore.versionId)
          } else {
            const stable = data.compatibleVersions.find((v) => v.releaseType === "RELEASE")
            const initialVer = stable || data.compatibleVersions[0]
            setSelectedVersionId(initialVer?.id || initialVer?.fileId || "")
          }
          setManualOverrides(restore.manualOverrides || {})
          setSelectedEnvironmentOverride(restore.environmentOverride)
        } else if (navStack.length === 0 && initialVersionId) {
          const matched = data.compatibleVersions.find(
            (v) => v.id === initialVersionId || v.fileId === initialVersionId,
          )
          if (matched) {
            setSelectedVersionId(matched.id || matched.fileId || initialVersionId)
          } else {
            setSelectedVersionId("")
            setError(
              "La versión seleccionada desde Servidor ya no está disponible o no es compatible con el Mod Loader y versión de Minecraft actuales. Selecciona manualmente una versión compatible para continuar.",
            )
          }
        } else {
          // Preselect latest stable release (or first compatible version)
          const stable = data.compatibleVersions.find((v) => v.releaseType === "RELEASE")
          const initialVer = stable || data.compatibleVersions[0]
          if (initialVer) {
            setSelectedVersionId(initialVer.id || initialVer.fileId || "")
          } else {
            setSelectedVersionId("")
          }
        }
        setLoading(false)
      })
      .catch((err) => {
        if (!active) return
        setError(err.message || "Error al cargar los detalles del contenido")
        setLoading(false)
      })

    return () => {
      active = false
    }
  }, [
    currentProvider,
    currentProjectId,
    currentContentType,
    serverId,
    isServer,
    loaderOverride,
    navStack.length,
    initialVersionId,
  ])

  // 2. Resolve installation plan whenever selected version, environment override, or manual overrides change
  useEffect(() => {
    if (!selectedVersionId) return

    // In Server mode, if item is BOTH, it redirects to Game View and doesn't resolve direct server plan
    if (isBothEnvironment) {
      setServerPlan(null)
      return
    }

    if (isCurseForgeModUnknown && !selectedEnvironmentOverride) {
      setReleasePlan(null)
      setServerPlan(null)
      return
    }

    let active = true
    setResolvingPlan(true)

    if (isServer) {
      graphqlClient
        .resolveServerContentPlan(
          {
            provider: currentProvider,
            projectId: currentProjectId,
            versionId: selectedVersionId,
            contentType: currentContentType,
            environmentOverride: selectedEnvironmentOverride || undefined,
            ...(loaderOverride ? { loaderOverride } : {}),
          },
          serverId,
        )
        .then((resPlan) => {
          if (!active) return
          setServerPlan(resPlan)
          setResolvingPlan(false)
        })
        .catch((err) => {
          if (!active) return
          setError(err.message || "Error al calcular el plan de instalación.")
          setResolvingPlan(false)
        })
    } else {
      const overridesList: ModVersionOverrideInput[] = Object.entries(manualOverrides).map(
        ([key, verId]) => {
          const [p, pid, cType] = key.split(":")
          return {
            provider: p as ModProvider,
            projectId: pid,
            versionId: verId,
            contentType: (cType as any) || undefined,
          }
        },
      )

      graphqlClient
        .resolveModInstallationPlan(
          {
            provider: currentProvider,
            projectId: currentProjectId,
            versionId: selectedVersionId,
            contentType: currentContentType,
            manualOverrides: overridesList.length > 0 ? overridesList : null,
            environmentOverride: isCurseForgeModUnknown ? selectedEnvironmentOverride : undefined,
            ...(loaderOverride ? { loaderOverride } : {}),
          },
          serverId,
        )
        .then((resPlan) => {
          if (!active) return
          setReleasePlan(resPlan)
          setResolvingPlan(false)
        })
        .catch((err) => {
          if (!active) return
          setError(err.message || "Error al calcular el plan de dependencias")
          setResolvingPlan(false)
        })
    }

    return () => {
      active = false
    }
  }, [
    currentProvider,
    currentProjectId,
    currentContentType,
    selectedVersionId,
    manualOverrides,
    isCurseForgeModUnknown,
    selectedEnvironmentOverride,
    serverId,
    isServer,
    loaderOverride,
    isBothEnvironment,
  ])

  const handleInstallRelease = async () => {
    if (!selectedVersionId || !releasePlan || !releasePlan.isValid) return

    const overridesList: ModVersionOverrideInput[] = Object.entries(manualOverrides).map(
      ([key, verId]) => {
        const [p, pid, cType] = key.split(":")
        return {
          provider: p as ModProvider,
          projectId: pid,
          versionId: verId,
          contentType: (cType as any) || undefined,
        }
      },
    )

    try {
      setInstalling(true)
      setError(null)

      await graphqlClient.installModPlan(
        {
          provider: currentProvider,
          projectId: currentProjectId,
          versionId: selectedVersionId,
          contentType: currentContentType,
          manualOverrides: overridesList.length > 0 ? overridesList : null,
          environmentOverride: isCurseForgeModUnknown ? selectedEnvironmentOverride : undefined,
          ...(loaderOverride ? { loaderOverride } : {}),
        },
        serverId,
      )

      onSuccess()
    } catch (err: any) {
      setError(err.message || "Error durante la instalación del contenido")
      setInstalling(false)
    }
  }

  const handleQueue = () => {
    if (!selectedVersionId) return

    const selectedVersion = detail?.compatibleVersions.find(
      (v) => v.id === selectedVersionId || v.fileId === selectedVersionId,
    )
    const versionNumber = selectedVersion?.versionNumber || selectedVersionId

    if (isServer) {
      if (!serverPlan || !serverPlan.isValid || (serverPlan.conflicts?.length ?? 0) > 0) return

      if (onQueueServerMod) {
        onQueueServerMod({
          provider: currentProvider,
          projectId: currentProjectId,
          projectName: detail?.name || currentProjectId,
          versionId: selectedVersionId,
          versionNumber,
          contentType: currentContentType,
          environmentOverride: selectedEnvironmentOverride || undefined,
          loaderOverride: loaderOverride || undefined,
        })
      } else if (onQueueMod) {
        onQueueMod({
          provider: currentProvider,
          projectId: currentProjectId,
          projectName: detail?.name || currentProjectId,
          versionId: selectedVersionId,
          versionNumber,
          contentType: currentContentType,
          environmentOverride: selectedEnvironmentOverride || undefined,
          loaderOverride: loaderOverride || undefined,
        })
      }
      onClose()
    } else {
      if (!releasePlan || !releasePlan.isValid || !onQueueMod) return

      const overridesList: ModVersionOverrideInput[] = Object.entries(manualOverrides).map(
        ([key, verId]) => {
          const [p, pid, cType] = key.split(":")
          return {
            provider: p as ModProvider,
            projectId: pid,
            versionId: verId,
            contentType: (cType as any) || undefined,
          }
        },
      )

      onQueueMod({
        provider: currentProvider,
        projectId: currentProjectId,
        projectName: detail?.name || currentProjectId,
        versionId: selectedVersionId,
        versionNumber,
        contentType: currentContentType,
        manualOverrides: overridesList.length > 0 ? overridesList : null,
        environmentOverride: isCurseForgeModUnknown ? selectedEnvironmentOverride || undefined : undefined,
        loaderOverride: loaderOverride || undefined,
      })
      onClose()
    }
  }

  const pendingRestoreRef = useRef<{
    versionId: string
    manualOverrides: Record<string, string>
    environmentOverride: ModEnvironment | null
  } | null>(null)

  const handleQueueOptional = (opt: {
    provider: ModProvider
    projectId: string
    projectName: string
    versionId: string
    versionNumber?: string
    contentType?: ContentType
  }) => {
    if (!opt.versionId) {
      handleNavigateToDependency(opt.provider, opt.projectId, opt.contentType)
      return
    }

    if (isServer) {
      if (onQueueServerMod) {
        onQueueServerMod({
          provider: opt.provider,
          projectId: opt.projectId,
          projectName: opt.projectName,
          versionId: opt.versionId,
          versionNumber: opt.versionNumber || opt.versionId,
          contentType: opt.contentType || "MOD",
          loaderOverride: loaderOverride || undefined,
        })
      } else if (onQueueMod) {
        onQueueMod({
          provider: opt.provider,
          projectId: opt.projectId,
          projectName: opt.projectName,
          versionId: opt.versionId,
          versionNumber: opt.versionNumber || opt.versionId,
          contentType: opt.contentType || "MOD",
          loaderOverride: loaderOverride || undefined,
        })
      }
    } else {
      if (onQueueMod) {
        onQueueMod({
          provider: opt.provider,
          projectId: opt.projectId,
          projectName: opt.projectName,
          versionId: opt.versionId,
          versionNumber: opt.versionNumber || opt.versionId,
          contentType: opt.contentType || "MOD",
          loaderOverride: loaderOverride || undefined,
        })
      }
    }
    setQueuedOptionalIds((prev) => new Set(prev).add(opt.projectId))
  }

  const handleNavigateToDependency = (
    depProvider: ModProvider,
    depProjectId: string,
    depContentType?: ContentType,
  ) => {
    setNavStack((prev) => [
      ...prev,
      {
        provider: currentProvider,
        projectId: currentProjectId,
        contentType: currentContentType,
        selectedVersionId,
        manualOverrides,
        selectedEnvironmentOverride,
      },
    ])
    setSelectedVersionId("")
    setManualOverrides({})
    setSelectedEnvironmentOverride(null)
    setActiveItem({
      provider: depProvider,
      projectId: depProjectId,
      contentType: depContentType || "MOD",
    })
  }

  const handleNavBack = () => {
    if (navStack.length === 0) return
    const parent = navStack[navStack.length - 1]!
    setNavStack((prev) => prev.slice(0, -1))
    pendingRestoreRef.current = {
      versionId: parent.selectedVersionId,
      manualOverrides: parent.manualOverrides,
      environmentOverride: parent.selectedEnvironmentOverride,
    }
    setActiveItem({
      provider: parent.provider,
      projectId: parent.projectId,
      contentType: parent.contentType || "MOD",
    })
  }

  const isModrinth = currentProvider === "MODRINTH"
  const plan = isServer ? serverPlan : releasePlan

  // Count items to install/update
  const itemsToInstallCount =
    plan?.items.filter((i) => i.action === "INSTALL" || i.action === "UPDATE").length || 1

  const currentMcVersion = detail?.minecraftVersion || "1.21.1"
  const currentLoader =
    loaderOverride || ((detail?.modLoader && detail.modLoader !== "VANILLA") ? detail.modLoader : "")

  return (
    <div
      data-testid="mod-detail-modal"
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.78)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: "20px",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !installing) onClose()
      }}
    >
      <div
        style={{
          backgroundColor: tokens.bgCard,
          border: `1px solid ${tokens.borderSubtle}`,
          borderRadius: "18px",
          width: "100%",
          maxWidth: "840px",
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: tokens.cardShadowLg,
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "18px 24px",
            borderBottom: `1px solid ${tokens.borderSubtle}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: tokens.bgCardInner,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
            {navStack.length > 0 && (
              <button
                type="button"
                data-testid="button-nav-back"
                onClick={handleNavBack}
                style={{
                  background: tokens.bgCardInner,
                  border: `1px solid ${tokens.borderSubtle}`,
                  borderRadius: "8px",
                  color: tokens.textPrimary,
                  padding: "6px 12px",
                  fontSize: "13px",
                  fontWeight: "700",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                }}
              >
                ← Volver
              </button>
            )}

            {detail?.iconUrl ? (
              <img
                src={detail.iconUrl}
                alt={detail.name}
                style={{
                  width: "48px",
                  height: "48px",
                  borderRadius: "10px",
                  objectFit: "cover",
                  background: "rgba(0, 0, 0, 0.2)",
                }}
              />
            ) : (
              <div
                style={{
                  width: "48px",
                  height: "48px",
                  borderRadius: "10px",
                  background: tokens.bgCardInner,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: tokens.textMuted,
                }}
              >
                <IconBox size={24} />
              </div>
            )}

            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                <h3 style={{ margin: 0, fontSize: "17px", fontWeight: "700", color: tokens.textPrimary }}>
                  {detail?.name || "Cargando..."}
                </h3>
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: "700",
                    padding: "2px 8px",
                    borderRadius: "6px",
                    background: isModrinth ? "rgba(16, 185, 129, 0.2)" : "rgba(249, 115, 22, 0.2)",
                    color: isModrinth ? "#10b981" : "#f97316",
                    border: `1px solid ${isModrinth ? "rgba(16, 185, 129, 0.3)" : "rgba(249, 115, 22, 0.3)"}`,
                  }}
                >
                  {currentProvider}
                </span>
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: "600",
                    padding: "2px 8px",
                    borderRadius: "6px",
                    background: "rgba(139, 92, 246, 0.2)",
                    color: "#c084fc",
                    border: "1px solid rgba(139, 92, 246, 0.3)",
                  }}
                >
                  {currentContentType}
                </span>
              </div>
              <div style={{ fontSize: "12px", color: tokens.textSecondary, marginTop: "2px" }}>
                por <span style={{ color: tokens.textPrimary, fontWeight: "600" }}>{detail?.author || "..."}</span>
              </div>
            </div>
          </div>

          <button
            type="button"
            data-testid="button-close-modal"
            onClick={onClose}
            disabled={installing}
            style={{
              background: "transparent",
              border: "none",
              color: tokens.textMuted,
              fontSize: "20px",
              cursor: "pointer",
              padding: "4px 8px",
              borderRadius: "6px",
            }}
          >
            ✕
          </button>
        </div>

        {/* Modal Body */}
        <div style={{ padding: "20px 24px", overflowY: "auto", flex: 1 }} className="custom-scroll">
          {loading ? (
            <div style={{ textAlign: "center", padding: "40px 0", color: tokens.textMuted, display: "flex", flexDirection: "column", alignItems: "center", gap: "10px" }}>
              <IconSpinner size={28} />
              <span>Cargando información y versiones compatibles...</span>
            </div>
          ) : error && !detail ? (
            <div
              style={{
                padding: "16px",
                background: "rgba(239, 68, 68, 0.12)",
                border: "1px solid rgba(239, 68, 68, 0.25)",
                borderRadius: "10px",
                color: "#ef4444",
                fontSize: "14px",
              }}
            >
              {error}
            </div>
          ) : (
            <div>
              {/* Error Notice */}
              {error && (
                <div
                  data-testid="mod-detail-error"
                  style={{
                    padding: "12px 16px",
                    background: "rgba(239, 68, 68, 0.12)",
                    border: "1px solid rgba(239, 68, 68, 0.25)",
                    borderRadius: "8px",
                    color: "#fca5a5",
                    fontSize: "13px",
                    marginBottom: "16px",
                    lineHeight: "1.4",
                  }}
                >
                  {error}
                </div>
              )}

              {/* Summary */}
              <p style={{ margin: "0 0 20px 0", fontSize: "14px", color: "#d1d5db", lineHeight: "1.5" }}>
                {detail?.summary}
              </p>

              {/* CurseForge Environment Selector for UNKNOWN environment MODs */}
              {isCurseForgeModUnknown && (
                <div
                  style={{ marginBottom: "20px" }}
                  data-testid={isServer ? "server-curseforge-environment-selector" : "curseforge-environment-selector"}
                >
                  <label
                    style={{
                      display: "block",
                      fontSize: "13px",
                      fontWeight: "600",
                      color: tokens.textPrimary,
                      marginBottom: "8px",
                    }}
                  >
                    ¿Dónde necesita ejecutarse este mod?
                  </label>
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    {isServer ? (
                      <>
                        {/* SERVER OPTION */}
                        <label
                          data-testid="option-server-env-server"
                          style={{
                            display: "flex",
                            alignItems: "flex-start",
                            gap: "12px",
                            padding: "12px 14px",
                            borderRadius: "12px",
                            border: `1px solid ${
                              selectedEnvironmentOverride === "SERVER" ? "#3ec4c0" : tokens.borderSubtle
                            }`,
                            backgroundColor:
                              selectedEnvironmentOverride === "SERVER"
                                ? isDark
                                  ? "rgba(62, 196, 192, 0.1)"
                                  : "rgba(62, 196, 192, 0.06)"
                                : tokens.bgCardInner,
                            cursor: "pointer",
                            transition: "all 0.15s ease",
                          }}
                        >
                          <input
                            type="radio"
                            name="curseforge-env-server"
                            value="SERVER"
                            checked={selectedEnvironmentOverride === "SERVER"}
                            onChange={() => setSelectedEnvironmentOverride("SERVER")}
                            disabled={installing}
                            style={{ marginTop: "3px", accentColor: "#3ec4c0" }}
                          />
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: "14px", fontWeight: "700", color: tokens.textPrimary }}>
                              Solo servidor
                            </div>
                            <div style={{ fontSize: "12px", color: tokens.textSecondary, marginTop: "2px" }}>
                              El mod se instalará directamente en la carpeta mods del servidor.
                            </div>
                          </div>
                        </label>

                        {/* BOTH OPTION */}
                        <label
                          data-testid="option-server-env-both"
                          style={{
                            display: "flex",
                            alignItems: "flex-start",
                            gap: "12px",
                            padding: "12px 14px",
                            borderRadius: "12px",
                            border: `1px solid ${
                              selectedEnvironmentOverride === "BOTH" ? "#3ec4c0" : tokens.borderSubtle
                            }`,
                            backgroundColor:
                              selectedEnvironmentOverride === "BOTH"
                                ? isDark
                                  ? "rgba(62, 196, 192, 0.1)"
                                  : "rgba(62, 196, 192, 0.06)"
                                : tokens.bgCardInner,
                            cursor: "pointer",
                            transition: "all 0.15s ease",
                          }}
                        >
                          <input
                            type="radio"
                            name="curseforge-env-server"
                            value="BOTH"
                            checked={selectedEnvironmentOverride === "BOTH"}
                            onChange={() => setSelectedEnvironmentOverride("BOTH")}
                            disabled={installing}
                            style={{ marginTop: "3px", accentColor: "#3ec4c0" }}
                          />
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: "14px", fontWeight: "700", color: tokens.textPrimary }}>
                              Cliente y servidor
                            </div>
                            <div style={{ fontSize: "12px", color: tokens.textSecondary, marginTop: "2px" }}>
                              El mod requiere instalación conjunta en el modpack del cliente y sincronización con el servidor.
                            </div>
                          </div>
                        </label>
                      </>
                    ) : (
                      <>
                        {/* CLIENT OPTION */}
                        <label
                          data-testid="option-env-client"
                          style={{
                            display: "flex",
                            alignItems: "flex-start",
                            gap: "12px",
                            padding: "12px 14px",
                            borderRadius: "12px",
                            border: `1px solid ${
                              selectedEnvironmentOverride === "CLIENT" ? "#3ec4c0" : tokens.borderSubtle
                            }`,
                            backgroundColor:
                              selectedEnvironmentOverride === "CLIENT"
                                ? isDark
                                  ? "rgba(62, 196, 192, 0.1)"
                                  : "rgba(62, 196, 192, 0.06)"
                                : tokens.bgCardInner,
                            cursor: "pointer",
                            transition: "all 0.15s ease",
                          }}
                        >
                          <input
                            type="radio"
                            name="curseforge-env-game"
                            value="CLIENT"
                            checked={selectedEnvironmentOverride === "CLIENT"}
                            onChange={() => setSelectedEnvironmentOverride("CLIENT")}
                            disabled={installing}
                            style={{ marginTop: "3px", accentColor: "#3ec4c0" }}
                          />
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: "14px", fontWeight: "700", color: tokens.textPrimary }}>
                              Solo cliente
                            </div>
                            <div style={{ fontSize: "12px", color: tokens.textSecondary, marginTop: "2px" }}>
                              El mod solo se descargará en los clientes del juego.
                            </div>
                          </div>
                        </label>

                        {/* BOTH OPTION */}
                        <label
                          data-testid="option-env-both"
                          style={{
                            display: "flex",
                            alignItems: "flex-start",
                            gap: "12px",
                            padding: "12px 14px",
                            borderRadius: "12px",
                            border: `1px solid ${
                              selectedEnvironmentOverride === "BOTH" ? "#3ec4c0" : tokens.borderSubtle
                            }`,
                            backgroundColor:
                              selectedEnvironmentOverride === "BOTH"
                                ? isDark
                                  ? "rgba(62, 196, 192, 0.1)"
                                  : "rgba(62, 196, 192, 0.06)"
                                : tokens.bgCardInner,
                            cursor: "pointer",
                            transition: "all 0.15s ease",
                          }}
                        >
                          <input
                            type="radio"
                            name="curseforge-env-game"
                            value="BOTH"
                            checked={selectedEnvironmentOverride === "BOTH"}
                            onChange={() => setSelectedEnvironmentOverride("BOTH")}
                            disabled={installing}
                            style={{ marginTop: "3px", accentColor: "#3ec4c0" }}
                          />
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: "14px", fontWeight: "700", color: tokens.textPrimary }}>
                              Cliente y servidor
                            </div>
                            <div style={{ fontSize: "12px", color: tokens.textSecondary, marginTop: "2px" }}>
                              El mod se descargará en los clientes y se sincronizará con el servidor tras publicar la release.
                            </div>
                          </div>
                        </label>
                      </>
                    )}
                  </div>
                  <div style={{ fontSize: "11px", color: tokens.textSecondary, marginTop: "6px" }}>
                    Esta elección se aplicará también a dependencias obligatorias de CurseForge cuyo entorno no se pueda determinar.
                  </div>
                </div>
              )}

              {/* BOTH Mod Guard Alert in Server Files mode */}
              {isBothEnvironment ? (
                <div
                  data-testid="alert-both-mod-redirect"
                  style={{
                    padding: "16px",
                    borderRadius: "12px",
                    background: "rgba(245, 158, 11, 0.12)",
                    border: "1px solid rgba(245, 158, 11, 0.3)",
                    color: "#fde047",
                    fontSize: "13px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "12px",
                    marginBottom: "20px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
                    <IconAlertCircle size={20} style={{ color: "#fbbf24", flexShrink: 0, marginTop: 2 }} />
                    <div>
                      <strong style={{ display: "block", marginBottom: "4px", color: "#fbbf24" }}>
                        Este mod afecta tanto al cliente como al servidor.
                      </strong>
                      Para mantener la sincronización y la integridad del modpack, debe añadirse a la versión del juego desde <strong>Juego → Actualizaciones</strong>.
                    </div>
                  </div>

                  {onNavigateToGame && (
                    <button
                      type="button"
                      data-testid="button-redirect-to-game"
                      onClick={() => {
                        onClose()
                        onNavigateToGame({
                          provider: currentProvider,
                          projectId: currentProjectId,
                          versionId: selectedVersionId,
                          contentType: "MOD",
                          environmentOverride: "BOTH",
                          loaderOverride: loaderOverride || undefined,
                        })
                      }}
                      className="launcher-btn-primary"
                      style={{
                        alignSelf: "flex-start",
                        fontSize: "12px",
                        padding: "6px 14px",
                      }}
                    >
                      Añadir desde Actualizaciones →
                    </button>
                  )}
                </div>
              ) : (
                <>
                  {/* Version Selector */}
                  <div style={{ marginBottom: "20px" }}>
                    <label
                      style={{
                        display: "block",
                        fontSize: "13px",
                        fontWeight: "600",
                        color: "#e5e7eb",
                        marginBottom: "8px",
                      }}
                    >
                      Versión (Compatible con Minecraft {currentMcVersion}
                      {currentContentType === "MOD" && currentLoader ? ` · ${currentLoader}` : ""})
                    </label>
                    <select
                      data-testid={isServer ? "select-server-version" : "select-mod-version"}
                      value={selectedVersionId}
                      onChange={(e) => {
                        setSelectedVersionId(e.target.value)
                        setError(null)
                      }}
                      disabled={installing}
                      style={{
                        width: "100%",
                        padding: "10px 12px",
                        background: "rgba(0, 0, 0, 0.3)",
                        border: "1px solid rgba(255, 255, 255, 0.12)",
                        borderRadius: "8px",
                        color: "#f3f4f6",
                        fontSize: "14px",
                        outline: "none",
                      }}
                    >
                      {!selectedVersionId && (
                        <option value="" disabled style={{ background: "#1f2937", color: "#9ca3af" }}>
                          Selecciona una versión compatible...
                        </option>
                      )}
                      {detail?.compatibleVersions.map((ver) => {
                        const verKey = ver.id || ver.fileId || ""
                        const isStable = ver.releaseType === "RELEASE"
                        return (
                          <option key={verKey} value={verKey} style={{ background: "#1f2937", color: "#fff" }}>
                            {ver.versionNumber} ({isStable ? "Estable" : ver.releaseType}) — {ver.filename}
                          </option>
                        )
                      })}
                    </select>
                  </div>

                  {/* Required Dependencies / Files Section */}
                  <div
                    style={{
                      background: "rgba(0, 0, 0, 0.2)",
                      border: "1px solid rgba(255, 255, 255, 0.08)",
                      borderRadius: "10px",
                      padding: "16px",
                      marginBottom: "20px",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        marginBottom: "12px",
                      }}
                    >
                      <h4 style={{ margin: 0, fontSize: "14px", fontWeight: "600", color: "#e5e7eb" }}>
                        {isServer ? "Archivos a instalar en el servidor" : "Dependencias requeridas"}
                      </h4>

                      {!isServer && releasePlan && releasePlan.items.length > 1 && (
                        <div style={{ display: "flex", gap: "12px", fontSize: "12px" }}>
                          <label
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "4px",
                              cursor: "pointer",
                              color: !manualMode ? "#10b981" : "#9ca3af",
                            }}
                          >
                            <input
                              type="radio"
                              name="mode"
                              checked={!manualMode}
                              onChange={() => setManualMode(false)}
                              disabled={installing}
                            />
                            Automático
                          </label>
                          <label
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "4px",
                              cursor: "pointer",
                              color: manualMode ? "#3b82f6" : "#9ca3af",
                            }}
                          >
                            <input
                              type="radio"
                              name="mode"
                              checked={manualMode}
                              onChange={() => setManualMode(true)}
                              disabled={installing}
                            />
                            Elegir versiones manualmente
                          </label>
                        </div>
                      )}
                    </div>

                    {resolvingPlan ? (
                      <div style={{ fontSize: "13px", color: "#9ca3af", padding: "10px 0" }}>
                        Calculando dependencias y resolviendo versiones...
                      </div>
                    ) : plan && plan.items.length > (isServer ? 0 : 1) ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                        {plan.items
                          .filter((item) => (isServer ? true : item.isDependency))
                          .map((item: any) => {
                            const itemKey = `${item.provider}:${item.projectId}:${item.contentType || ""}`
                            const isClickable = !item.isRoot

                            return (
                              <div
                                key={itemKey}
                                data-testid={`dependency-item-${item.projectId}`}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "space-between",
                                  padding: "8px 12px",
                                  background: "rgba(255, 255, 255, 0.03)",
                                  borderRadius: "6px",
                                  border: "1px solid rgba(255, 255, 255, 0.05)",
                                }}
                              >
                                <div>
                                  {isClickable ? (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleNavigateToDependency(item.provider, item.projectId, item.contentType)
                                      }
                                      style={{
                                        background: "transparent",
                                        border: "none",
                                        color: "#60a5fa",
                                        fontWeight: "600",
                                        fontSize: "13px",
                                        cursor: "pointer",
                                        padding: 0,
                                        textAlign: "left",
                                        textDecoration: "underline",
                                      }}
                                    >
                                      {item.projectName}
                                    </button>
                                  ) : (
                                    <span style={{ fontWeight: "600", fontSize: "13px", color: "#f3f4f6" }}>
                                      {item.projectName}
                                    </span>
                                  )}

                                  <span style={{ fontSize: "12px", color: "#9ca3af", marginLeft: "8px" }}>
                                    {item.versionNumber}
                                  </span>

                                  {item.targetPath ? (
                                    <span style={{ fontSize: "11px", color: "#3ec4c0", fontFamily: "monospace", marginLeft: "6px" }}>
                                      (/{item.targetPath})
                                    </span>
                                  ) : item.logicalPath ? (
                                    <span style={{ fontSize: "11px", color: "#6b7280", marginLeft: "6px" }}>
                                      ({item.logicalPath})
                                    </span>
                                  ) : null}

                                  {isClickable && (
                                    <span
                                      style={{
                                        fontSize: "10px",
                                        fontWeight: "600",
                                        padding: "1px 5px",
                                        borderRadius: "4px",
                                        background: "rgba(99, 102, 241, 0.15)",
                                        color: "#818cf8",
                                        marginLeft: "8px",
                                      }}
                                    >
                                      Requerida
                                    </span>
                                  )}
                                </div>

                                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                  {item.action === "ALREADY_INSTALLED" && (
                                    <span
                                      style={{
                                        fontSize: "11px",
                                        padding: "2px 6px",
                                        borderRadius: "4px",
                                        background: "rgba(107, 114, 128, 0.2)",
                                        color: "#9ca3af",
                                      }}
                                    >
                                      Ya instalada
                                    </span>
                                  )}
                                  {item.action === "UPDATE" && (
                                    <span
                                      style={{
                                        fontSize: "11px",
                                        padding: "2px 6px",
                                        borderRadius: "4px",
                                        background: "rgba(59, 130, 246, 0.2)",
                                        color: "#60a5fa",
                                      }}
                                    >
                                      {isServer ? "Actualizar" : "Se actualizará"}
                                    </span>
                                  )}
                                  {item.action === "INSTALL" && (
                                    <span
                                      style={{
                                        fontSize: "11px",
                                        padding: "2px 6px",
                                        borderRadius: "4px",
                                        background: "rgba(16, 185, 129, 0.2)",
                                        color: "#34d399",
                                      }}
                                    >
                                      {isServer ? "Instalar" : "Nueva"}
                                    </span>
                                  )}

                                  {!isServer && manualMode && item.availableCompatibleVersions?.length > 0 && (
                                    <select
                                      data-testid={`select-override-${item.projectId}`}
                                      value={manualOverrides[itemKey] || item.versionId}
                                      onChange={(e) =>
                                        setManualOverrides((prev) => ({
                                          ...prev,
                                          [itemKey]: e.target.value,
                                        }))
                                      }
                                      disabled={installing}
                                      style={{
                                        padding: "4px 8px",
                                        background: "#1f2937",
                                        border: "1px solid rgba(255, 255, 255, 0.15)",
                                        borderRadius: "4px",
                                        color: "#fff",
                                        fontSize: "12px",
                                      }}
                                    >
                                      {item.availableCompatibleVersions.map((v: any) => (
                                        <option key={v.id || v.fileId} value={v.id || v.fileId || ""}>
                                          {v.versionNumber} ({v.releaseType})
                                        </option>
                                      ))}
                                    </select>
                                  )}
                                </div>
                              </div>
                            )
                          })}
                      </div>
                    ) : (
                      <div style={{ fontSize: "13px", color: "#9ca3af" }}>
                        Este contenido no declara dependencias requeridas adicionales.
                      </div>
                    )}

                    {/* Conflicts warning */}
                    {plan && plan.conflicts && plan.conflicts.length > 0 && (
                      <div
                        data-testid="plan-conflicts-warning"
                        style={{
                          marginTop: "12px",
                          padding: "10px 14px",
                          background: "rgba(239, 68, 68, 0.15)",
                          border: "1px solid rgba(239, 68, 68, 0.3)",
                          borderRadius: "8px",
                          color: "#fca5a5",
                          fontSize: "13px",
                        }}
                      >
                        <strong>Incompatibilidad o conflicto detectado:</strong>
                        <ul style={{ margin: "6px 0 0 0", paddingLeft: "18px" }}>
                          {plan.conflicts.map((c: string, i: number) => (
                            <li key={i}>{c}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>

                  {/* Optional Dependencies Section */}
                  {plan && plan.optionalDependencies && plan.optionalDependencies.length > 0 && (
                    <div
                      data-testid="optional-dependencies-section"
                      style={{
                        background: "rgba(0, 0, 0, 0.2)",
                        border: "1px solid rgba(255, 255, 255, 0.08)",
                        borderRadius: "10px",
                        padding: "16px",
                        marginBottom: "20px",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          marginBottom: "12px",
                        }}
                      >
                        <h4 style={{ margin: 0, fontSize: "14px", fontWeight: "600", color: "#e5e7eb" }}>
                          Dependencias opcionales
                        </h4>
                        <span style={{ fontSize: "12px", color: "#9ca3af" }}>
                          No se instalará automáticamente
                        </span>
                      </div>

                      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                        {plan.optionalDependencies.map((opt: any) => {
                          const optKey = `${opt.provider}:${opt.projectId}:${opt.contentType || ""}`
                          const isQueued = queuedOptionalIds.has(opt.projectId)

                          return (
                            <div
                              key={optKey}
                              data-testid={`optional-dependency-item-${opt.projectId}`}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                padding: "8px 12px",
                                background: "rgba(255, 255, 255, 0.03)",
                                borderRadius: "6px",
                                border: "1px solid rgba(255, 255, 255, 0.05)",
                              }}
                            >
                              <div>
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleNavigateToDependency(opt.provider, opt.projectId, opt.contentType)
                                  }
                                  style={{
                                    background: "transparent",
                                    border: "none",
                                    color: "#60a5fa",
                                    fontWeight: "600",
                                    fontSize: "13px",
                                    cursor: "pointer",
                                    padding: 0,
                                    textAlign: "left",
                                    textDecoration: "underline",
                                  }}
                                >
                                  {opt.projectName}
                                </button>
                                <span style={{ fontSize: "12px", color: "#9ca3af", marginLeft: "8px" }}>
                                  [{opt.provider} · {opt.contentType}]
                                </span>
                                {opt.versionNumber && (
                                  <span style={{ fontSize: "12px", color: "#9ca3af", marginLeft: "6px" }}>
                                    {opt.versionNumber}
                                  </span>
                                )}
                                <span
                                  style={{
                                    fontSize: "10px",
                                    fontWeight: "600",
                                    padding: "1px 5px",
                                    borderRadius: "4px",
                                    background: "rgba(234, 179, 8, 0.15)",
                                    color: "#fde047",
                                    marginLeft: "8px",
                                  }}
                                >
                                  Opcional
                                </span>
                              </div>

                              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                {opt.isInstalled ? (
                                  <span
                                    data-testid={`optional-installed-${opt.projectId}`}
                                    style={{
                                      fontSize: "11px",
                                      padding: "2px 6px",
                                      borderRadius: "4px",
                                      background: "rgba(107, 114, 128, 0.2)",
                                      color: "#9ca3af",
                                    }}
                                  >
                                    Ya instalada
                                  </span>
                                ) : (
                                  <span
                                    style={{
                                      fontSize: "11px",
                                      padding: "2px 6px",
                                      borderRadius: "4px",
                                      background: "rgba(234, 179, 8, 0.15)",
                                      color: "#fde047",
                                    }}
                                  >
                                    No instalada (Opcional)
                                  </span>
                                )}

                                {!opt.isInstalled && (
                                  <button
                                    type="button"
                                    data-testid={`button-queue-optional-${opt.projectId}`}
                                    onClick={() => {
                                      if (opt.versionId) {
                                        handleQueueOptional(opt)
                                      } else {
                                        handleNavigateToDependency(opt.provider, opt.projectId, opt.contentType)
                                      }
                                    }}
                                    disabled={isQueued}
                                    style={{
                                      background: isQueued ? "rgba(16, 185, 129, 0.2)" : tokens.bgCardInner,
                                      border: `1px solid ${isQueued ? "#10b981" : tokens.borderSubtle}`,
                                      borderRadius: "6px",
                                      color: isQueued ? "#34d399" : tokens.textPrimary,
                                      fontSize: "11px",
                                      fontWeight: "600",
                                      padding: "3px 8px",
                                      cursor: isQueued ? "default" : "pointer",
                                    }}
                                  >
                                    {isQueued ? "Añadida" : opt.versionId ? "+ Añadir a la selección" : "Ver versiones"}
                                  </button>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div
          style={{
            padding: "16px 24px",
            borderTop: `1px solid ${tokens.borderSubtle}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: tokens.bgCardInner,
          }}
        >
          <div style={{ fontSize: "13px", color: tokens.textSecondary }}>
            {plan && plan.totalDownloadSizeBytes > 0 && (
              <span>
                Descarga estimada: {(plan.totalDownloadSizeBytes / (1024 * 1024)).toFixed(1)} MB
              </span>
            )}
          </div>

          <div style={{ display: "flex", gap: "10px", alignItems: "center", flexShrink: 0 }}>
            <button
              type="button"
              onClick={onClose}
              disabled={installing}
              className="launcher-btn-secondary"
              style={{
                padding: "10px 18px",
                borderRadius: "12px",
                fontSize: "14px",
                fontWeight: "600",
                whiteSpace: "nowrap",
              }}
            >
              Cancelar
            </button>

            {/* In SERVER mode: Queue button is primary */}
            {isServer ? (
              <button
                type="button"
                data-testid="button-add-to-queue"
                onClick={handleQueue}
                disabled={
                  loading ||
                  resolvingPlan ||
                  !serverPlan ||
                  !serverPlan.isValid ||
                  (serverPlan.conflicts?.length ?? 0) > 0 ||
                  !selectedVersionId ||
                  isBothEnvironment ||
                  Boolean(isCurseForgeModUnknown && !selectedEnvironmentOverride)
                }
                className="launcher-btn-primary"
                style={{
                  padding: "10px 22px",
                  borderRadius: "12px",
                  fontSize: "14px",
                  fontWeight: "700",
                  whiteSpace: "nowrap",
                  opacity:
                    loading ||
                    resolvingPlan ||
                    !serverPlan ||
                    !serverPlan.isValid ||
                    (serverPlan.conflicts?.length ?? 0) > 0 ||
                    !selectedVersionId ||
                    isBothEnvironment ||
                    Boolean(isCurseForgeModUnknown && !selectedEnvironmentOverride)
                      ? 0.5
                      : 1,
                  cursor:
                    loading ||
                    resolvingPlan ||
                    !serverPlan ||
                    !serverPlan.isValid ||
                    (serverPlan.conflicts?.length ?? 0) > 0 ||
                    !selectedVersionId ||
                    isBothEnvironment ||
                    Boolean(isCurseForgeModUnknown && !selectedEnvironmentOverride)
                      ? "not-allowed"
                      : "pointer",
                }}
              >
                Añadir
              </button>
            ) : (
              <>
                {onQueueMod && (
                  <button
                    type="button"
                    data-testid="button-queue-mod"
                    onClick={handleQueue}
                    disabled={
                      installing ||
                      loading ||
                      resolvingPlan ||
                      !releasePlan ||
                      !releasePlan.isValid ||
                      Boolean(isCurseForgeModUnknown && !selectedEnvironmentOverride)
                    }
                    className="launcher-btn-secondary"
                    style={{
                      padding: "10px 18px",
                      borderRadius: "12px",
                      fontSize: "14px",
                      fontWeight: "600",
                      whiteSpace: "nowrap",
                    }}
                  >
                    + Encolar selección
                  </button>
                )}

                <button
                  type="button"
                  data-testid="button-confirm-install"
                  onClick={handleInstallRelease}
                  disabled={
                    installing ||
                    loading ||
                    resolvingPlan ||
                    !releasePlan ||
                    !releasePlan.isValid ||
                    Boolean(isCurseForgeModUnknown && !selectedEnvironmentOverride)
                  }
                  className="launcher-btn-primary"
                  style={{
                    padding: "10px 22px",
                    borderRadius: "12px",
                    fontSize: "14px",
                    fontWeight: "700",
                    whiteSpace: "nowrap",
                    opacity:
                      installing ||
                      loading ||
                      resolvingPlan ||
                      !releasePlan ||
                      !releasePlan.isValid ||
                      Boolean(isCurseForgeModUnknown && !selectedEnvironmentOverride)
                        ? 0.5
                        : 1,
                    cursor:
                      installing ||
                      loading ||
                      resolvingPlan ||
                      !releasePlan ||
                      !releasePlan.isValid ||
                      Boolean(isCurseForgeModUnknown && !selectedEnvironmentOverride)
                        ? "not-allowed"
                        : "pointer",
                  }}
                >
                  {installing
                    ? "Instalando..."
                    : itemsToInstallCount > 1
                    ? `Añadir ${itemsToInstallCount} elementos`
                    : "Añadir a la actualización"}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
