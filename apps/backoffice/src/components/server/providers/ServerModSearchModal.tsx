import React, { useState, useEffect, useRef } from "react"
import type {
  ModProvider,
  ModSearchResultItem,
  ModProviderStatus,
  ContentType,
  ModProjectDetail,
  ServerContentInstallationPlan,
} from "../../../types"
import { graphqlClient } from "../../../services/graphqlClient"
import { formatBytesToHuman } from "@hikat/shared"

interface ServerModSearchModalProps {
  onClose: () => void
  onSuccess: () => void
  onNavigateToGame?: () => void
}

const PAGE_SIZE = 20

export const ServerModSearchModal: React.FC<ServerModSearchModalProps> = ({
  onClose,
  onSuccess,
  onNavigateToGame,
}) => {
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
    neoForgeVersion: string
    isPublishedEnvironment: boolean
  }>({
    minecraftVersion: "1.21.1",
    neoForgeVersion: "21.1.65",
    isPublishedEnvironment: true,
  })

  // Selected item detail and installation state
  const [selectedMod, setSelectedMod] = useState<ModSearchResultItem | null>(null)
  const [modDetail, setModDetail] = useState<ModProjectDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [selectedVersionId, setSelectedVersionId] = useState<string>("")
  const [plan, setPlan] = useState<ServerContentInstallationPlan | null>(null)
  const [resolvingPlan, setResolvingPlan] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [installError, setInstallError] = useState<string | null>(null)

  const debounceTimer = useRef<NodeJS.Timeout | null>(null)
  const requestIdRef = useRef(0)

  const executeSearch = (
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
      .searchServerContent(searchQuery, contentType, providerArg, PAGE_SIZE, currentOffset, searchCursor)
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
            neoForgeVersion: payload.neoForgeVersion,
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
  }

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
  }, [selectedContentType, selectedProviderTab])

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

  // When a mod is selected, load detail
  const handleSelectMod = async (mod: ModSearchResultItem) => {
    setSelectedMod(mod)
    setModDetail(null)
    setPlan(null)
    setInstallError(null)
    setLoadingDetail(true)

    try {
      const detail = await graphqlClient.getServerContentProjectDetail(
        mod.provider,
        mod.projectId,
        mod.contentType || selectedContentType,
      )
      setModDetail(detail)

      if (detail.compatibleVersions && detail.compatibleVersions.length > 0) {
        const firstVer = detail.compatibleVersions[0]!
        setSelectedVersionId(firstVer.id)
        resolvePlanForVersion(mod.provider, mod.projectId, firstVer.id, mod.contentType || selectedContentType)
      }
    } catch (err: any) {
      setInstallError(err.message || "Error al cargar los detalles del contenido.")
    } finally {
      setLoadingDetail(false)
    }
  }

  const resolvePlanForVersion = async (
    provider: ModProvider,
    projectId: string,
    versionId: string,
    contentType: ContentType,
  ) => {
    setResolvingPlan(true)
    setInstallError(null)
    try {
      const resolvedPlan = await graphqlClient.resolveServerContentPlan({
        provider,
        projectId,
        versionId,
        contentType,
      })
      setPlan(resolvedPlan)
    } catch (err: any) {
      setInstallError(err.message || "Error al calcular el plan de instalación.")
    } finally {
      setResolvingPlan(false)
    }
  }

  const handleVersionChange = (newVersionId: string) => {
    setSelectedVersionId(newVersionId)
    if (selectedMod) {
      resolvePlanForVersion(selectedMod.provider, selectedMod.projectId, newVersionId, selectedMod.contentType || selectedContentType)
    }
  }

  const handleInstall = async () => {
    if (!selectedMod || !selectedVersionId || !plan?.isValid) return
    setInstalling(true)
    setInstallError(null)

    try {
      await graphqlClient.installServerContentPlan({
        provider: selectedMod.provider,
        projectId: selectedMod.projectId,
        versionId: selectedVersionId,
        contentType: selectedMod.contentType || selectedContentType,
      })
      onSuccess()
      onClose()
    } catch (err: any) {
      setInstallError(err.message || "Error al instalar el contenido en el servidor.")
    } finally {
      setInstalling(false)
    }
  }

  const failedProviders = providerStatuses.filter((s) => !s.available && s.error)

  return (
    <div
      data-testid="server-mod-search-modal"
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.8)",
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
          backgroundColor: "#111827",
          border: "1px solid rgba(255, 255, 255, 0.12)",
          borderRadius: "16px",
          width: "100%",
          maxWidth: "1050px",
          height: "85vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.7)",
        }}
      >
        {/* Top Header */}
        <div
          style={{
            padding: "20px 24px",
            borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
            display: "flex",
            flexDirection: "column",
            gap: "14px",
            background: "rgba(255, 255, 255, 0.02)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <h2 style={{ margin: 0, fontSize: "20px", fontWeight: "700", color: "#f9fafb" }}>
                Añadir Contenido al Servidor
              </h2>
              <div
                data-testid="server-compatible-env-indicator"
                style={{ fontSize: "13px", color: "#9ca3af", marginTop: "2px" }}
              >
                Entorno de ejecución:{" "}
                <span style={{ color: "#34d399", fontWeight: "600" }}>
                  Minecraft {envInfo.minecraftVersion}
                </span>
                {selectedContentType === "MOD" && (
                  <>
                    {" "}·{" "}
                    <span style={{ color: "#60a5fa", fontWeight: "600" }}>
                      NeoForge {envInfo.neoForgeVersion}
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
                color: "#9ca3af",
                fontSize: "24px",
                cursor: "pointer",
                padding: "4px 8px",
                borderRadius: "6px",
              }}
            >
              ✕
            </button>
          </div>

          {/* Content Type Selector: MOD (Server) vs DATA_PACK */}
          <div
            style={{
              display: "flex",
              gap: "8px",
              borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
              paddingBottom: "8px",
              flexWrap: "wrap",
            }}
          >
            {[
              { type: "MOD" as ContentType, label: "Mods de Servidor (Solo Server)", testId: "server-tab-content-mod" },
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
                    background: isSelected ? "rgba(59, 130, 246, 0.2)" : "rgba(255, 255, 255, 0.04)",
                    color: isSelected ? "#60a5fa" : "#9ca3af",
                    border: `1px solid ${isSelected ? "rgba(59, 130, 246, 0.4)" : "rgba(255, 255, 255, 0.08)"}`,
                    borderRadius: "8px",
                    fontSize: "13px",
                    fontWeight: isSelected ? "600" : "500",
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
                placeholder={`Buscar ${selectedContentType === "MOD" ? "mods de servidor" : "data packs"} en Modrinth y CurseForge...`}
                style={{
                  width: "100%",
                  padding: "10px 16px 10px 38px",
                  background: "rgba(0, 0, 0, 0.4)",
                  border: "1px solid rgba(255, 255, 255, 0.12)",
                  borderRadius: "10px",
                  color: "#f3f4f6",
                  fontSize: "14px",
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
              <span
                style={{
                  position: "absolute",
                  left: "14px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "#6b7280",
                  fontSize: "14px",
                }}
              >
                🔍
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
              }}
            >
              ⚠️ Mostrando resultados de proveedores disponibles.
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
              borderRight: selectedMod ? "1px solid rgba(255, 255, 255, 0.08)" : "none",
            }}
          >
            {loading ? (
              <div style={{ textAlign: "center", padding: "60px 0", color: "#9ca3af" }}>
                <div style={{ fontSize: "28px", marginBottom: "12px" }}>⏳</div>
                Buscando contenido de servidor compatible...
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
              <div style={{ textAlign: "center", padding: "60px 0", color: "#6b7280" }}>
                <div style={{ fontSize: "36px", marginBottom: "12px" }}>🔍</div>
                <div style={{ fontSize: "16px", color: "#9ca3af", marginBottom: "4px" }}>
                  No se encontraron resultados de servidor
                </div>
                <div style={{ fontSize: "13px" }}>
                  {selectedContentType === "MOD"
                    ? "Solo se muestran mods marcados exclusivamente para el servidor."
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

                    return (
                      <div
                        key={`${item.provider}:${item.projectId}`}
                        onClick={() => handleSelectMod(item)}
                        style={{
                          padding: "14px",
                          borderRadius: "12px",
                          background: isSelected ? "rgba(59, 130, 246, 0.15)" : "rgba(255, 255, 255, 0.03)",
                          border: `1px solid ${isSelected ? "rgba(59, 130, 246, 0.4)" : "rgba(255, 255, 255, 0.08)"}`,
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
                              background: "rgba(255,255,255,0.06)",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: "20px",
                            }}
                          >
                            📦
                          </div>
                        )}

                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
                            <span style={{ fontSize: "14px", fontWeight: "700", color: "#f9fafb", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {item.name}
                            </span>
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

                  {/* BOTH Mod Guard Alert */}
                  {modDetail.environment === "BOTH" ? (
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
                        <span style={{ fontSize: "20px" }}>ℹ️</span>
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
                            onNavigateToGame()
                          }}
                          style={{
                            alignSelf: "flex-start",
                            padding: "8px 16px",
                            background: "#f59e0b",
                            color: "#000000",
                            border: "none",
                            borderRadius: "8px",
                            fontWeight: "700",
                            fontSize: "13px",
                            cursor: "pointer",
                          }}
                        >
                          Añadir desde Actualizaciones →
                        </button>
                      )}
                    </div>
                  ) : (
                    <>
                      {/* Version selector */}
                      <div>
                        <label style={{ display: "block", fontSize: "13px", fontWeight: "600", color: "#e5e7eb", marginBottom: "6px" }}>
                          Versión compatible para servidor:
                        </label>
                        {modDetail.compatibleVersions && modDetail.compatibleVersions.length > 0 ? (
                          <select
                            data-testid="select-server-version"
                            value={selectedVersionId}
                            onChange={(e) => handleVersionChange(e.target.value)}
                            style={{
                              width: "100%",
                              padding: "10px 14px",
                              background: "#1f2937",
                              border: "1px solid rgba(255, 255, 255, 0.15)",
                              borderRadius: "8px",
                              color: "#f3f4f6",
                              fontSize: "13px",
                              outline: "none",
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
                        <div style={{ color: "#9ca3af", fontSize: "13px", textAlign: "center", padding: "20px 0" }}>
                          Calculando dependencias y destino físico...
                        </div>
                      ) : plan ? (
                        <div
                          style={{
                            padding: "14px",
                            borderRadius: "10px",
                            background: "rgba(255, 255, 255, 0.04)",
                            border: "1px solid rgba(255, 255, 255, 0.08)",
                          }}
                        >
                          <div style={{ fontSize: "13px", fontWeight: "700", color: "#e5e7eb", marginBottom: "10px" }}>
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
                                borderBottom: "1px solid rgba(255, 255, 255, 0.04)",
                              }}
                            >
                              <div>
                                <span style={{ color: "#f9fafb", fontWeight: "600" }}>{pi.projectName}</span>{" "}
                                <span style={{ color: "#9ca3af" }}>({pi.versionNumber})</span>
                                <div style={{ color: "#60a5fa", fontSize: "11px", fontFamily: "monospace" }}>
                                  /{pi.targetPath}
                                </div>
                              </div>
                              <span
                                style={{
                                  fontSize: "11px",
                                  padding: "2px 6px",
                                  borderRadius: "4px",
                                  background: pi.action === "INSTALL" ? "rgba(34, 197, 94, 0.2)" : "rgba(59, 130, 246, 0.2)",
                                  color: pi.action === "INSTALL" ? "#4ade80" : "#60a5fa",
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
                          style={{
                            padding: "8px 16px",
                            borderRadius: "8px",
                            border: "1px solid rgba(255, 255, 255, 0.15)",
                            background: "transparent",
                            color: "#e5e7eb",
                            fontSize: "13px",
                            cursor: "pointer",
                          }}
                        >
                          Cancelar
                        </button>

                        <button
                          type="button"
                          data-testid="button-install-server-content"
                          onClick={handleInstall}
                          disabled={installing || !plan?.isValid || plan?.conflicts?.length > 0}
                          style={{
                            padding: "8px 20px",
                            borderRadius: "8px",
                            border: "none",
                            background: installing || !plan?.isValid ? "#4b5563" : "#3b82f6",
                            color: "#ffffff",
                            fontSize: "13px",
                            fontWeight: "700",
                            cursor: installing || !plan?.isValid ? "not-allowed" : "pointer",
                          }}
                        >
                          {installing ? "Instalando en servidor..." : "Instalar en servidor"}
                        </button>
                      </div>
                    </>
                  )}
                </>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
