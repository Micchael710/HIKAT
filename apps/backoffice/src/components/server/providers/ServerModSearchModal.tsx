import React, { useState, useEffect, useCallback, useRef } from "react"
import type {
  ModProvider,
  ModSearchResultItem,
  ModProviderStatus,
  ContentType,
  ThemeMode,
  GameModLoader,
  ModCategoryItem,
  QueuedServerContentSelection,
  GameHandoffPayload,
} from "../../../types"
import { graphqlClient } from "../../../services/graphqlClient"
import { getThemeTokens } from "../../../theme/tokens"
import { IconSearch, IconSpinner, IconAlertCircle, IconCross } from "../../../theme/icons"
import { ModCard } from "../../game/providers/ModCard"
import { ModDetailModal } from "../../game/providers/ModDetailModal"
import { ModSearchFilterBar } from "../../game/providers/ModSearchFilterBar"
import { QueuedItemsBar } from "../../game/providers/QueuedItemsBar"

interface ServerModSearchModalProps {
  serverId: string
  theme?: ThemeMode
  onClose: () => void
  onSuccess: () => void
  onNavigateToGame?: (handoff?: GameHandoffPayload) => void
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
  const [userSelectedLoader, setUserSelectedLoader] = useState<GameModLoader | null>(null)
  const [selectedCategoryKey, setSelectedCategoryKey] = useState<string>("")
  const [categories, setCategories] = useState<ModCategoryItem[]>([])
  const [loadingCategories, setLoadingCategories] = useState(false)

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
    modLoader: GameModLoader
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

  const selectedLoader: GameModLoader = userSelectedLoader || envInfo.modLoader

  // Selected item detail state (opens ModDetailModal)
  const [selectedMod, setSelectedMod] = useState<ModSearchResultItem | null>(null)

  // Queue state for batch installation (Workers Free sequential individual execution)
  const [queuedSelections, setQueuedSelections] = useState<QueuedServerContentSelection[]>([])
  const [batchInstalling, setBatchInstalling] = useState(false)
  const [batchError, setBatchError] = useState<string | null>(null)
  const [installProgress, setInstallProgress] = useState<{ current: number; total: number } | null>(null)

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
    searchCursor: string | null = null,
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
    const isCustomLoader = Boolean(loader && loader !== envInfo.modLoader)

    // Call searchServerContent. If categoryKey or custom loader override, pass them.
    const searchPromise =
      catKey || isCustomLoader
        ? graphqlClient.searchServerContent(
            searchQuery,
            contentType,
            providerArg,
            PAGE_SIZE,
            currentOffset,
            searchCursor,
            serverId,
            isCustomLoader ? loader : null,
            catKey || null,
          )
        : graphqlClient.searchServerContent(
            searchQuery,
            contentType,
            providerArg,
            PAGE_SIZE,
            currentOffset,
            searchCursor,
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
  }, [serverId, selectedCategoryKey, selectedLoader, envInfo.modLoader])

  // Trigger search on filter changes
  useEffect(() => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current)
      debounceTimer.current = null
    }
    setOffset(0)
    setCursor(null)
    executeSearch(
      query,
      selectedContentType,
      selectedProviderTab,
      0,
      null,
      false,
      selectedCategoryKey,
      selectedLoader,
    )

    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current)
        debounceTimer.current = null
      }
    }
  }, [
    selectedContentType,
    selectedProviderTab,
    selectedCategoryKey,
    selectedLoader,
    serverId,
    executeSearch,
  ])

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

  const handleQueryChange = (val: string) => {
    setQuery(val)
    setOffset(0)
    setCursor(null)

    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current)
    }
    debounceTimer.current = setTimeout(() => {
      executeSearch(
        val,
        selectedContentType,
        selectedProviderTab,
        0,
        null,
        false,
        selectedCategoryKey,
        selectedLoader,
      )
    }, 350)
  }

  const handleLoadMore = () => {
    if (!cursor || !hasMore || loadingMore) return
    const nextOffset = offset + PAGE_SIZE
    setOffset(nextOffset)
    executeSearch(
      query,
      selectedContentType,
      selectedProviderTab,
      nextOffset,
      cursor,
      true,
      selectedCategoryKey,
      selectedLoader,
    )
  }

  const handleAddToQueue = (item: QueuedServerContentSelection) => {
    setQueuedSelections((prev) => {
      const existingIndex = prev.findIndex(
        (q) => q.provider === item.provider && q.projectId === item.projectId,
      )
      if (existingIndex >= 0) {
        const updated = [...prev]
        updated[existingIndex] = item
        return updated
      }
      return [...prev, item]
    })
    setSelectedMod(null)
  }

  const handleRemoveFromQueue = (projectId: string) => {
    setQueuedSelections((prev) => prev.filter((item) => item.projectId !== projectId))
  }

  // Sequential individual execution for Workers Free
  const handleConfirmBatch = async () => {
    if (queuedSelections.length === 0 || batchInstalling) return
    setBatchInstalling(true)
    setBatchError(null)

    const items = [...queuedSelections]
    const total = items.length

    for (let i = 0; i < total; i++) {
      const item = items[i]!
      setInstallProgress({ current: i + 1, total })

      try {
        await graphqlClient.installServerContentPlan(
          {
            provider: item.provider,
            projectId: item.projectId,
            versionId: item.versionId,
            contentType: item.contentType,
            environmentOverride: item.environmentOverride || undefined,
            ...(item.loaderOverride ? { loaderOverride: item.loaderOverride } : {}),
          },
          serverId,
        )

        // Successfully installed item i; remove it from queue so completed items don't remain
        setQueuedSelections((prev) =>
          prev.filter(
            (q) => !(q.provider === item.provider && q.projectId === item.projectId),
          ),
        )
      } catch (err: any) {
        // Items 0..i-1 remain installed, item i failed -> stop, remaining items stay in queue
        const baseMsg = err.message || `Error al instalar ${item.projectName}.`
        const message =
          i > 0
            ? `${i} de ${total} elementos se instalaron correctamente antes del error. ${baseMsg}`
            : baseMsg
        setBatchError(message)
        setBatchInstalling(false)
        setInstallProgress(null)
        return
      }
    }

    setBatchInstalling(false)
    setInstallProgress(null)
    setQueuedSelections([])
    onSuccess()
    onClose()
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
            padding: "20px 24px 14px",
            borderBottom: `1px solid ${tokens.borderSubtle}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: tokens.bgCardInner,
          }}
        >
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
                    {selectedLoader || envInfo.modLoader}
                    {envInfo.modLoaderVersion ? ` ${envInfo.modLoaderVersion}` : ""}
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

        {/* Filter Bar */}
        <ModSearchFilterBar
          mode="SERVER"
          query={query}
          onQueryChange={handleQueryChange}
          selectedProvider={selectedProviderTab}
          onProviderChange={(p) => setSelectedProviderTab(p)}
          selectedContentType={selectedContentType}
          onContentTypeChange={(ct) => setSelectedContentType(ct)}
          selectedLoader={selectedLoader}
          onLoaderChange={(ldr) => setUserSelectedLoader(ldr)}
          selectedCategoryKey={selectedCategoryKey}
          onCategoryChange={(cat) => setSelectedCategoryKey(cat)}
          categories={categories}
          loadingCategories={loadingCategories}
          theme={theme}
        />

        {/* Partial Provider Failure Warning */}
        {failedProviders.length > 0 && selectedProviderTab === "ALL" && (
          <div
            style={{
              padding: "8px 16px",
              background: "rgba(234, 179, 8, 0.1)",
              borderBottom: "1px solid rgba(234, 179, 8, 0.2)",
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

        {/* Content Body: Results Grid */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }} className="custom-scroll">
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
                  gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                  gap: "14px",
                  marginBottom: "16px",
                }}
              >
                {results.map((item) => (
                  <ModCard
                    key={`${item.provider}:${item.projectId}`}
                    mod={item}
                    theme={theme}
                    onSelect={(selected) => setSelectedMod(selected)}
                  />
                ))}
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

        {/* Bottom Queue Summary Bar */}
        <QueuedItemsBar
          mode="SERVER"
          queuedItems={queuedSelections}
          onRemoveItem={(pid) => handleRemoveFromQueue(pid)}
          onConfirmInstall={handleConfirmBatch}
          installing={batchInstalling}
          installProgress={installProgress}
          batchError={batchError}
          theme={theme}
        />
      </div>

      {/* Detail Modal (Shared ModDetailModal configured for SERVER mode) */}
      {selectedMod && (
        <ModDetailModal
          serverId={serverId}
          provider={selectedMod.provider}
          projectId={selectedMod.projectId}
          contentType={selectedMod.contentType || selectedContentType}
          theme={theme}
          mode="SERVER"
          loaderOverride={selectedLoader !== envInfo.modLoader ? selectedLoader : undefined}
          onClose={() => setSelectedMod(null)}
          onSuccess={() => {
            setSelectedMod(null)
            onSuccess()
          }}
          onNavigateToGame={onNavigateToGame}
          onQueueServerMod={handleAddToQueue}
        />
      )}
    </div>
  )
}
