import React, { useState, useEffect, useCallback, useRef } from "react"
import type {
  ModProvider,
  ModSearchResultItem,
  ModProviderStatus,
  ContentType,
  ModProjectDetail,
  ServerContentInstallationPlan,
  ThemeMode,
} from "../../../types"
import { graphqlClient } from "../../../services/graphqlClient"
import { getThemeTokens } from "../../../theme/tokens"
import { formatBytesToHuman } from "@hikat/shared"
import {
  IconSearch,
  IconBox,
  IconSpinner,
  IconAlertCircle,
  IconCheck,
  IconCross,
  IconDownload,
  IconTrash,
} from "../../../theme/icons"

interface ServerModSearchModalProps {
  serverId: string
  theme?: ThemeMode
  onClose: () => void
  onSuccess: () => void
  onNavigateToGame?: (handoff?: import("../../../types").GameHandoffPayload) => void
}

const PAGE_SIZE = 20

export const ServerModSearchModal: React.FC<ServerModSearchModalProps> = ({
  serverId,
  theme = "dark",
  onClose,
  onSuccess,
  onNavigateToGame,
}) => {
  const isDark = theme === "dark"
  const tokens = getThemeTokens(theme)
  const [query, setQuery] = useState("")
  const [selectedContentType, setSelectedContentType] = useState<ContentType>("MOD")
  const [selectedProviderTab, setSelectedProviderTab] = useState<ModProvider | "ALL">("ALL")
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [results, setResults] = useState<ModSearchResultItem[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [cursor, setCursor] = useState<string | null>(null)
  const [offset, setOffset] = useState(0)
  const [providerStatuses, setProviderStatuses] = useState<ModProviderStatus[]>([])
  const [error, setError] = useState<string | null>(null)
  const [envInfo, setEnvInfo] = useState<{
    minecraftVersion: string
    modLoader: import("../../../types").GameModLoader
    modLoaderVersion: string | null | undefined
    neoForgeVersion?: string | null
    isPublishedEnvironment: boolean
  }>({
    minecraftVersion: "1.21.1",
    modLoader: "NEOFORGE",
    modLoaderVersion: null,
    neoForgeVersion: null,
    isPublishedEnvironment: true,
  })

  // Selected item detail and installation state
  const [selectedMod, setSelectedMod] = useState<ModSearchResultItem | null>(null)
  const [modDetail, setModDetail] = useState<ModProjectDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [selectedVersionId, setSelectedVersionId] = useState<string>("")
  const [selectedEnvironmentOverride, setSelectedEnvironmentOverride] = useState<
    import("../../../types").ModEnvironment | null
  >(null)
  const [plan, setPlan] = useState<ServerContentInstallationPlan | null>(null)
  const [resolvingPlan, setResolvingPlan] = useState(false)
  const [installError, setInstallError] = useState<string | null>(null)

  // Queue state for batch installation
  const [queuedSelections, setQueuedSelections] = useState<{
    provider: ModProvider
    projectId: string
    projectName: string
    versionId: string
    versionNumber: string
    contentType: ContentType
    environmentOverride?: import("../../../types").ModEnvironment | null
  }[]>([])
  const [batchInstalling, setBatchInstalling] = useState(false)
  const [batchError, setBatchError] = useState<string | null>(null)

  const debounceTimer = useRef<NodeJS.Timeout | null>(null)
  const requestIdRef = useRef(0)

  const executeSearch = useCallback((
    searchQuery: string,
    contentType: ContentType,
    providerTab: ModProvider | "ALL",
    currentOffset: number = 0,
    searchCursor: string | null = null,
    isLoadMore: boolean = false,
  ) => {
    const currentReqId = ++requestIdRef.current

    if (isLoadMore) {
      setLoadingMore(true)
    } else {
      setLoading(true)
      setError(null)
    }

    const providerArg = providerTab === "ALL" ? null : providerTab

    graphqlClient
      .searchServerContent(searchQuery, contentType, providerArg, PAGE_SIZE, currentOffset, searchCursor, serverId)
      .then((payload) => {
        if (currentReqId !== requestIdRef.current) return

        if (isLoadMore) {
          setResults((prev) => [...prev, ...(payload.items || [])])
        } else {
          setResults(payload.items || [])
        }

        setTotalCount(payload.totalCount || 0)
        setHasMore(Boolean(payload.hasMore && payload.nextCursor))
        setCursor(payload.nextCursor || null)
        setProviderStatuses(payload.providersStatus || [])
        if (payload.minecraftVersion) {
          setEnvInfo({
            minecraftVersion: payload.minecraftVersion,
            modLoader: payload.modLoader || "NEOFORGE",
            modLoaderVersion: payload.modLoaderVersion ?? null,
            neoForgeVersion: payload.neoForgeVersion ?? null,
            isPublishedEnvironment: payload.isPublishedEnvironment,
          })
        }
        setLoading(false)
        setLoadingMore(false)
      })
      .catch((err) => {
        if (currentReqId !== requestIdRef.current) return
        setError(err.message || "Error al realizar la búsqueda.")
        setLoading(false)
        setLoadingMore(false)
      })
  }, [serverId])

  // Trigger search on tab changes
  useEffect(() => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current)
      debounceTimer.current = null
    }
    setOffset(0)
    setCursor(null)
    executeSearch(query, selectedContentType, selectedProviderTab, 0, null, false)

    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current)
        debounceTimer.current = null
      }
    }
  }, [selectedContentType, selectedProviderTab, serverId, executeSearch])

  // Clean up
  useEffect(() => {
    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current)
        debounceTimer.current = null
      }
      requestIdRef.current++
    }
  }, [])

  const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setQuery(val)
    setOffset(0)
    setCursor(null)

    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current)
    }
    debounceTimer.current = setTimeout(() => {
      executeSearch(val, selectedContentType, selectedProviderTab, 0, null, false)
    }, 350)
  }

  const handleLoadMore = () => {
    if (!cursor || !hasMore || loadingMore) return
    const nextOffset = offset + PAGE_SIZE
    setOffset(nextOffset)
    executeSearch(query, selectedContentType, selectedProviderTab, nextOffset, cursor, true)
  }

  const isCurseForgeModUnknown = (mod: ModSearchResultItem | null, detail: ModProjectDetail | null) =>
    Boolean(
      mod &&
        mod.provider === "CURSEFORGE" &&
        (mod.contentType || selectedContentType) === "MOD" &&
        (detail?.environment === "UNKNOWN" || !detail?.environment),
    )

  const resolvePlanForVersion = useCallback(async (
    provider: ModProvider,
    projectId: string,
    versionId: string,
    contentType: ContentType,
    environmentOverride?: import("../../../types").ModEnvironment | null,
  ) => {
    setResolvingPlan(true)
    setInstallError(null)
    try {
      const resolvedPlan = await graphqlClient.resolveServerContentPlan({
        provider,
        projectId,
        versionId,
        contentType,
        environmentOverride: environmentOverride || undefined,
      }, serverId)
      setPlan(resolvedPlan)
    } catch (err: any) {
      setInstallError(err.message || "Error al calcular el plan de instalación.")
    } finally {
      setResolvingPlan(false)
    }
  }, [serverId])

  // When a mod is selected, load detail
  const handleSelectMod = useCallback(async (mod: ModSearchResultItem) => {
    setSelectedMod(mod)
    setModDetail(null)
    setPlan(null)
    setSelectedEnvironmentOverride(null)
    setInstallError(null)
    setLoadingDetail(true)

    try {
      const detail = await graphqlClient.getServerContentProjectDetail(
        mod.provider,
        mod.projectId,
        mod.contentType || selectedContentType,
        serverId,
      )
      setModDetail(detail)

      if (detail.compatibleVersions && detail.compatibleVersions.length > 0) {
        const firstVer = detail.compatibleVersions[0]!
        setSelectedVersionId(firstVer.id)
        const isUnknown = isCurseForgeModUnknown(mod, detail)
        if (!isUnknown && detail.environment !== "BOTH") {
          resolvePlanForVersion(mod.provider, mod.projectId, firstVer.id, mod.contentType || selectedContentType, null)
        }
      }
    } catch (err: any) {
      setInstallError(err.message || "Error al cargar los detalles del contenido.")
    } finally {
      setLoadingDetail(false)
    }
  }, [serverId, selectedContentType, resolvePlanForVersion])

  const handleVersionChange = (newVersionId: string) => {
    setSelectedVersionId(newVersionId)
    if (selectedMod && modDetail) {
      const isUnknown = isCurseForgeModUnknown(selectedMod, modDetail)
      if (isUnknown) {
        if (selectedEnvironmentOverride === "SERVER") {
          resolvePlanForVersion(
            selectedMod.provider,
            selectedMod.projectId,
            newVersionId,
            selectedMod.contentType || selectedContentType,
            "SERVER",
          )
        }
      } else if (modDetail.environment !== "BOTH") {
        resolvePlanForVersion(
          selectedMod.provider,
          selectedMod.projectId,
          newVersionId,
          selectedMod.contentType || selectedContentType,
          null,
        )
      }
    }
  }

  const handleEnvironmentOverrideChange = (env: "SERVER" | "BOTH") => {
    setSelectedEnvironmentOverride(env)
    setInstallError(null)
    if (!selectedMod || !selectedVersionId) return

    if (env === "SERVER") {
      resolvePlanForVersion(
        selectedMod.provider,
        selectedMod.projectId,
        selectedVersionId,
        selectedMod.contentType || selectedContentType,
        "SERVER",
      )
    } else {
      setPlan(null)
    }
  }

  const handleAddToQueue = () => {
    if (!selectedMod || !selectedVersionId || !plan?.isValid || (plan?.conflicts?.length ?? 0) > 0) return
    const currentVersion = modDetail?.compatibleVersions?.find((v) => v.id === selectedVersionId)
    const versionNum = currentVersion?.versionNumber || selectedVersionId

    setQueuedSelections((prev) => {
      const existingIndex = prev.findIndex(
        (item) => item.provider === selectedMod.provider && item.projectId === selectedMod.projectId,
      )
      const newEntry = {
        provider: selectedMod.provider,
        projectId: selectedMod.projectId,
        projectName: selectedMod.name,
        versionId: selectedVersionId,
        versionNumber: versionNum,
        contentType: selectedMod.contentType || selectedContentType,
        environmentOverride: selectedEnvironmentOverride || undefined,
      }
      if (existingIndex >= 0) {
        const updated = [...prev]
        updated[existingIndex] = newEntry
        return updated
      }
      return [...prev, newEntry]
    })

    setSelectedMod(null)
    setModDetail(null)
    setPlan(null)
    setSelectedEnvironmentOverride(null)
    setInstallError(null)
  }

  const handleRemoveFromQueue = (provider: ModProvider, projectId: string) => {
    setQueuedSelections((prev) => prev.filter((item) => !(item.provider === provider && item.projectId === projectId)))
  }

  const handleConfirmBatch = async () => {
    if (queuedSelections.length === 0 || batchInstalling) return
    setBatchInstalling(true)
    setBatchError(null)

    try {
      const plansInput = queuedSelections.map((item) => ({
        provider: item.provider,
        projectId: item.projectId,
        versionId: item.versionId,
        contentType: item.contentType,
        environmentOverride: item.environmentOverride || undefined,
      }))

      await graphqlClient.installServerContentPlansBatch({ plans: plansInput }, serverId)
      setQueuedSelections([])
      onSuccess()
      onClose()
    } catch (err: any) {
      setBatchError(err.message || "Error al instalar el contenido en el servidor.")
    } finally {
      setBatchInstalling(false)
    }
  }

  const failedProviders = providerStatuses.filter((s) => !s.available && s.error)

  return (
    <div
      data-testid="server-mod-search-modal"
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.78)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 900,
        padding: "24px",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        style={{
          backgroundColor: tokens.bgCard,
          border: `1px solid ${tokens.borderSubtle}`,
          borderRadius: "18px",
          width: "100%",
          maxWidth: "1050px",
          height: "85vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: tokens.cardShadowLg,
        }}
      >
        {/* Top Header */}
        <div
          style={{
            padding: "20px 24px",
            borderBottom: `1px solid ${tokens.borderSubtle}`,
            display: "flex",
            flexDirection: "column",
            gap: "14px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <h2 style={{ margin: 0, fontSize: "1.2rem", fontWeight: "700", color: tokens.textPrimary }}>
                Añadir contenido al servidor
              </h2>
              <div
                data-testid="server-compatible-env-indicator"
                style={{ fontSize: "13px", color: tokens.textSecondary, marginTop: "2px" }}
              >
                Entorno de ejecución:{" "}
                <span style={{ color: "#34d399", fontWeight: "600" }}>
                  Minecraft {envInfo.minecraftVersion}
                </span>
                {selectedContentType === "MOD" && envInfo.modLoader !== "VANILLA" && (
                  <>
                    {" "}·{" "}
                    <span style={{ color: "#60a5fa", fontWeight: "600" }}>
                      {envInfo.modLoader}{envInfo.modLoaderVersion ? ` ${envInfo.modLoaderVersion}` : ""}
                    </span>
                  </>
                )}{" "}
                <span style={{ color: "#a78bfa", fontSize: "11px", marginLeft: "4px" }}>
                  (Versión publicada)
                </span>
              </div>
            </div>

            <button
              type="button"
              data-testid="button-close-server-search"
              onClick={onClose}
              style={{
                background: "transparent",
                border: "none",
                color: tokens.textMuted,
                cursor: "pointer",
                padding: "4px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <IconCross size={18} />
            </button>
          </div>

          {/* Content Type Selector: MOD (Server) vs DATA_PACK */}
          <div
            style={{
              display: "flex",
              gap: "8px",
              borderBottom: `1px solid ${tokens.borderSubtle}`,
              paddingBottom: "8px",
              flexWrap: "wrap",
            }}
          >
            {[
              { type: "MOD" as ContentType, label: "Mods para servidor", testId: "server-tab-content-mod" },
              { type: "DATA_PACK" as ContentType, label: "Data Packs", testId: "server-tab-content-datapack" },
            ].map((tab) => {
              const isSelected = selectedContentType === tab.type
              return (
                <button
                  key={tab.type}
                  type="button"
                  data-testid={tab.testId}
                  onClick={() => {
                    setSelectedContentType(tab.type)
                    setSelectedMod(null)
                  }}
                  style={{
                    padding: "6px 14px",
                    background: isSelected ? (isDark ? "rgba(62, 196, 192, 0.15)" : "#e6fffa") : "transparent",
                    color: isSelected ? (isDark ? "#3ec4c0" : "#0c6e6b") : tokens.textSecondary,
                    border: `1px solid ${isSelected ? (isDark ? "rgba(62, 196, 192, 0.4)" : "#b2f5ea") : tokens.borderSubtle}`,
                    borderRadius: "8px",
                    fontSize: "13px",
                    fontWeight: isSelected ? "700" : "500",
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                  }}
                >
                  {tab.label}
                </button>
              )
            })}
          </div>

          {/* Search Bar & Provider Filter */}
          <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: "240px", position: "relative" }}>
              <input
                data-testid="input-server-mod-search"
                type="text"
                value={query}
                onChange={handleQueryChange}
                placeholder={`Buscar ${selectedContentType === "MOD" ? "mods para servidor" : "data packs"} en Modrinth y CurseForge...`}
                className="launcher-input"
                style={{
                  width: "100%",
                  padding: "10px 16px 10px 38px",
                  fontSize: "13px",
                  boxSizing: "border-box",
                }}
              />
              <span
                style={{
                  position: "absolute",
                  left: "14px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: tokens.textMuted,
                  display: "flex",
                  alignItems: "center",
                }}
              >
                <IconSearch size={16} />
              </span>
            </div>

            <div
              style={{
                display: "flex",
                background: "rgba(0, 0, 0, 0.4)",
                padding: "3px",
                borderRadius: "10px",
                border: "1px solid rgba(255, 255, 255, 0.08)",
              }}
            >
              <button
                type="button"
                data-testid="server-tab-provider-all"
                onClick={() => setSelectedProviderTab("ALL")}
                style={{
                  padding: "8px 14px",
                  background: selectedProviderTab === "ALL" ? "rgba(255, 255, 255, 0.12)" : "transparent",
                  color: selectedProviderTab === "ALL" ? "#ffffff" : "#9ca3af",
                  border: "none",
                  borderRadius: "8px",
                  fontSize: "13px",
                  fontWeight: selectedProviderTab === "ALL" ? "600" : "500",
                  cursor: "pointer",
                }}
              >
                Todos
              </button>

              <button
                type="button"
                data-testid="server-tab-provider-modrinth"
                onClick={() => setSelectedProviderTab("MODRINTH")}
                style={{
                  padding: "8px 14px",
                  background: selectedProviderTab === "MODRINTH" ? "rgba(16, 185, 129, 0.2)" : "transparent",
                  color: selectedProviderTab === "MODRINTH" ? "#10b981" : "#9ca3af",
                  border: "none",
                  borderRadius: "8px",
                  fontSize: "13px",
                  fontWeight: selectedProviderTab === "MODRINTH" ? "600" : "500",
                  cursor: "pointer",
                }}
              >
                Modrinth
              </button>

              <button
                type="button"
                data-testid="server-tab-provider-curseforge"
                onClick={() => setSelectedProviderTab("CURSEFORGE")}
                style={{
                  padding: "8px 14px",
                  background: selectedProviderTab === "CURSEFORGE" ? "rgba(249, 115, 22, 0.2)" : "transparent",
                  color: selectedProviderTab === "CURSEFORGE" ? "#f97316" : "#9ca3af",
                  border: "none",
                  borderRadius: "8px",
                  fontSize: "13px",
                  fontWeight: selectedProviderTab === "CURSEFORGE" ? "600" : "500",
                  cursor: "pointer",
                }}
              >
                CurseForge
              </button>
            </div>
          </div>

          {failedProviders.length > 0 && selectedProviderTab === "ALL" && (
            <div
              style={{
                padding: "8px 12px",
                background: "rgba(234, 179, 8, 0.1)",
                border: "1px solid rgba(234, 179, 8, 0.2)",
                borderRadius: "8px",
                color: "#fde047",
                fontSize: "12px",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <IconAlertCircle size={16} style={{ color: "#fde047" }} />
              <span>Mostrando resultados de proveedores disponibles.</span>
            </div>
          )}
        </div>

        {/* Content Body: Split view if a mod is selected, otherwise full grid */}
        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
          {/* Left / Main Results List */}
          <div
            style={{
              flex: selectedMod ? "0 0 50%" : "1 1 100%",
              overflowY: "auto",
              padding: "20px 24px",
              borderRight: selectedMod ? `1px solid ${tokens.borderSubtle}` : "none",
            }}
            className="custom-scroll"
          >
            {loading ? (
              <div style={{ textAlign: "center", padding: "60px 0", color: tokens.textSecondary, display: "flex", flexDirection: "column", alignItems: "center", gap: "12px" }}>
                <IconSpinner size={28} />
                <span>Buscando contenido de servidor compatible...</span>
              </div>
            ) : error ? (
              <div
                style={{
                  padding: "16px",
                  background: "rgba(239, 68, 68, 0.1)",
                  border: "1px solid rgba(239, 68, 68, 0.2)",
                  borderRadius: "8px",
                  color: "#fca5a5",
                  fontSize: "14px",
                  textAlign: "center",
                }}
              >
                {error}
              </div>
            ) : results.length === 0 ? (
              <div style={{ textAlign: "center", padding: "60px 0", color: tokens.textMuted, display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}>
                <IconSearch size={32} />
                <div style={{ fontSize: "16px", color: tokens.textSecondary, marginBottom: "4px" }}>
                  No se encontraron resultados de servidor
                </div>
                <div style={{ fontSize: "13px" }}>
                  {selectedContentType === "MOD"
                    ? "Intenta con otro término de búsqueda o cambia de proveedor."
                    : "Intenta con otro término de búsqueda."}
                </div>
              </div>
            ) : (
              <div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: selectedMod ? "1fr" : "repeat(auto-fill, minmax(280px, 1fr))",
                    gap: "14px",
                    marginBottom: "16px",
                  }}
                >
                  {results.map((item) => {
                    const isSelected =
                      selectedMod?.provider === item.provider &&
                      selectedMod?.projectId === item.projectId
                    const isQueued = queuedSelections.some(
                      (q) => q.provider === item.provider && q.projectId === item.projectId,
                    )

                    return (
                      <div
                        key={`${item.provider}:${item.projectId}`}
                        onClick={() => handleSelectMod(item)}
                        style={{
                          padding: "14px",
                          borderRadius: "12px",
                          background: isSelected ? (isDark ? "rgba(62, 196, 192, 0.12)" : "#e6fffa") : tokens.bgCardInner,
                          border: `1px solid ${isSelected ? (isDark ? "rgba(62, 196, 192, 0.4)" : "#b2f5ea") : isQueued ? (isDark ? "rgba(62, 196, 192, 0.3)" : "#b2f5ea") : tokens.borderSubtle}`,
                          cursor: "pointer",
                          display: "flex",
                          gap: "12px",
                          transition: "all 0.15s ease",
                        }}
                      >
                        {item.iconUrl ? (
                          <img
                            src={item.iconUrl}
                            alt={item.name}
                            style={{ width: "44px", height: "44px", borderRadius: "8px", objectFit: "cover" }}
                          />
                        ) : (
                          <div
                            style={{
                              width: "44px",
                              height: "44px",
                              borderRadius: "8px",
                              background: isDark ? "rgba(255,255,255,0.06)" : "#e2e8f0",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              color: tokens.textSecondary,
                            }}
                          >
                            <IconBox size={22} />
                          </div>
                        )}

                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
                            <span style={{ fontSize: "14px", fontWeight: "700", color: "#f9fafb", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {item.name}
                            </span>
                            <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                              {isQueued && (
                                <span
                                  data-testid={`badge-queued-${item.projectId}`}
                                  style={{
                                    fontSize: "10px",
                                    padding: "2px 5px",
                                    borderRadius: "4px",
                                    background: "rgba(62, 196, 192, 0.2)",
                                    color: "#3ec4c0",
                                    fontWeight: "600",
                                  }}
                                >
                                  En cola
                                </span>
                              )}
                              <span
                                style={{
                                  fontSize: "11px",
                                  padding: "2px 6px",
                                  borderRadius: "4px",
                                  background: item.provider === "MODRINTH" ? "rgba(16, 185, 129, 0.2)" : "rgba(249, 115, 22, 0.2)",
                                  color: item.provider === "MODRINTH" ? "#34d399" : "#fb923c",
                                  fontWeight: "600",
                                  flexShrink: 0,
                                }}
                              >
                                {item.provider === "MODRINTH" ? "Modrinth" : "CurseForge"}
                              </span>
                            </div>
                          </div>

                          <div style={{ fontSize: "12px", color: "#9ca3af", margin: "4px 0", overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                            {item.summary}
                          </div>

                          <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "11px", color: "#6b7280" }}>
                            <span>Por <strong>{item.author}</strong></span>
                            <span>•</span>
                            <span>{item.downloads.toLocaleString()} descargas</span>
                            {item.environment && (
                              <>
                                <span>•</span>
                                <span style={{ color: item.environment === "SERVER" ? "#60a5fa" : item.environment === "BOTH" ? "#f59e0b" : "#9ca3af" }}>
                                  {item.environment === "SERVER" ? "Solo Servidor" : item.environment === "BOTH" ? "Cliente y Servidor" : item.environment}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>

                {hasMore && Boolean(cursor) && (
                  <div style={{ textAlign: "center", padding: "12px 0" }}>
                    <button
                      type="button"
                      onClick={handleLoadMore}
                      disabled={loadingMore}
                      style={{
                        padding: "8px 20px",
                        background: "rgba(255, 255, 255, 0.08)",
                        border: "1px solid rgba(255, 255, 255, 0.15)",
                        color: "#f3f4f6",
                        borderRadius: "8px",
                        fontSize: "13px",
                        cursor: loadingMore ? "not-allowed" : "pointer",
                      }}
                    >
                      {loadingMore ? "Cargando..." : "Cargar más"}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right Detail & Install Panel */}
          {selectedMod && (
            <div
              style={{
                flex: "0 0 50%",
                overflowY: "auto",
                padding: "20px 24px",
                display: "flex",
                flexDirection: "column",
                gap: "16px",
                background: "rgba(0, 0, 0, 0.2)",
              }}
            >
              {loadingDetail ? (
                <div style={{ textAlign: "center", padding: "60px 0", color: "#9ca3af" }}>
                  <div style={{ fontSize: "24px", marginBottom: "8px" }}>⏳</div>
                  Cargando información y compatibilidad...
                </div>
              ) : modDetail ? (
                <>
                  {/* Mod Title and provider */}
                  <div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <h3 style={{ margin: 0, fontSize: "18px", fontWeight: "700", color: "#f9fafb" }}>
                        {modDetail.name}
                      </h3>
                      <button
                        type="button"
                        onClick={() => setSelectedMod(null)}
                        style={{
                          background: "transparent",
                          border: "none",
                          color: "#9ca3af",
                          cursor: "pointer",
                        }}
                      >
                        ✕
                      </button>
                    </div>
                    <div style={{ fontSize: "13px", color: "#9ca3af", marginTop: "4px" }}>
                      {modDetail.summary}
                    </div>
                  </div>

                  {/* CurseForge Environment Selector for UNKNOWN environment MODs */}
                  {isCurseForgeModUnknown(selectedMod, modDetail) && (
                    <div data-testid="server-curseforge-environment-selector">
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
                              selectedEnvironmentOverride === "SERVER"
                                ? "#3ec4c0"
                                : tokens.borderSubtle
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
                            onChange={() => handleEnvironmentOverrideChange("SERVER")}
                            disabled={batchInstalling}
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
                              selectedEnvironmentOverride === "BOTH"
                                ? "#3ec4c0"
                                : tokens.borderSubtle
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
                            onChange={() => handleEnvironmentOverrideChange("BOTH")}
                            disabled={batchInstalling}
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
                      </div>
                      <div style={{ fontSize: "11px", color: tokens.textSecondary, marginTop: "6px" }}>
                        Esta elección se aplicará también a dependencias obligatorias de CurseForge cuyo entorno no se pueda determinar.
                      </div>
                    </div>
                  )}

                  {/* BOTH Mod Guard Alert (Reusable for Modrinth BOTH and CurseForge BOTH) */}
                  {modDetail.environment === "BOTH" || selectedEnvironmentOverride === "BOTH" ? (
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
                              provider: selectedMod.provider,
                              projectId: selectedMod.projectId,
                              versionId: selectedVersionId,
                              contentType: "MOD",
                              environmentOverride: "BOTH",
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
                  ) : (!isCurseForgeModUnknown(selectedMod, modDetail) || selectedEnvironmentOverride === "SERVER") ? (
                    <>
                      {/* Version selector */}
                      <div>
                        <label style={{ display: "block", fontSize: "13px", fontWeight: "600", color: tokens.textPrimary, marginBottom: "6px" }}>
                          Versión compatible para servidor:
                        </label>
                        {modDetail.compatibleVersions && modDetail.compatibleVersions.length > 0 ? (
                          <select
                            data-testid="select-server-version"
                            value={selectedVersionId}
                            onChange={(e) => handleVersionChange(e.target.value)}
                            className="launcher-input"
                            style={{
                              width: "100%",
                              padding: "10px 14px",
                              fontSize: "13px",
                              boxSizing: "border-box",
                            }}
                          >
                            {modDetail.compatibleVersions.map((ver) => (
                              <option key={ver.id} value={ver.id}>
                                {ver.versionNumber} ({ver.name}) — {ver.releaseType} ({formatBytesToHuman(ver.sizeBytes)})
                              </option>
                            ))}
                          </select>
                        ) : (
                          <div style={{ color: "#ef4444", fontSize: "13px" }}>
                            No se encontraron versiones compatibles con Minecraft {envInfo.minecraftVersion}.
                          </div>
                        )}
                      </div>

                      {/* Plan preview */}
                      {resolvingPlan ? (
                        <div style={{ color: tokens.textSecondary, fontSize: "13px", textAlign: "center", padding: "20px 0", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
                          <IconSpinner size={16} />
                          <span>Calculando dependencias y destino físico...</span>
                        </div>
                      ) : plan ? (
                        <div
                          style={{
                            padding: "14px",
                            borderRadius: "10px",
                            background: tokens.bgCardInner,
                            border: `1px solid ${tokens.borderSubtle}`,
                          }}
                        >
                          <div style={{ fontSize: "13px", fontWeight: "700", color: tokens.textPrimary, marginBottom: "10px" }}>
                            Archivos a instalar en el servidor:
                          </div>

                          {plan.items.map((pi) => (
                            <div
                              key={`${pi.provider}:${pi.projectId}:${pi.versionId}`}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                fontSize: "12px",
                                padding: "6px 0",
                                borderBottom: `1px solid ${tokens.borderSubtle}`,
                              }}
                            >
                              <div>
                                <span style={{ color: tokens.textPrimary, fontWeight: "600" }}>{pi.projectName}</span>{" "}
                                <span style={{ color: tokens.textSecondary }}>({pi.versionNumber})</span>
                                <div style={{ color: "#3ec4c0", fontSize: "11px", fontFamily: "monospace" }}>
                                  /{pi.targetPath}
                                </div>
                              </div>
                              <span
                                style={{
                                  fontSize: "11px",
                                  padding: "2px 6px",
                                  borderRadius: "4px",
                                  background: pi.action === "INSTALL" ? "rgba(34, 197, 94, 0.2)" : "rgba(62, 196, 192, 0.2)",
                                  color: pi.action === "INSTALL" ? "#4ade80" : "#3ec4c0",
                                  fontWeight: "600",
                                }}
                              >
                                {pi.action === "INSTALL" ? "Instalar" : "Actualizar"}
                              </span>
                            </div>
                          ))}

                          {plan.conflicts.length > 0 && (
                            <div style={{ marginTop: "10px", color: "#f87171", fontSize: "12px" }}>
                              <strong>Conflictos:</strong> {plan.conflicts.join(". ")}
                            </div>
                          )}
                        </div>
                      ) : null}

                      {installError && (
                        <div
                          style={{
                            padding: "10px 14px",
                            background: "rgba(239, 68, 68, 0.15)",
                            border: "1px solid rgba(239, 68, 68, 0.3)",
                            borderRadius: "8px",
                            color: "#fca5a5",
                            fontSize: "13px",
                          }}
                        >
                          {installError}
                        </div>
                      )}

                      {/* Action buttons */}
                      <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "auto" }}>
                        <button
                          type="button"
                          onClick={() => setSelectedMod(null)}
                          className="launcher-btn-secondary"
                          style={{
                            padding: "10px 18px",
                            borderRadius: 12,
                            fontSize: "14px",
                          }}
                        >
                          Cancelar
                        </button>

                        <button
                          type="button"
                          data-testid="button-add-to-queue"
                          onClick={handleAddToQueue}
                          disabled={resolvingPlan || !plan?.isValid || (plan?.conflicts?.length ?? 0) > 0}
                          className="launcher-btn-primary"
                          style={{
                            padding: "10px 22px",
                            borderRadius: 12,
                            fontSize: "14px",
                            opacity: resolvingPlan || !plan?.isValid || (plan?.conflicts?.length ?? 0) > 0 ? 0.5 : 1,
                            cursor: resolvingPlan || !plan?.isValid || (plan?.conflicts?.length ?? 0) > 0 ? "not-allowed" : "pointer",
                          }}
                        >
                          Añadir
                        </button>
                      </div>
                    </>
                  ) : null}
                </>
              ) : null}
            </div>
          )}
        </div>

        {/* Bottom Queue Summary Bar */}
        {queuedSelections.length > 0 && (
          <div
            data-testid="server-queue-bar"
            style={{
              padding: "12px 24px",
              borderTop: `1px solid ${tokens.borderSubtle}`,
              background: isDark ? "rgba(15, 23, 42, 0.95)" : "rgba(241, 245, 249, 0.95)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "16px",
              zIndex: 10,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "12px", overflowX: "auto", flex: 1 }}>
              <div
                data-testid="server-queue-count"
                style={{
                  fontSize: "13px",
                  fontWeight: "700",
                  color: tokens.textPrimary,
                  whiteSpace: "nowrap",
                }}
              >
                Seleccionados: {queuedSelections.length}
              </div>

              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
                {queuedSelections.map((item) => (
                  <div
                    key={`${item.provider}:${item.projectId}`}
                    data-testid={`queue-chip-${item.projectId}`}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      padding: "4px 10px",
                      borderRadius: "16px",
                      background: isDark ? "rgba(62, 196, 192, 0.15)" : "#e6fffa",
                      border: `1px solid ${isDark ? "rgba(62, 196, 192, 0.3)" : "#b2f5ea"}`,
                      fontSize: "12px",
                      color: isDark ? "#3ec4c0" : "#0c6e6b",
                    }}
                  >
                    <span style={{ fontWeight: "600", maxWidth: "160px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {item.projectName}
                    </span>
                    <span style={{ fontSize: "11px", opacity: 0.8 }}>({item.versionNumber})</span>
                    <button
                      type="button"
                      data-testid={`button-remove-queue-${item.projectId}`}
                      onClick={() => handleRemoveFromQueue(item.provider, item.projectId)}
                      style={{
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        color: "inherit",
                        padding: "0 2px",
                        display: "flex",
                        alignItems: "center",
                        lineHeight: 1,
                      }}
                      title="Eliminar de la lista"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "12px", flexShrink: 0 }}>
              {batchError && (
                <span
                  data-testid="server-queue-error"
                  style={{ color: "#f87171", fontSize: "12px", maxWidth: "260px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  title={batchError}
                >
                  {batchError}
                </span>
              )}

              <button
                type="button"
                data-testid="button-confirm-server-batch"
                onClick={handleConfirmBatch}
                disabled={batchInstalling || queuedSelections.length === 0}
                className="launcher-btn-primary"
                style={{
                  padding: "8px 18px",
                  borderRadius: "10px",
                  fontSize: "13px",
                  fontWeight: "600",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  cursor: batchInstalling ? "not-allowed" : "pointer",
                  opacity: batchInstalling ? 0.7 : 1,
                }}
              >
                {batchInstalling ? (
                  <>
                    <IconSpinner size={16} />
                    <span>Instalando...</span>
                  </>
                ) : (
                  <span>Añadir {queuedSelections.length} al servidor</span>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
