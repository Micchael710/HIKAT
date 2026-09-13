import React, { useState, useEffect, useRef, useCallback } from "react"
import type {
  ModProvider,
  ModSearchResultItem,
  ModProviderStatus,
  ContentType,
  ThemeMode,
  QueuedModSelection,
  GameModLoader,
  ModCategoryItem,
} from "../../../types"
import { graphqlClient } from "../../../services/graphqlClient"
import { getThemeTokens } from "../../../theme/tokens"
import { IconSearch, IconSpinner, IconWarning } from "../../../theme/icons"
import { ModCard } from "./ModCard"
import { ModDetailModal } from "./ModDetailModal"
import { ModSearchFilterBar } from "./ModSearchFilterBar"
import { QueuedItemsBar } from "./QueuedItemsBar"

interface ModSearchModalProps {
  serverId: string
  onClose: () => void
  onSuccess: () => void
  theme?: ThemeMode
  handoff?: import("../../../types").GameHandoffPayload | null
  onClearHandoff?: () => void
}

const PAGE_SIZE = 20

export const ModSearchModal: React.FC<ModSearchModalProps> = ({
  serverId,
  onClose,
  onSuccess,
  theme = "dark",
  handoff,
  onClearHandoff,
}) => {
  const isDark = theme === "dark"
  const tokens = getThemeTokens(theme)

  const [query, setQuery] = useState("")
  const [selectedContentType, setSelectedContentType] = useState<ContentType>("MOD")
  const [selectedProviderTab, setSelectedProviderTab] = useState<ModProvider | "ALL">("ALL")
  const [selectedLoader, setSelectedLoader] = useState<GameModLoader>("NEOFORGE")
  const [selectedCategoryKey, setSelectedCategoryKey] = useState<string>("")
  const [categories, setCategories] = useState<ModCategoryItem[]>([])
  const [loadingCategories, setLoadingCategories] = useState(false)

  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [results, setResults] = useState<ModSearchResultItem[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [offset, setOffset] = useState(0)
  const [providerStatuses, setProviderStatuses] = useState<ModProviderStatus[]>([])
  const [selectedMod, setSelectedMod] = useState<ModSearchResultItem | null>(null)
  const [queuedSelections, setQueuedSelections] = useState<QueuedModSelection[]>([])
  const [installingBatch, setInstallingBatch] = useState(false)
  const [batchError, setBatchError] = useState<string | null>(null)
  const [handoffDetail, setHandoffDetail] = useState<{
    provider: ModProvider
    projectId: string
    contentType: ContentType
    initialVersionId?: string
    initialEnvironmentOverride?: import("../../../types").ModEnvironment
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [envInfo, setEnvInfo] = useState<{
    minecraftVersion: string
    modLoader: GameModLoader
    modLoaderVersion: string | null | undefined
  }>({
    minecraftVersion: "1.21.1",
    modLoader: "NEOFORGE",
    modLoaderVersion: null,
  })

  const debounceTimer = useRef<NodeJS.Timeout | null>(null)
  const requestIdRef = useRef(0)

  // Fetch categories when contentType changes
  useEffect(() => {
    let active = true
    setLoadingCategories(true)
    setSelectedCategoryKey("")

    graphqlClient
      .getModCategories(selectedContentType)
      .then((items) => {
        if (!active) return
        setCategories(items)
        setLoadingCategories(false)
      })
      .catch(() => {
        if (!active) return
        setCategories([])
        setLoadingCategories(false)
      })

    return () => {
      active = false
    }
  }, [selectedContentType])

  const executeSearch = useCallback((
    searchQuery: string,
    contentType: ContentType,
    providerTab: ModProvider | "ALL",
    currentOffset: number = 0,
    isLoadMore: boolean = false,
    catKey: string = selectedCategoryKey,
    loader: GameModLoader = selectedLoader,
  ) => {
    const currentReqId = ++requestIdRef.current

    if (isLoadMore) {
      setLoadingMore(true)
    } else {
      setLoading(true)
      setError(null)
    }

    const providerArg = providerTab === "ALL" ? null : providerTab
    const isCustomLoader = loader && loader !== envInfo.modLoader

    const searchPromise = (catKey || isCustomLoader)
      ? graphqlClient.searchMods(
          searchQuery,
          contentType,
          providerArg,
          PAGE_SIZE,
          currentOffset,
          serverId,
          isCustomLoader ? loader : null,
          catKey || null,
        )
      : graphqlClient.searchMods(
          searchQuery,
          contentType,
          providerArg,
          PAGE_SIZE,
          currentOffset,
          serverId,
        )

    searchPromise
      .then((payload) => {
        if (currentReqId !== requestIdRef.current) return

        if (isLoadMore) {
          setResults((prev) => [...prev, ...(payload.items || [])])
        } else {
          setResults(payload.items || [])
        }

        setTotalCount(payload.totalCount || 0)
        setProviderStatuses(payload.providersStatus || [])
        if (payload.minecraftVersion) {
          setEnvInfo({
            minecraftVersion: payload.minecraftVersion,
            modLoader: payload.modLoader || "NEOFORGE",
            modLoaderVersion: payload.modLoaderVersion ?? null,
          })
          if (!selectedLoader && payload.modLoader) {
            setSelectedLoader(payload.modLoader)
          }
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
  }, [serverId, selectedCategoryKey, selectedLoader])

  // When handoff is provided from Server View, preselect tab and open ModDetailModal directly
  useEffect(() => {
    if (handoff) {
      if (handoff.contentType) {
        setSelectedContentType(handoff.contentType)
      }
      if (handoff.provider) {
        setSelectedProviderTab(handoff.provider)
      }
      setHandoffDetail({
        provider: handoff.provider,
        projectId: handoff.projectId,
        contentType: handoff.contentType || "MOD",
        initialVersionId: handoff.versionId,
        initialEnvironmentOverride: handoff.environmentOverride,
      })
      onClearHandoff?.()
    }
  }, [handoff, onClearHandoff])

  // Clear debounce and trigger search on filter changes
  useEffect(() => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current)
      debounceTimer.current = null
    }
    setOffset(0)
    executeSearch(query, selectedContentType, selectedProviderTab, 0, false, selectedCategoryKey, selectedLoader)

    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current)
        debounceTimer.current = null
      }
    }
  }, [selectedContentType, selectedProviderTab, selectedCategoryKey, selectedLoader, executeSearch])

  // Clean up on component unmount
  useEffect(() => {
    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current)
        debounceTimer.current = null
      }
      requestIdRef.current++
    }
  }, [])

  const handleQueryChange = (val: string) => {
    setQuery(val)
    setOffset(0)

    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current)
    }
    debounceTimer.current = setTimeout(() => {
      executeSearch(val, selectedContentType, selectedProviderTab, 0, false, selectedCategoryKey, selectedLoader)
    }, 350)
  }

  const handleLoadMore = () => {
    const nextOffset = offset + PAGE_SIZE
    setOffset(nextOffset)
    executeSearch(query, selectedContentType, selectedProviderTab, nextOffset, true, selectedCategoryKey, selectedLoader)
  }

  const handleConfirmBatchInstall = async () => {
    if (queuedSelections.length === 0 || installingBatch) return
    try {
      setInstallingBatch(true)
      setBatchError(null)

      await graphqlClient.installModPlansBatch(
        {
          plans: queuedSelections.map((sel) => ({
            provider: sel.provider,
            projectId: sel.projectId,
            versionId: sel.versionId,
            contentType: sel.contentType,
            manualOverrides: sel.manualOverrides,
            environmentOverride: sel.environmentOverride,
            loaderOverride: sel.loaderOverride,
          })),
        },
        serverId,
      )

      setQueuedSelections([])
      onSuccess()
      onClose()
    } catch (err: any) {
      setBatchError(err.message || "Error al instalar los contenidos seleccionados.")
    } finally {
      setInstallingBatch(false)
    }
  }

  const failedProviders = providerStatuses.filter((s) => !s.available && s.error)
  const hasMore = results.length < totalCount

  return (
    <div
      data-testid="mod-search-modal"
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
          borderRadius: "20px",
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
            padding: "20px 24px 14px",
            borderBottom: `1px solid ${tokens.borderSubtle}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: tokens.bgCardInner,
          }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: "20px", fontWeight: "800", color: tokens.textPrimary }}>
              Añadir Contenido
            </h2>
            <div
              data-testid="compatible-env-indicator"
              style={{ fontSize: "13px", color: tokens.textSecondary, marginTop: "2px" }}
            >
              Compatible con{" "}
              <span style={{ color: "#34d399", fontWeight: "700" }}>
                Minecraft {envInfo.minecraftVersion}
              </span>
              {selectedContentType === "MOD" && (
                <>
                  {" "}·{" "}
                  <span style={{ color: "#60a5fa", fontWeight: "700" }}>
                    {selectedLoader === "NEOFORGE"
                      ? "NeoForge"
                      : selectedLoader === "FORGE"
                      ? "Forge"
                      : selectedLoader === "FABRIC"
                      ? "Fabric"
                      : selectedLoader === "QUILT"
                      ? "Quilt"
                      : selectedLoader}
                  </span>
                </>
              )}
            </div>
          </div>

          <button
            type="button"
            data-testid="button-close-search"
            onClick={onClose}
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

        {/* Filter Bar */}
        <ModSearchFilterBar
          mode="RELEASE"
          query={query}
          onQueryChange={handleQueryChange}
          selectedProvider={selectedProviderTab}
          onProviderChange={(p) => setSelectedProviderTab(p)}
          selectedContentType={selectedContentType}
          onContentTypeChange={(ct) => setSelectedContentType(ct)}
          selectedLoader={selectedLoader}
          onLoaderChange={(ldr) => setSelectedLoader(ldr)}
          selectedCategoryKey={selectedCategoryKey}
          onCategoryChange={(cat) => setSelectedCategoryKey(cat)}
          categories={categories}
          loadingCategories={loadingCategories}
          theme={theme}
        />

        {/* Partial degradation notification */}
        {failedProviders.length > 0 && selectedProviderTab === "ALL" && (
          <div
            data-testid="provider-partial-failure-notice"
            style={{
              padding: "8px 16px",
              background: "rgba(234, 179, 8, 0.12)",
              borderBottom: "1px solid rgba(234, 179, 8, 0.25)",
              color: isDark ? "#fde047" : "#b45309",
              fontSize: "12px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <IconWarning size={16} />
            <div>
              {failedProviders.map((p) => (
                <span key={p.provider}>
                  <strong>{p.provider}:</strong> {p.error}{" "}
                </span>
              ))}
              (Mostrando resultados disponibles de los demás proveedores).
            </div>
          </div>
        )}

        {/* Results Grid Container */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }} className="custom-scroll">
          {loading ? (
            <div style={{ textAlign: "center", padding: "60px 0", color: tokens.textMuted, display: "flex", flexDirection: "column", alignItems: "center", gap: "10px" }}>
              <IconSpinner size={32} />
              <span>Buscando contenido compatible en los repositorios...</span>
            </div>
          ) : error ? (
            <div
              style={{
                padding: "16px",
                background: "rgba(239, 68, 68, 0.12)",
                border: "1px solid rgba(239, 68, 68, 0.25)",
                borderRadius: "10px",
                color: "#ef4444",
                fontSize: "14px",
                textAlign: "center",
              }}
            >
              {error}
            </div>
          ) : results.length === 0 ? (
            <div style={{ textAlign: "center", padding: "60px 0", color: tokens.textMuted, display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}>
              <IconSearch size={36} style={{ color: tokens.textMuted, opacity: 0.5, marginBottom: "4px" }} />
              <div style={{ fontSize: "16px", color: tokens.textPrimary, fontWeight: "700", marginBottom: "4px" }}>
                No se encontraron resultados
              </div>
              <div style={{ fontSize: "13px", color: tokens.textSecondary }}>
                Intenta buscar por otro nombre o revisa los filtros de categoría, loader y proveedor.
              </div>
            </div>
          ) : (
            <div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                  gap: "16px",
                  marginBottom: "20px",
                }}
              >
                {results.map((mod) => (
                  <ModCard
                    key={`${mod.provider}:${mod.projectId}`}
                    mod={mod}
                    theme={theme}
                    onSelect={(selected) => setSelectedMod(selected)}
                  />
                ))}
              </div>

              {hasMore && (
                <div style={{ textAlign: "center", padding: "16px 0" }}>
                  <button
                    type="button"
                    data-testid="button-load-more"
                    onClick={handleLoadMore}
                    disabled={loadingMore}
                    className="launcher-btn-secondary"
                    style={{
                      padding: "10px 24px",
                      fontSize: "14px",
                    }}
                  >
                    {loadingMore ? "Cargando más..." : `Cargar más (${results.length} de ${totalCount})`}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Queued Items Floating Bar */}
        <QueuedItemsBar
          mode="RELEASE"
          queuedItems={queuedSelections}
          onRemoveItem={(pid) =>
            setQueuedSelections((prev) => prev.filter((x) => x.projectId !== pid))
          }
          onConfirmInstall={handleConfirmBatchInstall}
          installing={installingBatch}
          batchError={batchError}
          theme={theme}
        />
      </div>

      {/* Selected Mod Detail Modal */}
      {(selectedMod || handoffDetail) && (
        <ModDetailModal
          serverId={serverId}
          provider={selectedMod?.provider || handoffDetail!.provider}
          projectId={selectedMod?.projectId || handoffDetail!.projectId}
          contentType={selectedMod ? (selectedMod.contentType || selectedContentType) : handoffDetail!.contentType}
          initialVersionId={handoffDetail?.initialVersionId}
          initialEnvironmentOverride={handoffDetail?.initialEnvironmentOverride}
          theme={theme}
          mode="RELEASE"
          loaderOverride={selectedLoader !== envInfo.modLoader ? selectedLoader : undefined}
          onQueueMod={(item) => {
            setQueuedSelections((prev) => [
              ...prev.filter(
                (x) =>
                  !(
                    x.provider === item.provider &&
                    x.projectId === item.projectId &&
                    x.contentType === item.contentType
                  ),
              ),
              {
                ...item,
                loaderOverride: item.loaderOverride || selectedLoader,
              },
            ])
          }}
          onClose={() => {
            setSelectedMod(null)
            setHandoffDetail(null)
          }}
          onSuccess={() => {
            setSelectedMod(null)
            setHandoffDetail(null)
            onClose()
            onSuccess()
          }}
        />
      )}
    </div>
  )
}
