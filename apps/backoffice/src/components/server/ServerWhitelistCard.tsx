import React, { useState, useEffect, useCallback, useRef } from "react"
import type { ThemeMode, ServerWhitelist, HikatWhitelistCandidate } from "../../types"
import { serverWhitelistApi } from "../../services/graphqlClient"
import { getThemeTokens } from "../../theme/tokens"
import { IconShieldCheck, IconTrash, IconSpinner, IconRefresh } from "../../theme/icons"
import SkinHeadPreview from "../skins/SkinHeadPreview"

interface ServerWhitelistCardProps {
  theme: ThemeMode
  serverId: string
  onToast?: (msg: string, type?: "success" | "error") => void
}

export default function ServerWhitelistCard({
  theme,
  serverId,
  onToast,
}: ServerWhitelistCardProps) {
  const isDark = theme === "dark"
  const tokens = getThemeTokens(theme)
  const [whitelist, setWhitelist] = useState<ServerWhitelist | null>(null)
  const [candidates, setCandidates] = useState<HikatWhitelistCandidate[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [toggling, setToggling] = useState<boolean>(false)
  const [adding, setAdding] = useState<boolean>(false)
  const [removingName, setRemovingName] = useState<string | null>(null)
  const [playerNameInput, setPlayerNameInput] = useState<string>("")
  const [showDropdown, setShowDropdown] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const fetchWhitelist = useCallback(async () => {
    try {
      setError(null)
      const [data, cands] = await Promise.all([
        serverWhitelistApi.getServerWhitelist(serverId),
        serverWhitelistApi.getHikatWhitelistCandidates().catch(() => []),
      ])
      setWhitelist(data)
      setCandidates(cands || [])
    } catch (err: any) {
      const msg = err.message || "Error al cargar la whitelist"
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [serverId])

  useEffect(() => {
    fetchWhitelist()
  }, [fetchWhitelist])

  const handleToggle = async () => {
    if (!whitelist || toggling) return
    const targetState = !whitelist.enabled
    setToggling(true)
    try {
      const updated = await serverWhitelistApi.setServerWhitelistEnabled(serverId, targetState)
      setWhitelist(updated)
      onToast?.(
        targetState ? "Whitelist activada correctamente" : "Whitelist desactivada",
        "success",
      )
    } catch (err: any) {
      const msg = err.message || "Error al cambiar el estado de la whitelist"
      onToast?.(msg, "error")
    } finally {
      setToggling(false)
    }
  }

  const handleAddPlayer = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    const clean = playerNameInput.trim()
    if (!clean || adding) return

    setAdding(true)
    setShowDropdown(false)
    try {
      const updated = await serverWhitelistApi.addServerWhitelistPlayer(serverId, clean)
      setWhitelist(updated)
      setPlayerNameInput("")
      onToast?.(`Jugador "${clean}" añadido a la whitelist`, "success")
    } catch (err: any) {
      const msg = err.message || "Error al añadir jugador"
      onToast?.(msg, "error")
    } finally {
      setAdding(false)
    }
  }

  const handleRemovePlayer = async (name: string) => {
    if (removingName) return
    setRemovingName(name)
    try {
      const updated = await serverWhitelistApi.removeServerWhitelistPlayer(serverId, name)
      setWhitelist(updated)
      onToast?.(`Jugador "${name}" eliminado de la whitelist`, "success")
    } catch (err: any) {
      const msg = err.message || "Error al eliminar jugador"
      onToast?.(msg, "error")
    } finally {
      setRemovingName(null)
    }
  }

  const modeSubtitle =
    whitelist?.mode === "HIKAT"
      ? "Whitelist de HiKAT"
      : "Whitelist nativa de Minecraft"

  const filteredCandidates =
    whitelist?.mode === "HIKAT"
      ? candidates.filter((c) => {
          const cleanInput = playerNameInput.trim().toLowerCase()
          const matchesSearch = cleanInput ? c.displayName.toLowerCase().includes(cleanInput) : true
          const alreadyInWhitelist = whitelist.entries.some(
            (e) => e.name.toLowerCase() === c.displayName.toLowerCase(),
          )
          return matchesSearch && !alreadyInWhitelist
        })
      : []

  return (
    <div
      style={{
        padding: "20px 24px",
        borderRadius: 18,
        background: tokens.bgCard,
        border: `1px solid ${tokens.borderSubtle}`,
        display: "flex",
        flexDirection: "column",
        gap: 14,
        boxShadow: tokens.cardShadow,
        boxSizing: "border-box",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ color: isDark ? "#3ec4c0" : "#0c6e6b" }}>
              <IconShieldCheck size={20} />
            </div>
            <h3
              style={{
                margin: 0,
                fontSize: "1.1rem",
                fontWeight: 700,
                color: tokens.textPrimary,
              }}
            >
              Whitelist {whitelist ? `(${whitelist.entries.length})` : ""}
            </h3>
          </div>
          <span
            style={{
              fontSize: "0.78rem",
              color: tokens.textSecondary,
              marginTop: 3,
              display: "block",
              marginLeft: 30,
            }}
          >
            {modeSubtitle}
          </span>
        </div>

        {/* Refresh & Toggle Switch */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            type="button"
            onClick={fetchWhitelist}
            title="Recargar whitelist"
            className="launcher-btn-secondary"
            style={{
              padding: "6px 8px",
              borderRadius: 8,
              fontSize: "12px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <IconRefresh size={14} />
          </button>

          <button
            type="button"
            onClick={handleToggle}
            disabled={loading || toggling}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 14px",
              borderRadius: 10,
              fontSize: "12px",
              fontWeight: 600,
              cursor: loading || toggling ? "not-allowed" : "pointer",
              border: `1px solid ${
                whitelist?.enabled
                  ? isDark ? "rgba(34, 197, 94, 0.4)" : "#86efac"
                  : tokens.borderSubtle
              }`,
              backgroundColor: whitelist?.enabled
                ? isDark ? "rgba(34, 197, 94, 0.15)" : "#f0fdf4"
                : tokens.bgInput,
              color: whitelist?.enabled
                ? isDark ? "#4ade80" : "#16a34a"
                : tokens.textMuted,
              transition: "all 0.15s ease",
            }}
          >
            {toggling && <IconSpinner size={13} />}
            {whitelist?.enabled ? "Activada" : "Desactivada"}
          </button>
        </div>
      </div>

      {error && (
        <div
          style={{
            fontSize: "0.82rem",
            color: "#f87171",
            backgroundColor: isDark ? "rgba(239, 68, 68, 0.12)" : "#fef2f2",
            padding: "8px 12px",
            borderRadius: 10,
            border: `1px solid ${isDark ? "rgba(239, 68, 68, 0.25)" : "#fecaca"}`,
          }}
        >
          {error}
        </div>
      )}

      {/* Add Player Input Form with Autocomplete */}
      <form
        onSubmit={handleAddPlayer}
        style={{
          display: "flex",
          gap: 8,
          position: "relative",
        }}
      >
        <div style={{ position: "relative", flex: 1 }}>
          <input
            ref={inputRef}
            type="text"
            value={playerNameInput}
            onChange={(e) => {
              setPlayerNameInput(e.target.value)
              setShowDropdown(true)
            }}
            onFocus={() => setShowDropdown(true)}
            onBlur={() => setShowDropdown(false)}
            placeholder="Nombre del jugador..."
            disabled={loading || adding}
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "8px 12px",
              fontSize: "0.85rem",
              backgroundColor: tokens.bgInput,
              color: tokens.textPrimary,
              border: `1px solid ${tokens.borderSubtle}`,
              borderRadius: 10,
              outline: "none",
            }}
          />

          {/* Autocomplete Dropdown */}
          {showDropdown && filteredCandidates.length > 0 && (
            <div
              data-testid="candidates-dropdown"
              style={{
                position: "absolute",
                top: "calc(100% + 4px)",
                left: 0,
                right: 0,
                backgroundColor: tokens.bgCard,
                border: `1px solid ${tokens.borderSubtle}`,
                borderRadius: 10,
                boxShadow: isDark
                  ? "0 10px 25px -5px rgba(0, 0, 0, 0.6)"
                  : "0 10px 25px -5px rgba(0, 0, 0, 0.1)",
                maxHeight: 180,
                overflowY: "auto",
                zIndex: 50,
                padding: "4px",
                display: "flex",
                flexDirection: "column",
                gap: 2,
              }}
              className="custom-scroll"
            >
              {filteredCandidates.slice(0, 8).map((c) => (
                <button
                  key={c.displayName}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    setPlayerNameInput(c.displayName)
                    setShowDropdown(false)
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "6px 10px",
                    borderRadius: 6,
                    border: "none",
                    backgroundColor: "transparent",
                    color: tokens.textPrimary,
                    cursor: "pointer",
                    textAlign: "left",
                    width: "100%",
                    fontSize: "0.85rem",
                    transition: "background-color 0.15s ease",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = isDark
                      ? "rgba(255, 255, 255, 0.08)"
                      : "rgba(0, 0, 0, 0.05)"
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = "transparent"
                  }}
                >
                  <SkinHeadPreview imageUrl={c.skinImageUrl} size={22} />
                  <span style={{ fontWeight: 500 }}>{c.displayName}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          type="submit"
          disabled={loading || adding || !playerNameInput.trim()}
          className="launcher-btn-primary"
          style={{
            padding: "8px 16px",
            fontSize: "12px",
            fontWeight: 600,
            borderRadius: 10,
            cursor:
              loading || adding || !playerNameInput.trim()
                ? "not-allowed"
                : "pointer",
            opacity: !playerNameInput.trim() ? 0.6 : 1,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            height: "fit-content",
            alignSelf: "flex-start",
          }}
        >
          {adding && <IconSpinner size={13} />}
          Añadir
        </button>
      </form>

      {/* Player List Container with independent scroll */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          maxHeight: 180,
          overflowY: "auto",
          paddingRight: 2,
        }}
        className="custom-scroll"
      >
        {loading ? (
          <div
            style={{
              padding: "24px 0",
              textAlign: "center",
              color: tokens.textMuted,
              fontSize: "0.85rem",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
            }}
          >
            <IconSpinner size={16} />
            Cargando whitelist...
          </div>
        ) : whitelist?.entries && whitelist.entries.length > 0 ? (
          whitelist.entries.map((entry) => {
            const matchedCandidate = candidates.find(
              (c) => c.displayName.toLowerCase() === entry.name.toLowerCase(),
            )

            return (
              <div
                key={entry.name}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "8px 12px",
                  borderRadius: 8,
                  backgroundColor: tokens.bgInput,
                  border: `1px solid ${tokens.borderSubtle}`,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  {whitelist.mode === "HIKAT" && (
                    <SkinHeadPreview
                      imageUrl={matchedCandidate?.skinImageUrl}
                      size={22}
                    />
                  )}
                  <span
                    style={{
                      fontSize: "0.85rem",
                      fontWeight: 500,
                      color: tokens.textPrimary,
                    }}
                  >
                    {entry.name}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => handleRemovePlayer(entry.name)}
                  disabled={removingName === entry.name}
                  title={`Eliminar ${entry.name}`}
                  style={{
                    background: "none",
                    border: "none",
                    color:
                      removingName === entry.name
                        ? tokens.textMuted
                        : isDark ? "#f87171" : "#dc2626",
                    cursor:
                      removingName === entry.name ? "not-allowed" : "pointer",
                    padding: "4px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: 6,
                  }}
                >
                  {removingName === entry.name ? (
                    <IconSpinner size={13} />
                  ) : (
                    <IconTrash size={14} />
                  )}
                </button>
              </div>
            )
          })
        ) : (
          <div
            style={{
              padding: "24px 0",
              textAlign: "center",
              color: tokens.textMuted,
              fontSize: "0.85rem",
            }}
          >
            No hay jugadores en la whitelist.
          </div>
        )}
      </div>
    </div>
  )
}

