import React, { useState, useEffect, useCallback } from "react"
import type {
  ThemeMode,
  SkinItem,
  AdminPlayerSkin,
  CapeItem,
  AdminPlayerCape,
} from "../../types"
import { skinsApi, capesApi } from "../../services/graphqlClient"
import { getThemeTokens } from "../../theme/tokens"
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
import CapeCardPreview from "./CapeCardPreview"
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

  const tokens = getThemeTokens(theme)

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        padding: "32px 36px",
        overflowY: "auto",
        animation: "viewFadeIn 0.24s ease",
        fontFamily: "Inter, sans-serif",
        boxSizing: "border-box",
      }}
      className="custom-scroll"
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
              fontSize: "26px",
              fontWeight: "800",
              color: tokens.textPrimary,
              letterSpacing: "-0.02em",
            }}
          >
            Skins & Capas
          </h1>
          <p
            style={{
              margin: 0,
              fontSize: "14px",
              fontWeight: "500",
              color: tokens.textSecondary,
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
            display: "inline-flex",
            alignItems: "center",
            padding: "4px",
            borderRadius: "14px",
            backgroundColor: tokens.bgCardInner,
            border: `1px solid ${tokens.borderSubtle}`,
            gap: "4px",
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
                type="button"
                onClick={() => setActiveTab(tab.id as any)}
                style={{
                  padding: "8px 16px",
                  borderRadius: "10px",
                  border: "none",
                  backgroundColor: isSel ? tokens.bgCard : "transparent",
                  color: isSel ? tokens.textPrimary : tokens.textSecondary,
                  boxShadow: isSel ? tokens.cardShadow : "none",
                  fontSize: "13px",
                  fontWeight: isSel ? "700" : "500",
                  cursor: "pointer",
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
              marginBottom: "24px",
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
              type="button"
              onClick={() => {
                setActiveSkin(null)
                setSkinModalMode("edit")
                setIsSkinFormOpen(true)
              }}
              className="launcher-btn-primary"
              style={{
                padding: "10px 22px",
                borderRadius: 14,
                fontSize: 14.5,
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <IconPlus size={18} />
              <span>Nueva Skin</span>
            </button>
          </div>

          {skinsError && (
            <div
              style={{
                padding: "12px 16px",
                borderRadius: "12px",
                backgroundColor: "rgba(239, 68, 68, 0.15)",
                border: "1px solid rgba(239, 68, 68, 0.25)",
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
                backgroundColor: tokens.bgCard,
                border: `1px solid ${tokens.borderSubtle}`,
                borderRadius: "18px",
                boxShadow: tokens.cardShadow,
                color: tokens.textSecondary,
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
                    backgroundColor: tokens.bgCard,
                    border: `1px solid ${tokens.borderSubtle}`,
                    borderRadius: "18px",
                    padding: "20px",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    textAlign: "center",
                    boxShadow: tokens.cardShadow,
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
                      fontWeight: "700",
                      color: tokens.textPrimary,
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
                      gap: "8px",
                      borderTop: `1px solid ${tokens.borderSubtle}`,
                      paddingTop: "14px",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setActiveSkin(skin)
                        setSkinModalMode("view")
                        setIsSkinFormOpen(true)
                      }}
                      className="launcher-btn-secondary"
                      style={{
                        flex: 1,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "6px",
                        padding: "7px 10px",
                        borderRadius: "10px",
                        fontSize: "12.5px",
                        fontWeight: "600",
                      }}
                    >
                      <IconEye size={14} />
                      <span>Ver</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveSkin(skin)
                        setSkinModalMode("edit")
                        setIsSkinFormOpen(true)
                      }}
                      className="launcher-btn-secondary"
                      style={{
                        flex: 1,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "6px",
                        padding: "7px 10px",
                        borderRadius: "10px",
                        fontSize: "12.5px",
                        fontWeight: "600",
                      }}
                    >
                      <IconEdit size={14} />
                      <span>Editar</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteSkinItem(skin)}
                      title="Eliminar skin"
                      className="launcher-btn-danger"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: "34px",
                        height: "34px",
                        borderRadius: "10px",
                        padding: 0,
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
              marginBottom: "24px",
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
              type="button"
              onClick={() => {
                setActiveCape(null)
                setCapeModalMode("edit")
                setIsCapeFormOpen(true)
              }}
              className="launcher-btn-primary"
              style={{
                padding: "10px 22px",
                borderRadius: 14,
                fontSize: 14.5,
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <IconPlus size={18} />
              <span>Nueva Capa Global</span>
            </button>
          </div>

          {capesError && (
            <div
              style={{
                padding: "12px 16px",
                borderRadius: "12px",
                backgroundColor: "rgba(239, 68, 68, 0.15)",
                border: "1px solid rgba(239, 68, 68, 0.25)",
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
                backgroundColor: tokens.bgCard,
                border: `1px solid ${tokens.borderSubtle}`,
                borderRadius: "18px",
                boxShadow: tokens.cardShadow,
                color: tokens.textSecondary,
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
                    backgroundColor: tokens.bgCard,
                    border: `1px solid ${tokens.borderSubtle}`,
                    borderRadius: "18px",
                    padding: "20px",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    textAlign: "center",
                    boxShadow: tokens.cardShadow,
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
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                    title="Haz clic para ver en 3D"
                  >
                    <CapeCardPreview capeUrl={cape.imageUrl} width={64} height={96} />
                  </div>
                  <h3
                    style={{
                      margin: "0 0 8px 0",
                      fontSize: "15px",
                      fontWeight: "700",
                      color: tokens.textPrimary,
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
                      gap: "8px",
                      borderTop: `1px solid ${tokens.borderSubtle}`,
                      paddingTop: "14px",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setActiveCape(cape)
                        setCapeModalMode("view")
                        setIsCapeFormOpen(true)
                      }}
                      className="launcher-btn-secondary"
                      style={{
                        flex: 1,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "6px",
                        padding: "7px 10px",
                        borderRadius: "10px",
                        fontSize: "12.5px",
                        fontWeight: "600",
                      }}
                    >
                      <IconEye size={14} />
                      <span>Ver</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveCape(cape)
                        setCapeModalMode("edit")
                        setIsCapeFormOpen(true)
                      }}
                      className="launcher-btn-secondary"
                      style={{
                        flex: 1,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "6px",
                        padding: "7px 10px",
                        borderRadius: "10px",
                        fontSize: "12.5px",
                        fontWeight: "600",
                      }}
                    >
                      <IconEdit size={14} />
                      <span>Editar</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteCapeItem(cape)}
                      title="Eliminar capa"
                      className="launcher-btn-danger"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: "34px",
                        height: "34px",
                        borderRadius: "10px",
                        padding: 0,
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
          <div style={{ marginBottom: "24px" }}>
            <input
              type="text"
              placeholder="Buscar por jugador..."
              value={playerSkinSearchQuery}
              onChange={(e) => setPlayerSkinSearchQuery(e.target.value)}
              className="launcher-input"
              style={{
                width: "100%",
                maxWidth: "320px",
                padding: "9px 14px",
                borderRadius: "12px",
                fontSize: "13.5px",
              }}
            />
          </div>

          {playerSkinsError && (
            <div
              style={{
                padding: "12px 16px",
                borderRadius: "12px",
                backgroundColor: "rgba(239, 68, 68, 0.15)",
                border: "1px solid rgba(239, 68, 68, 0.25)",
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
                backgroundColor: tokens.bgCard,
                border: `1px solid ${tokens.borderSubtle}`,
                borderRadius: "18px",
                boxShadow: tokens.cardShadow,
                color: tokens.textSecondary,
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
                    backgroundColor: tokens.bgCard,
                    border: `1px solid ${tokens.borderSubtle}`,
                    borderRadius: "18px",
                    padding: "20px",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    textAlign: "center",
                    boxShadow: tokens.cardShadow,
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
                      fontWeight: "700",
                      color: tokens.textPrimary,
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
                      gap: "8px",
                      borderTop: `1px solid ${tokens.borderSubtle}`,
                      paddingTop: "14px",
                      marginTop: "12px",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setActivePlayerSkin(pskin)
                        setPlayerSkinModalMode("view")
                        setIsPlayerSkinModalOpen(true)
                      }}
                      className="launcher-btn-secondary"
                      style={{
                        flex: 1,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "6px",
                        padding: "7px 10px",
                        borderRadius: "10px",
                        fontSize: "12.5px",
                        fontWeight: "600",
                      }}
                    >
                      <IconEye size={14} />
                      <span>Ver</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setActivePlayerSkin(pskin)
                        setPlayerSkinModalMode("edit")
                        setIsPlayerSkinModalOpen(true)
                      }}
                      className="launcher-btn-secondary"
                      style={{
                        flex: 1,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "6px",
                        padding: "7px 10px",
                        borderRadius: "10px",
                        fontSize: "12.5px",
                        fontWeight: "600",
                      }}
                    >
                      <IconEdit size={14} />
                      <span>Editar</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeletePlayerSkinItem(pskin)}
                      title="Eliminar skin del jugador"
                      className="launcher-btn-danger"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: "34px",
                        height: "34px",
                        borderRadius: "10px",
                        padding: 0,
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
          <div style={{ marginBottom: "24px" }}>
            <input
              type="text"
              placeholder="Buscar por jugador..."
              value={playerCapeSearchQuery}
              onChange={(e) => setPlayerCapeSearchQuery(e.target.value)}
              className="launcher-input"
              style={{
                width: "100%",
                maxWidth: "320px",
                padding: "9px 14px",
                borderRadius: "12px",
                fontSize: "13.5px",
              }}
            />
          </div>

          {playerCapesError && (
            <div
              style={{
                marginBottom: "20px",
                padding: "12px 16px",
                borderRadius: "12px",
                backgroundColor: "rgba(239, 68, 68, 0.15)",
                border: "1px solid rgba(239, 68, 68, 0.25)",
                color: "#ef4444",
                fontSize: "13px",
              }}
            >
              {playerCapesError}
            </div>
          )}

          {isPlayerCapesLoading ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "60px 0",
                color: tokens.textSecondary,
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
                backgroundColor: tokens.bgCard,
                border: `1px solid ${tokens.borderSubtle}`,
                borderRadius: "18px",
                boxShadow: tokens.cardShadow,
                color: tokens.textSecondary,
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
                    backgroundColor: tokens.bgCard,
                    border: `1px solid ${tokens.borderSubtle}`,
                    borderRadius: "18px",
                    padding: "20px",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    textAlign: "center",
                    boxShadow: tokens.cardShadow,
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
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                    title="Ver en 3D"
                  >
                    <CapeCardPreview capeUrl={pcape.imageUrl} width={64} height={96} />
                  </div>
                  <h3
                    style={{
                      margin: "0 0 4px 0",
                      fontSize: "15px",
                      fontWeight: "700",
                      color: tokens.textPrimary,
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
                      color: tokens.textMuted,
                    }}
                  >
                    Jugador: <strong style={{ color: tokens.textSecondary }}>{pcape.userDisplayName}</strong>
                  </p>
                  <div
                    style={{
                      display: "flex",
                      width: "100%",
                      gap: "8px",
                      borderTop: `1px solid ${tokens.borderSubtle}`,
                      paddingTop: "14px",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setActivePlayerCape(pcape)
                        setPlayerCapeModalMode("view")
                        setIsPlayerCapeModalOpen(true)
                      }}
                      className="launcher-btn-secondary"
                      style={{
                        flex: 1,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "6px",
                        padding: "7px 10px",
                        borderRadius: "10px",
                        fontSize: "12.5px",
                        fontWeight: "600",
                      }}
                    >
                      <IconEye size={14} />
                      <span>Ver</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setActivePlayerCape(pcape)
                        setPlayerCapeModalMode("edit")
                        setIsPlayerCapeModalOpen(true)
                      }}
                      className="launcher-btn-secondary"
                      style={{
                        flex: 1,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "6px",
                        padding: "7px 10px",
                        borderRadius: "10px",
                        fontSize: "12.5px",
                        fontWeight: "600",
                      }}
                    >
                      <IconEdit size={14} />
                      <span>Editar</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeletePlayerCapeItem(pcape)}
                      title="Eliminar capa"
                      className="launcher-btn-danger"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: "34px",
                        height: "34px",
                        borderRadius: "10px",
                        padding: 0,
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
