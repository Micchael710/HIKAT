import React, { useState, useEffect, useCallback } from "react"
import type {
  ThemeMode,
  SkinItem,
  AdminPlayerSkin,
  CapeItem,
  AdminPlayerCape,
} from "../../types"
import { skinsApi, capesApi } from "../../services/graphqlClient"
import {
  IconPlus,
  IconEdit,
  IconTrash,
  IconSpinner,
  IconShirt,
  IconEye,
  IconUser,
} from "../../theme/icons"
import SkinHeadPreview from "./SkinHeadPreview"
import SkinFormModal from "./SkinFormModal"
import DeleteSkinModal from "./DeleteSkinModal"
import PlayerSkinModal from "./PlayerSkinModal"
import DeletePlayerSkinModal from "./DeletePlayerSkinModal"
import CapeFormModal from "./CapeFormModal"
import DeleteCapeModal from "./DeleteCapeModal"
import PlayerCapeModal from "./PlayerCapeModal"
import DeletePlayerCapeModal from "./DeletePlayerCapeModal"
import LiveToast from "../common/LiveToast"
import BackofficeSelect, { SelectOption } from "../common/BackofficeSelect"

interface SkinsViewProps {
  theme: ThemeMode
}

const STATUS_FILTER_OPTIONS: SelectOption[] = [
  { value: "ALL", label: "Todos los estados" },
  { value: "AVAILABLE", label: "Disponibles" },
  { value: "UNAVAILABLE", label: "Ocultos" },
]

export default function SkinsView({ theme }: SkinsViewProps) {
  const isDark = theme === "dark"

  const [activeTab, setActiveTab] = useState<
    "skins_global" | "capes_global" | "skins_players" | "capes_players"
  >("skins_global")

  // Global Skins state
  const [skins, setSkins] = useState<SkinItem[]>([])
  const [isSkinsLoading, setIsSkinsLoading] = useState(true)
  const [skinsError, setSkinsError] = useState<string | null>(null)
  const [skinStatusFilter, setSkinStatusFilter] = useState<string>("ALL")
  const [skinModalMode, setSkinModalMode] = useState<"edit" | "view">("edit")
  const [isSkinFormOpen, setIsSkinFormOpen] = useState(false)
  const [activeSkin, setActiveSkin] = useState<SkinItem | null>(null)
  const [deleteSkinItem, setDeleteSkinItem] = useState<SkinItem | null>(null)

  // Global Capes state
  const [capes, setCapes] = useState<CapeItem[]>([])
  const [isCapesLoading, setIsCapesLoading] = useState(false)
  const [capesError, setCapesError] = useState<string | null>(null)
  const [capeStatusFilter, setCapeStatusFilter] = useState<string>("ALL")
  const [capeModalMode, setCapeModalMode] = useState<"edit" | "view">("edit")
  const [isCapeFormOpen, setIsCapeFormOpen] = useState(false)
  const [activeCape, setActiveCape] = useState<CapeItem | null>(null)
  const [deleteCapeItem, setDeleteCapeItem] = useState<CapeItem | null>(null)

  // Player Skins state
  const [playerSkins, setPlayerSkins] = useState<AdminPlayerSkin[]>([])
  const [isPlayerSkinsLoading, setIsPlayerSkinsLoading] = useState(false)
  const [playerSkinsError, setPlayerSkinsError] = useState<string | null>(null)
  const [playerSkinSearchQuery, setPlayerSkinSearchQuery] = useState<string>("")
  const [activePlayerSkin, setActivePlayerSkin] = useState<AdminPlayerSkin | null>(null)
  const [playerSkinModalMode, setPlayerSkinModalMode] = useState<"edit" | "view">("view")
  const [isPlayerSkinModalOpen, setIsPlayerSkinModalOpen] = useState(false)
  const [deletePlayerSkinItem, setDeletePlayerSkinItem] = useState<AdminPlayerSkin | null>(null)

  // Player Capes state
  const [playerCapes, setPlayerCapes] = useState<AdminPlayerCape[]>([])
  const [isPlayerCapesLoading, setIsPlayerCapesLoading] = useState(false)
  const [playerCapesError, setPlayerCapesError] = useState<string | null>(null)
  const [playerCapeSearchQuery, setPlayerCapeSearchQuery] = useState<string>("")
  const [activePlayerCape, setActivePlayerCape] = useState<AdminPlayerCape | null>(null)
  const [playerCapeModalMode, setPlayerCapeModalMode] = useState<"edit" | "view">("view")
  const [isPlayerCapeModalOpen, setIsPlayerCapeModalOpen] = useState(false)
  const [deletePlayerCapeItem, setDeletePlayerCapeItem] = useState<AdminPlayerCape | null>(null)

  const [toastMessage, setToastMessage] = useState<string | null>(null)

  // Load functions
  const fetchSkins = useCallback(async () => {
    setIsSkinsLoading(true)
    setSkinsError(null)
    try {
      const data = await skinsApi.getAdminSkins({ status: skinStatusFilter })
      setSkins(data?.items || [])
    } catch (err: any) {
      setSkinsError(err.message || "No se pudieron cargar las skins.")
    } finally {
      setIsSkinsLoading(false)
    }
  }, [skinStatusFilter])

  const fetchCapes = useCallback(async () => {
    setIsCapesLoading(true)
    setCapesError(null)
    try {
      const data = await capesApi.getAdminCapes({ status: capeStatusFilter })
      setCapes(data?.items || [])
    } catch (err: any) {
      setCapesError(err.message || "No se pudieron cargar las capas.")
    } finally {
      setIsCapesLoading(false)
    }
  }, [capeStatusFilter])

  const fetchPlayerSkins = useCallback(async (search?: string) => {
    setIsPlayerSkinsLoading(true)
    setPlayerSkinsError(null)
    try {
      const data = await skinsApi.getAdminPlayerSkins({ search })
      setPlayerSkins(data?.items || [])
    } catch (err: any) {
      setPlayerSkinsError(err.message || "No se pudieron cargar las skins de jugadores.")
    } finally {
      setIsPlayerSkinsLoading(false)
    }
  }, [])

  const fetchPlayerCapes = useCallback(async (search?: string) => {
    setIsPlayerCapesLoading(true)
    setPlayerCapesError(null)
    try {
      const data = await capesApi.getAdminPlayerCapes({ search })
      setPlayerCapes(data?.items || [])
    } catch (err: any) {
      setPlayerCapesError(err.message || "No se pudieron cargar las capas de jugadores.")
    } finally {
      setIsPlayerCapesLoading(false)
    }
  }, [])

  useEffect(() => {
    if (activeTab === "skins_global") {
      fetchSkins()
    } else if (activeTab === "capes_global") {
      fetchCapes()
    } else if (activeTab === "skins_players") {
      fetchPlayerSkins(playerSkinSearchQuery)
    } else if (activeTab === "capes_players") {
      fetchPlayerCapes(playerCapeSearchQuery)
    }
  }, [
    activeTab,
    fetchSkins,
    fetchCapes,
    fetchPlayerSkins,
    fetchPlayerCapes,
    playerSkinSearchQuery,
    playerCapeSearchQuery,
  ])

  return (
    <div
      style={{
        padding: "28px",
        maxWidth: "1280px",
        margin: "0 auto",
        width: "100%",
        boxSizing: "border-box",
      }}
    >
      {/* Top Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "20px",
          marginBottom: "24px",
          width: "100%",
        }}
      >
        <div style={{ minWidth: "240px", flex: "1 1 300px" }}>
          <h1
            style={{
              margin: "0 0 6px 0",
              fontSize: "24px",
              fontWeight: "700",
              color: isDark ? "#f1f5f9" : "#0f172a",
              letterSpacing: "-0.02em",
            }}
          >
            Skins & Capas
          </h1>
          <p
            style={{
              margin: 0,
              fontSize: "14px",
              color: isDark ? "#94a3b8" : "#64748b",
            }}
          >
            {activeTab === "skins_global"
              ? "Administra las apariencias y skins disponibles en el catálogo oficial."
              : activeTab === "capes_global"
                ? "Administra las capas globales y oficiales de HiKAT."
                : activeTab === "skins_players"
                  ? "Gestiona las skins personalizadas subidas por los jugadores."
                  : "Gestiona las capas personalizadas subidas por los jugadores."}
          </p>
        </div>

        {/* Tab Navigation */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            backgroundColor: isDark ? "#1e293b" : "#e2e8f0",
            padding: "4px",
            borderRadius: "10px",
            flexWrap: "wrap",
          }}
        >
          {[
            { id: "skins_global", label: "Skins globales" },
            { id: "capes_global", label: "Capas globales" },
            { id: "skins_players", label: "Skins de jugadores" },
            { id: "capes_players", label: "Capas de jugadores" },
          ].map((tab) => {
            const isSel = activeTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                style={{
                  padding: "7px 14px",
                  borderRadius: "8px",
                  border: "none",
                  backgroundColor: isSel ? (isDark ? "#334155" : "#ffffff") : "transparent",
                  color: isSel ? (isDark ? "#f1f5f9" : "#0f172a") : isDark ? "#94a3b8" : "#64748b",
                  fontSize: "13px",
                  fontWeight: "600",
                  cursor: "pointer",
                  boxShadow: isSel ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
                  transition: "all 0.15s ease",
                }}
              >
                {tab.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* TAB 1: Global Skins */}
      {activeTab === "skins_global" && (
        <>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "20px",
              gap: "16px",
              flexWrap: "wrap",
            }}
          >
            <div style={{ width: "200px" }}>
              <BackofficeSelect
                options={STATUS_FILTER_OPTIONS}
                value={skinStatusFilter}
                onChange={(val) => setSkinStatusFilter(val)}
                theme={theme}
              />
            </div>
            <button
              onClick={() => {
                setActiveSkin(null)
                setSkinModalMode("edit")
                setIsSkinFormOpen(true)
              }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                padding: "9px 18px",
                borderRadius: "8px",
                border: "none",
                backgroundColor: "#6366f1",
                color: "#ffffff",
                fontSize: "13px",
                fontWeight: "600",
                cursor: "pointer",
              }}
            >
              <IconPlus size={16} />
              Nueva Skin
            </button>
          </div>

          {skinsError && (
            <div
              style={{
                padding: "12px 16px",
                borderRadius: "8px",
                backgroundColor: "rgba(239, 68, 68, 0.15)",
                color: "#ef4444",
                marginBottom: "20px",
                fontSize: "13px",
              }}
            >
              {skinsError}
            </div>
          )}

          {isSkinsLoading ? (
            <div
              style={{
                padding: "60px 0",
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                color: isDark ? "#94a3b8" : "#64748b",
                gap: "10px",
              }}
            >
              <IconSpinner size={24} />
              <span>Cargando skins...</span>
            </div>
          ) : skins.length === 0 ? (
            <div
              style={{
                padding: "60px 20px",
                textAlign: "center",
                backgroundColor: isDark ? "#1e293b" : "#ffffff",
                border: `1px solid ${isDark ? "#334155" : "#e2e8f0"}`,
                borderRadius: "12px",
                color: isDark ? "#94a3b8" : "#64748b",
              }}
            >
              No se encontraron skins en el catálogo.
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
                gap: "20px",
              }}
            >
              {skins.map((skin) => (
                <div
                  key={skin.id}
                  style={{
                    backgroundColor: isDark ? "#1e293b" : "#ffffff",
                    border: `1px solid ${isDark ? "#334155" : "#e2e8f0"}`,
                    borderRadius: "14px",
                    padding: "20px",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    textAlign: "center",
                    boxShadow: isDark
                      ? "0 4px 6px -1px rgba(0,0,0,0.3)"
                      : "0 1px 3px rgba(0,0,0,0.05)",
                  }}
                >
                  <div
                    onClick={() => {
                      setActiveSkin(skin)
                      setSkinModalMode("view")
                      setIsSkinFormOpen(true)
                    }}
                    style={{ marginBottom: "14px", cursor: "pointer" }}
                    title="Haz clic para ver en 3D"
                  >
                    <SkinHeadPreview imageUrl={skin.imageUrl} size={72} />
                  </div>
                  <h3
                    style={{
                      margin: "0 0 8px 0",
                      fontSize: "15px",
                      fontWeight: "600",
                      color: isDark ? "#f1f5f9" : "#0f172a",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      width: "100%",
                    }}
                  >
                    {skin.name}
                  </h3>
                  <div style={{ display: "flex", gap: "6px", marginBottom: "18px" }}>
                    <span
                      style={{
                        padding: "3px 8px",
                        borderRadius: "6px",
                        fontSize: "11px",
                        fontWeight: "600",
                        backgroundColor:
                          skin.status === "AVAILABLE"
                            ? "rgba(34, 197, 94, 0.15)"
                            : "rgba(249, 115, 22, 0.15)",
                        color: skin.status === "AVAILABLE" ? "#22c55e" : "#f97316",
                      }}
                    >
                      {skin.status === "AVAILABLE" ? "Disponible" : "Oculto"}
                    </span>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      width: "100%",
                      gap: "6px",
                      borderTop: `1px solid ${isDark ? "#334155" : "#f1f5f9"}`,
                      paddingTop: "14px",
                    }}
                  >
                    <button
                      onClick={() => {
                        setActiveSkin(skin)
                        setSkinModalMode("view")
                        setIsSkinFormOpen(true)
                      }}
                      style={{
                        flex: 1,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "4px",
                        padding: "7px 8px",
                        borderRadius: "6px",
                        border: `1px solid ${isDark ? "#475569" : "#cbd5e1"}`,
                        backgroundColor: "transparent",
                        color: isDark ? "#f1f5f9" : "#1e293b",
                        fontSize: "12px",
                        fontWeight: "500",
                        cursor: "pointer",
                      }}
                    >
                      <IconEye size={14} />
                      Ver
                    </button>
                    <button
                      onClick={() => {
                        setActiveSkin(skin)
                        setSkinModalMode("edit")
                        setIsSkinFormOpen(true)
                      }}
                      style={{
                        flex: 1,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "4px",
                        padding: "7px 8px",
                        borderRadius: "6px",
                        border: `1px solid ${isDark ? "#475569" : "#cbd5e1"}`,
                        backgroundColor: "transparent",
                        color: isDark ? "#f1f5f9" : "#1e293b",
                        fontSize: "12px",
                        fontWeight: "500",
                        cursor: "pointer",
                      }}
                    >
                      <IconEdit size={14} />
                      Editar
                    </button>
                    <button
                      onClick={() => setDeleteSkinItem(skin)}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: "7px 10px",
                        borderRadius: "6px",
                        border: `1px solid ${isDark ? "#7f1d1d" : "#fecaca"}`,
                        backgroundColor: "rgba(239, 68, 68, 0.1)",
                        color: "#ef4444",
                        cursor: "pointer",
                      }}
                    >
                      <IconTrash size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* TAB 2: Global Capes */}
      {activeTab === "capes_global" && (
        <>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "20px",
              gap: "16px",
              flexWrap: "wrap",
            }}
          >
            <div style={{ width: "200px" }}>
              <BackofficeSelect
                options={STATUS_FILTER_OPTIONS}
                value={capeStatusFilter}
                onChange={(val) => setCapeStatusFilter(val)}
                theme={theme}
              />
            </div>
            <button
              onClick={() => {
                setActiveCape(null)
                setCapeModalMode("edit")
                setIsCapeFormOpen(true)
              }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                padding: "9px 18px",
                borderRadius: "8px",
                border: "none",
                backgroundColor: "#6366f1",
                color: "#ffffff",
                fontSize: "13px",
                fontWeight: "600",
                cursor: "pointer",
              }}
            >
              <IconPlus size={16} />
              Nueva Capa Global
            </button>
          </div>

          {capesError && (
            <div
              style={{
                padding: "12px 16px",
                borderRadius: "8px",
                backgroundColor: "rgba(239, 68, 68, 0.15)",
                color: "#ef4444",
                marginBottom: "20px",
                fontSize: "13px",
              }}
            >
              {capesError}
            </div>
          )}

          {isCapesLoading ? (
            <div
              style={{
                padding: "60px 0",
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                color: isDark ? "#94a3b8" : "#64748b",
                gap: "10px",
              }}
            >
              <IconSpinner size={24} />
              <span>Cargando capas...</span>
            </div>
          ) : capes.length === 0 ? (
            <div
              style={{
                padding: "60px 20px",
                textAlign: "center",
                backgroundColor: isDark ? "#1e293b" : "#ffffff",
                border: `1px solid ${isDark ? "#334155" : "#e2e8f0"}`,
                borderRadius: "12px",
                color: isDark ? "#94a3b8" : "#64748b",
              }}
            >
              No se encontraron capas en el catálogo.
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
                gap: "20px",
              }}
            >
              {capes.map((cape) => (
                <div
                  key={cape.id}
                  style={{
                    backgroundColor: isDark ? "#1e293b" : "#ffffff",
                    border: `1px solid ${isDark ? "#334155" : "#e2e8f0"}`,
                    borderRadius: "14px",
                    padding: "20px",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    textAlign: "center",
                    boxShadow: isDark
                      ? "0 4px 6px -1px rgba(0,0,0,0.3)"
                      : "0 1px 3px rgba(0,0,0,0.05)",
                  }}
                >
                  <div
                    onClick={() => {
                      setActiveCape(cape)
                      setCapeModalMode("view")
                      setIsCapeFormOpen(true)
                    }}
                    style={{
                      marginBottom: "14px",
                      cursor: "pointer",
                      width: "64px",
                      height: "96px",
                      borderRadius: "8px",
                      overflow: "hidden",
                      backgroundColor: isDark ? "#0f172a" : "#f1f5f9",
                      border: `1px solid ${isDark ? "#334155" : "#cbd5e1"}`,
                    }}
                    title="Haz clic para ver en 3D"
                  >
                    <img
                      src={cape.imageUrl}
                      alt={cape.name}
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        imageRendering: "pixelated",
                      }}
                    />
                  </div>
                  <h3
                    style={{
                      margin: "0 0 8px 0",
                      fontSize: "15px",
                      fontWeight: "600",
                      color: isDark ? "#f1f5f9" : "#0f172a",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      width: "100%",
                    }}
                  >
                    {cape.name}
                  </h3>
                  <div style={{ display: "flex", gap: "6px", marginBottom: "18px" }}>
                    <span
                      style={{
                        padding: "3px 8px",
                        borderRadius: "6px",
                        fontSize: "11px",
                        fontWeight: "600",
                        backgroundColor:
                          cape.status === "AVAILABLE"
                            ? "rgba(34, 197, 94, 0.15)"
                            : "rgba(249, 115, 22, 0.15)",
                        color: cape.status === "AVAILABLE" ? "#22c55e" : "#f97316",
                      }}
                    >
                      {cape.status === "AVAILABLE" ? "Disponible" : "Oculto"}
                    </span>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      width: "100%",
                      gap: "6px",
                      borderTop: `1px solid ${isDark ? "#334155" : "#f1f5f9"}`,
                      paddingTop: "14px",
                    }}
                  >
                    <button
                      onClick={() => {
                        setActiveCape(cape)
                        setCapeModalMode("view")
                        setIsCapeFormOpen(true)
                      }}
                      style={{
                        flex: 1,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "4px",
                        padding: "7px 8px",
                        borderRadius: "6px",
                        border: `1px solid ${isDark ? "#475569" : "#cbd5e1"}`,
                        backgroundColor: "transparent",
                        color: isDark ? "#f1f5f9" : "#1e293b",
                        fontSize: "12px",
                        fontWeight: "500",
                        cursor: "pointer",
                      }}
                    >
                      <IconEye size={14} />
                      Ver
                    </button>
                    <button
                      onClick={() => {
                        setActiveCape(cape)
                        setCapeModalMode("edit")
                        setIsCapeFormOpen(true)
                      }}
                      style={{
                        flex: 1,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "4px",
                        padding: "7px 8px",
                        borderRadius: "6px",
                        border: `1px solid ${isDark ? "#475569" : "#cbd5e1"}`,
                        backgroundColor: "transparent",
                        color: isDark ? "#f1f5f9" : "#1e293b",
                        fontSize: "12px",
                        fontWeight: "500",
                        cursor: "pointer",
                      }}
                    >
                      <IconEdit size={14} />
                      Editar
                    </button>
                    <button
                      onClick={() => setDeleteCapeItem(cape)}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: "7px 10px",
                        borderRadius: "6px",
                        border: `1px solid ${isDark ? "#7f1d1d" : "#fecaca"}`,
                        backgroundColor: "rgba(239, 68, 68, 0.1)",
                        color: "#ef4444",
                        cursor: "pointer",
                      }}
                    >
                      <IconTrash size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* TAB 3: Player Custom Skins */}
      {activeTab === "skins_players" && (
        <>
          <div style={{ marginBottom: "20px" }}>
            <input
              type="text"
              placeholder="Buscar por jugador..."
              value={playerSkinSearchQuery}
              onChange={(e) => setPlayerSkinSearchQuery(e.target.value)}
              style={{
                width: "100%",
                maxWidth: "320px",
                padding: "9px 14px",
                borderRadius: "8px",
                border: `1px solid ${isDark ? "#334155" : "#cbd5e1"}`,
                backgroundColor: isDark ? "#1e293b" : "#ffffff",
                color: isDark ? "#f1f5f9" : "#0f172a",
                fontSize: "13px",
              }}
            />
          </div>

          {playerSkinsError && (
            <div
              style={{
                padding: "12px 16px",
                borderRadius: "8px",
                backgroundColor: "rgba(239, 68, 68, 0.15)",
                color: "#ef4444",
                marginBottom: "20px",
                fontSize: "13px",
              }}
            >
              {playerSkinsError}
            </div>
          )}

          {isPlayerSkinsLoading ? (
            <div
              style={{
                padding: "60px 0",
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                color: isDark ? "#94a3b8" : "#64748b",
                gap: "10px",
              }}
            >
              <IconSpinner size={24} />
              <span>Cargando skins de jugadores...</span>
            </div>
          ) : playerSkins.length === 0 ? (
            <div
              style={{
                padding: "60px 20px",
                textAlign: "center",
                backgroundColor: isDark ? "#1e293b" : "#ffffff",
                border: `1px solid ${isDark ? "#334155" : "#e2e8f0"}`,
                borderRadius: "12px",
                color: isDark ? "#94a3b8" : "#64748b",
              }}
            >
              No se encontraron skins de jugadores.
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
                gap: "20px",
              }}
            >
              {playerSkins.map((pskin) => (
                <div
                  key={pskin.id}
                  style={{
                    backgroundColor: isDark ? "#1e293b" : "#ffffff",
                    border: `1px solid ${isDark ? "#334155" : "#e2e8f0"}`,
                    borderRadius: "14px",
                    padding: "20px",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    textAlign: "center",
                    boxShadow: isDark
                      ? "0 4px 6px -1px rgba(0,0,0,0.3)"
                      : "0 1px 3px rgba(0,0,0,0.05)",
                  }}
                >
                  <div
                    onClick={() => {
                      setActivePlayerSkin(pskin)
                      setPlayerSkinModalMode("view")
                      setIsPlayerSkinModalOpen(true)
                    }}
                    style={{ marginBottom: "14px", cursor: "pointer" }}
                    title="Ver en 3D"
                  >
                    <SkinHeadPreview imageUrl={pskin.imageUrl} size={72} />
                  </div>
                  <h3
                    style={{
                      margin: "0 0 6px 0",
                      fontSize: "15px",
                      fontWeight: "600",
                      color: isDark ? "#f1f5f9" : "#0f172a",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      width: "100%",
                    }}
                  >
                    {pskin.userDisplayName}
                  </h3>
                  <div
                    style={{
                      display: "flex",
                      width: "100%",
                      gap: "6px",
                      borderTop: `1px solid ${isDark ? "#334155" : "#f1f5f9"}`,
                      paddingTop: "14px",
                      marginTop: "12px",
                    }}
                  >
                    <button
                      onClick={() => {
                        setActivePlayerSkin(pskin)
                        setPlayerSkinModalMode("view")
                        setIsPlayerSkinModalOpen(true)
                      }}
                      style={{
                        flex: 1,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "4px",
                        padding: "7px 8px",
                        borderRadius: "6px",
                        border: `1px solid ${isDark ? "#475569" : "#cbd5e1"}`,
                        backgroundColor: "transparent",
                        color: isDark ? "#f1f5f9" : "#1e293b",
                        fontSize: "12px",
                        fontWeight: "500",
                        cursor: "pointer",
                      }}
                    >
                      <IconEye size={14} />
                      Ver
                    </button>
                    <button
                      onClick={() => {
                        setActivePlayerSkin(pskin)
                        setPlayerSkinModalMode("edit")
                        setIsPlayerSkinModalOpen(true)
                      }}
                      style={{
                        flex: 1,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "4px",
                        padding: "7px 8px",
                        borderRadius: "6px",
                        border: `1px solid ${isDark ? "#475569" : "#cbd5e1"}`,
                        backgroundColor: "transparent",
                        color: isDark ? "#f1f5f9" : "#1e293b",
                        fontSize: "12px",
                        fontWeight: "500",
                        cursor: "pointer",
                      }}
                    >
                      <IconEdit size={14} />
                      Editar
                    </button>
                    <button
                      onClick={() => setDeletePlayerSkinItem(pskin)}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: "7px 10px",
                        borderRadius: "6px",
                        border: `1px solid ${isDark ? "#7f1d1d" : "#fecaca"}`,
                        backgroundColor: "rgba(239, 68, 68, 0.1)",
                        color: "#ef4444",
                        cursor: "pointer",
                      }}
                    >
                      <IconTrash size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* TAB 4: Player Custom Capes */}
      {activeTab === "capes_players" && (
        <>
          <div style={{ marginBottom: "20px" }}>
            <input
              type="text"
              placeholder="Buscar por jugador..."
              value={playerCapeSearchQuery}
              onChange={(e) => setPlayerCapeSearchQuery(e.target.value)}
              style={{
                width: "100%",
                maxWidth: "320px",
                padding: "9px 14px",
                borderRadius: "8px",
                border: `1px solid ${isDark ? "#334155" : "#cbd5e1"}`,
                backgroundColor: isDark ? "#1e293b" : "#ffffff",
                color: isDark ? "#f1f5f9" : "#0f172a",
                fontSize: "13px",
              }}
            />
          </div>

          {playerCapesError && (
            <div
              style={{
                padding: "12px 16px",
                borderRadius: "8px",
                backgroundColor: "rgba(239, 68, 68, 0.15)",
                color: "#ef4444",
                marginBottom: "20px",
                fontSize: "13px",
              }}
            >
              {playerCapesError}
            </div>
          )}

          {isPlayerCapesLoading ? (
            <div
              style={{
                padding: "60px 0",
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                color: isDark ? "#94a3b8" : "#64748b",
                gap: "10px",
              }}
            >
              <IconSpinner size={24} />
              <span>Cargando capas de jugadores...</span>
            </div>
          ) : playerCapes.length === 0 ? (
            <div
              style={{
                padding: "60px 20px",
                textAlign: "center",
                backgroundColor: isDark ? "#1e293b" : "#ffffff",
                border: `1px solid ${isDark ? "#334155" : "#e2e8f0"}`,
                borderRadius: "12px",
                color: isDark ? "#94a3b8" : "#64748b",
              }}
            >
              No se encontraron capas de jugadores.
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
                gap: "20px",
              }}
            >
              {playerCapes.map((pcape) => (
                <div
                  key={pcape.id}
                  style={{
                    backgroundColor: isDark ? "#1e293b" : "#ffffff",
                    border: `1px solid ${isDark ? "#334155" : "#e2e8f0"}`,
                    borderRadius: "14px",
                    padding: "20px",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    textAlign: "center",
                    boxShadow: isDark
                      ? "0 4px 6px -1px rgba(0,0,0,0.3)"
                      : "0 1px 3px rgba(0,0,0,0.05)",
                  }}
                >
                  <div
                    onClick={() => {
                      setActivePlayerCape(pcape)
                      setPlayerCapeModalMode("view")
                      setIsPlayerCapeModalOpen(true)
                    }}
                    style={{
                      marginBottom: "14px",
                      cursor: "pointer",
                      width: "64px",
                      height: "96px",
                      borderRadius: "8px",
                      overflow: "hidden",
                      backgroundColor: isDark ? "#0f172a" : "#f1f5f9",
                      border: `1px solid ${isDark ? "#334155" : "#cbd5e1"}`,
                    }}
                    title="Ver en 3D"
                  >
                    <img
                      src={pcape.imageUrl}
                      alt={pcape.name}
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        imageRendering: "pixelated",
                      }}
                    />
                  </div>
                  <h3
                    style={{
                      margin: "0 0 4px 0",
                      fontSize: "15px",
                      fontWeight: "600",
                      color: isDark ? "#f1f5f9" : "#0f172a",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      width: "100%",
                    }}
                  >
                    {pcape.name}
                  </h3>
                  <p
                    style={{
                      margin: "0 0 12px 0",
                      fontSize: "12px",
                      color: isDark ? "#94a3b8" : "#64748b",
                    }}
                  >
                    Jugador: <strong>{pcape.userDisplayName}</strong>
                  </p>
                  <div
                    style={{
                      display: "flex",
                      width: "100%",
                      gap: "6px",
                      borderTop: `1px solid ${isDark ? "#334155" : "#f1f5f9"}`,
                      paddingTop: "14px",
                    }}
                  >
                    <button
                      onClick={() => {
                        setActivePlayerCape(pcape)
                        setPlayerCapeModalMode("view")
                        setIsPlayerCapeModalOpen(true)
                      }}
                      style={{
                        flex: 1,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "4px",
                        padding: "7px 8px",
                        borderRadius: "6px",
                        border: `1px solid ${isDark ? "#475569" : "#cbd5e1"}`,
                        backgroundColor: "transparent",
                        color: isDark ? "#f1f5f9" : "#1e293b",
                        fontSize: "12px",
                        fontWeight: "500",
                        cursor: "pointer",
                      }}
                    >
                      <IconEye size={14} />
                      Ver
                    </button>
                    <button
                      onClick={() => {
                        setActivePlayerCape(pcape)
                        setPlayerCapeModalMode("edit")
                        setIsPlayerCapeModalOpen(true)
                      }}
                      style={{
                        flex: 1,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "4px",
                        padding: "7px 8px",
                        borderRadius: "6px",
                        border: `1px solid ${isDark ? "#475569" : "#cbd5e1"}`,
                        backgroundColor: "transparent",
                        color: isDark ? "#f1f5f9" : "#1e293b",
                        fontSize: "12px",
                        fontWeight: "500",
                        cursor: "pointer",
                      }}
                    >
                      <IconEdit size={14} />
                      Editar
                    </button>
                    <button
                      onClick={() => setDeletePlayerCapeItem(pcape)}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: "7px 10px",
                        borderRadius: "6px",
                        border: `1px solid ${isDark ? "#7f1d1d" : "#fecaca"}`,
                        backgroundColor: "rgba(239, 68, 68, 0.1)",
                        color: "#ef4444",
                        cursor: "pointer",
                      }}
                    >
                      <IconTrash size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Modals */}
      {isSkinFormOpen && (
        <SkinFormModal
          theme={theme}
          skin={activeSkin}
          mode={skinModalMode}
          onClose={() => setIsSkinFormOpen(false)}
          onSaved={() => {
            fetchSkins()
            setToastMessage("Skin guardada correctamente.")
          }}
        />
      )}

      {deleteSkinItem && (
        <DeleteSkinModal
          theme={theme}
          skin={deleteSkinItem}
          onClose={() => setDeleteSkinItem(null)}
          onDeleted={() => {
            fetchSkins()
            setToastMessage("Skin eliminada correctamente.")
          }}
        />
      )}

      {isPlayerSkinModalOpen && activePlayerSkin && (
        <PlayerSkinModal
          theme={theme}
          skin={activePlayerSkin}
          mode={playerSkinModalMode}
          onClose={() => setIsPlayerSkinModalOpen(false)}
          onSaved={() => {
            fetchPlayerSkins(playerSkinSearchQuery)
            setIsPlayerSkinModalOpen(false)
            setToastMessage("Skin del jugador actualizada.")
          }}
        />
      )}

      {deletePlayerSkinItem && (
        <DeletePlayerSkinModal
          theme={theme}
          skin={deletePlayerSkinItem}
          onClose={() => setDeletePlayerSkinItem(null)}
          onDeleted={() => {
            fetchPlayerSkins(playerSkinSearchQuery)
            setToastMessage("Skin del jugador eliminada.")
          }}
        />
      )}

      {isCapeFormOpen && (
        <CapeFormModal
          theme={theme}
          cape={activeCape}
          mode={capeModalMode}
          onClose={() => setIsCapeFormOpen(false)}
          onSaved={() => {
            fetchCapes()
            setToastMessage("Capa guardada correctamente.")
          }}
        />
      )}

      {deleteCapeItem && (
        <DeleteCapeModal
          theme={theme}
          cape={deleteCapeItem}
          onClose={() => setDeleteCapeItem(null)}
          onDeleted={() => {
            fetchCapes()
            setToastMessage("Capa eliminada correctamente.")
          }}
        />
      )}

      {isPlayerCapeModalOpen && activePlayerCape && (
        <PlayerCapeModal
          theme={theme}
          cape={activePlayerCape}
          mode={playerCapeModalMode}
          onClose={() => setIsPlayerCapeModalOpen(false)}
          onSaved={() => {
            fetchPlayerCapes(playerCapeSearchQuery)
            setIsPlayerCapeModalOpen(false)
            setToastMessage("Capa del jugador actualizada.")
          }}
        />
      )}

      {deletePlayerCapeItem && (
        <DeletePlayerCapeModal
          theme={theme}
          cape={deletePlayerCapeItem}
          onClose={() => setDeletePlayerCapeItem(null)}
          onDeleted={() => {
            fetchPlayerCapes(playerCapeSearchQuery)
            setToastMessage("Capa del jugador eliminada.")
          }}
        />
      )}

      <LiveToast message={toastMessage} theme={theme} onClose={() => setToastMessage(null)} />
    </div>
  )
}
