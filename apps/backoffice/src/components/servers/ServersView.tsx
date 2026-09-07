import React, { useState, useEffect, useCallback } from "react"
import type { ThemeMode, ServerItem } from "../../types"
import { serverApi } from "../../services/graphqlClient"
import CreateServerModal from "./CreateServerModal"
import DeleteServerModal from "./DeleteServerModal"
import {
  IconServer,
  IconPlus,
  IconRefresh,
  IconTrash,
  IconSpinner,
  IconSearch,
  IconAlertCircle,
  IconCheck,
  IconWarning,
  IconCpu,
  IconRam,
  IconDisk,
} from "../../theme/icons"

interface ServersViewProps {
  theme: ThemeMode
  onSelectServer: (server: ServerItem) => void
}

export default function ServersView({
  theme,
  onSelectServer,
}: ServersViewProps) {
  const isDark = theme === "dark"

  const [servers, setServers] = useState<ServerItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")

  // Modals
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [serverToDelete, setServerToDelete] = useState<ServerItem | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const fetchServers = useCallback(async () => {
    setError(null)
    try {
      const data = await serverApi.getServers()
      setServers(data || [])
    } catch (err: any) {
      setError(err.message || "Error al cargar la lista de servidores.")
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchServers()
  }, [fetchServers])

  // Polling for servers in PROVISIONING state
  useEffect(() => {
    const hasProvisioning = servers.some((s) => s.provisioningStatus === "PROVISIONING")
    if (!hasProvisioning) return

    const timer = setInterval(() => {
      serverApi
        .getServers()
        .then((data) => {
          if (data) setServers(data)
        })
        .catch(() => {})
    }, 5000)

    return () => clearInterval(timer)
  }, [servers])

  const handleServerCreated = (newServer: ServerItem) => {
    setServers((prev) => [newServer, ...prev.filter((s) => s.id !== newServer.id)])
  }

  const handleDeleteConfirm = async (deletePterodactyl: boolean) => {
    if (!serverToDelete) return
    setIsDeleting(true)
    setError(null)
    try {
      await serverApi.deleteServer(serverToDelete.id, deletePterodactyl)
      setServers((prev) => prev.filter((s) => s.id !== serverToDelete.id))
      setServerToDelete(null)
    } catch (err: any) {
      setError(err.message || "Error al eliminar el servidor.")
    } finally {
      setIsDeleting(false)
    }
  }

  const filteredServers = servers.filter((s) => {
    if (!searchQuery.trim()) return true
    const q = searchQuery.toLowerCase()
    return (
      s.name.toLowerCase().includes(q) ||
      s.minecraftVersion.toLowerCase().includes(q) ||
      s.modLoader.toLowerCase().includes(q)
    )
  })

  return (
    <div
      style={{
        padding: "32px 36px",
        maxWidth: 1400,
        margin: "0 auto",
        display: "flex",
        flexDirection: "column",
        gap: 24,
      }}
    >
      {/* Top Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 16,
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h2
              style={{
                margin: 0,
                fontSize: 24,
                fontWeight: 800,
                color: isDark ? "#ffffff" : "#111822",
                letterSpacing: "-0.02em",
              }}
            >
              Servidores
            </h2>
            <span
              style={{
                fontSize: 12,
                fontWeight: 800,
                padding: "3px 8px",
                borderRadius: 8,
                background: "rgba(62, 196, 192, 0.15)",
                color: "#3ec4c0",
              }}
            >
              {servers.length} {servers.length === 1 ? "instancia" : "instancias"}
            </span>
          </div>
          <p
            style={{
              margin: "4px 0 0",
              fontSize: 14,
              color: isDark ? "rgba(255, 255, 255, 0.6)" : "#657788",
            }}
          >
            Gestiona los servidores de juego, instancias en Pterodactyl y espacios de trabajo.
          </p>
        </div>

        {/* Action Controls */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {/* Search Box */}
          <div
            style={{
              position: "relative",
              display: "flex",
              alignItems: "center",
            }}
          >
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar servidor..."
              style={{
                padding: "9px 14px 9px 34px",
                borderRadius: 12,
                border: isDark ? "1px solid rgba(255, 255, 255, 0.1)" : "1px solid rgba(0, 0, 0, 0.1)",
                background: isDark ? "#0d141a" : "#ffffff",
                color: isDark ? "#ffffff" : "#111822",
                fontSize: 13.5,
                width: 200,
                outline: "none",
              }}
            />
            <span
              style={{
                position: "absolute",
                left: 10,
                color: isDark ? "rgba(255, 255, 255, 0.4)" : "#8899a6",
                display: "flex",
                alignItems: "center",
                pointerEvents: "none",
              }}
            >
              <IconSearch size={15} />
            </span>
          </div>

          {/* Refresh Button */}
          <button
            type="button"
            onClick={fetchServers}
            disabled={isLoading}
            title="Refrescar lista"
            className="launcher-btn-secondary"
            style={{
              width: 38,
              height: 38,
              padding: 0,
              borderRadius: 12,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <IconRefresh size={16} />
          </button>

          {/* Create Server Button */}
          <button
            type="button"
            onClick={() => setIsCreateModalOpen(true)}
            className="launcher-btn-primary"
            style={{
              padding: "9px 18px",
              borderRadius: 12,
              fontSize: 14,
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <IconPlus size={16} />
            <span>Crear Servidor</span>
          </button>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div
          style={{
            padding: "12px 16px",
            borderRadius: 12,
            background: "rgba(255, 60, 40, 0.15)",
            border: "1.5px solid rgba(255, 60, 40, 0.3)",
            color: "#ff6b5b",
            fontSize: 13.5,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <IconAlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      {/* Content */}
      {isLoading ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "80px 0",
            gap: 14,
            color: isDark ? "rgba(255, 255, 255, 0.5)" : "#657788",
          }}
        >
          <IconSpinner size={32} />
          <span style={{ fontSize: 14, fontWeight: 600 }}>Cargando servidores...</span>
        </div>
      ) : filteredServers.length === 0 ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "70px 20px",
            background: isDark ? "rgba(18, 26, 34, 0.4)" : "#ffffff",
            borderRadius: 20,
            border: isDark
              ? "1.5px dashed rgba(255, 255, 255, 0.1)"
              : "1.5px dashed rgba(0, 0, 0, 0.1)",
            textAlign: "center",
            gap: 14,
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 16,
              background: "rgba(62, 196, 192, 0.12)",
              color: "#3ec4c0",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <IconServer size={28} />
          </div>
          <div>
            <h3
              style={{
                margin: 0,
                fontSize: 18,
                fontWeight: 700,
                color: isDark ? "#ffffff" : "#111822",
              }}
            >
              {searchQuery ? "No se encontraron servidores" : "No hay servidores registrados"}
            </h3>
            <p
              style={{
                margin: "6px 0 0",
                fontSize: 13.5,
                color: isDark ? "rgba(255, 255, 255, 0.5)" : "#657788",
                maxWidth: 420,
              }}
            >
              {searchQuery
                ? `No hay resultados para la búsqueda "${searchQuery}".`
                : "Crea tu primer servidor de juego para comenzar a gestionar noticias, actualizaciones y consola."}
            </p>
          </div>
          {!searchQuery && (
            <button
              type="button"
              onClick={() => setIsCreateModalOpen(true)}
              className="launcher-btn-primary"
              style={{
                marginTop: 6,
                padding: "10px 20px",
                borderRadius: 12,
                fontSize: 14,
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <IconPlus size={16} />
              <span>Crear Servidor</span>
            </button>
          )}
        </div>
      ) : (
        /* Servers Grid */
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))",
            gap: 22,
          }}
        >
          {filteredServers.map((server) => {
            const isReady = server.provisioningStatus === "READY"
            const isProvisioning = server.provisioningStatus === "PROVISIONING"
            const isFailed = server.provisioningStatus === "FAILED"
            const accent = server.accentColor || "#3ec4c0"

            return (
              <div
                key={server.id}
                style={{
                  background: isDark ? "#131d25" : "#ffffff",
                  borderRadius: 18,
                  overflow: "hidden",
                  border: isDark
                    ? "1.5px solid rgba(255, 255, 255, 0.08)"
                    : "1.5px solid rgba(0, 0, 0, 0.08)",
                  boxShadow: isDark
                    ? "0 12px 32px rgba(0, 0, 0, 0.3)"
                    : "0 8px 24px rgba(0, 0, 0, 0.05)",
                  display: "flex",
                  flexDirection: "column",
                  transition: "transform 0.18s ease, border-color 0.18s ease",
                  position: "relative",
                }}
              >
                {/* Server Banner Top */}
                <div
                  style={{
                    height: 100,
                    width: "100%",
                    background: server.mainLogo?.url
                      ? `url(${server.mainLogo.url}) center/cover no-repeat`
                      : `linear-gradient(135deg, ${accent}33 0%, ${accent}11 100%)`,
                    borderBottom: isDark
                      ? "1px solid rgba(255, 255, 255, 0.08)"
                      : "1px solid rgba(0, 0, 0, 0.08)",
                    position: "relative",
                  }}
                >
                  {/* Status Pill Badge */}
                  <div
                    style={{
                      position: "absolute",
                      top: 12,
                      right: 12,
                      display: "flex",
                      alignItems: "center",
                      gap: 5,
                      padding: "4px 9px",
                      borderRadius: 20,
                      fontSize: 11,
                      fontWeight: 800,
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                      background: isReady
                        ? "rgba(34, 197, 94, 0.9)"
                        : isProvisioning
                        ? "rgba(245, 166, 35, 0.9)"
                        : "rgba(239, 68, 68, 0.9)",
                      color: "#ffffff",
                      boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
                    }}
                  >
                    {isReady && <IconCheck size={12} />}
                    {isProvisioning && <IconSpinner size={12} />}
                    {isFailed && <IconWarning size={12} />}
                    <span>{isReady ? "Listo" : isProvisioning ? "Aprovisionando" : "Error"}</span>
                  </div>
                </div>

                {/* Server Body */}
                <div
                  style={{
                    padding: "16px 20px 20px",
                    display: "flex",
                    flexDirection: "column",
                    flex: 1,
                    gap: 14,
                  }}
                >
                  {/* Header info & Logo Square */}
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
                    <div
                      style={{
                        width: 52,
                        height: 52,
                        borderRadius: 14,
                        background: server.sidebarLogo?.url
                          ? `url(${server.sidebarLogo.url}) center/cover no-repeat`
                          : isDark
                          ? "#0d141a"
                          : "#f1f5f9",
                        border: `1.5px solid ${accent}`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: accent,
                        flexShrink: 0,
                        marginTop: -32,
                        boxShadow: "0 4px 12px rgba(0, 0, 0, 0.2)",
                      }}
                    >
                      {!server.sidebarLogo?.url && <IconServer size={24} />}
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <h3
                        style={{
                          margin: 0,
                          fontSize: 17,
                          fontWeight: 800,
                          color: isDark ? "#ffffff" : "#111822",
                          letterSpacing: "-0.01em",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {server.name}
                      </h3>
                      <p
                        style={{
                          margin: "3px 0 0",
                          fontSize: 12,
                          color: isDark ? "rgba(255, 255, 255, 0.45)" : "#657788",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          fontFamily: "monospace",
                        }}
                      >
                        HiKAT/games/{server.name}
                      </p>
                    </div>
                  </div>

                  {/* Environment Badges */}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    <span
                      style={{
                        fontSize: 11.5,
                        fontWeight: 700,
                        padding: "3px 8px",
                        borderRadius: 6,
                        background: isDark ? "rgba(255, 255, 255, 0.05)" : "#f1f5f9",
                        color: isDark ? "#ffffff" : "#111822",
                        border: isDark ? "1px solid rgba(255, 255, 255, 0.08)" : "1px solid #e2e8f0",
                      }}
                    >
                      MC {server.minecraftVersion}
                    </span>

                    <span
                      style={{
                        fontSize: 11.5,
                        fontWeight: 700,
                        padding: "3px 8px",
                        borderRadius: 6,
                        background: isDark ? "rgba(255, 255, 255, 0.05)" : "#f1f5f9",
                        color: isDark ? "#ffffff" : "#111822",
                        border: isDark ? "1px solid rgba(255, 255, 255, 0.08)" : "1px solid #e2e8f0",
                      }}
                    >
                      {server.modLoader} {server.modLoaderVersion ? `(${server.modLoaderVersion})` : ""}
                    </span>
                  </div>

                  {/* Resource Specs Footer */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "8px 12px",
                      borderRadius: 10,
                      background: isDark ? "rgba(0, 0, 0, 0.25)" : "#f8fafc",
                      fontSize: 11.5,
                      color: isDark ? "#94a3b8" : "#64748b",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <IconCpu size={14} />
                      <span>{server.cpu ? `${server.cpu}%` : "—"}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <IconRam size={14} />
                      <span>{server.memoryMb ? `${(server.memoryMb / 1024).toFixed(0)} GB` : "—"}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <IconDisk size={14} />
                      <span>{server.diskMb ? `${(server.diskMb / 1024).toFixed(0)} GB` : "—"}</span>
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      marginTop: "auto",
                      paddingTop: 6,
                    }}
                  >
                    <button
                      type="button"
                      disabled={!isReady}
                      onClick={() => onSelectServer(server)}
                      className="launcher-btn-primary"
                      style={{
                        flex: 1,
                        padding: "9px 14px",
                        borderRadius: 10,
                        fontSize: 13,
                        fontWeight: 700,
                        opacity: isReady ? 1 : 0.5,
                        cursor: isReady ? "pointer" : "not-allowed",
                      }}
                    >
                      {isReady ? "Gestionar servidor" : isProvisioning ? "Aprovisionando..." : "No disponible"}
                    </button>

                    <button
                      type="button"
                      onClick={() => setServerToDelete(server)}
                      title="Eliminar servidor"
                      className="launcher-btn-danger"
                      style={{
                        width: 36,
                        height: 36,
                        padding: 0,
                        borderRadius: 10,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <IconTrash size={15} />
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Create Modal */}
      <CreateServerModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onCreated={handleServerCreated}
        theme={theme}
      />

      {/* Delete Modal */}
      <DeleteServerModal
        server={serverToDelete}
        isOpen={Boolean(serverToDelete)}
        isLoading={isDeleting}
        onConfirm={handleDeleteConfirm}
        onClose={() => setServerToDelete(null)}
        theme={theme}
      />
    </div>
  )
}
