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
  const [selectedPlayers, setSelectedPlayers] = useState<string[]>([])
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

  const handleSelectCandidate = (name: string) => {
    setSelectedPlayers((prev) => {
      if (prev.some((p) => p.toLowerCase() === name.toLowerCase())) return prev
      return [...prev, name]
    })
    setPlayerNameInput("")
    setShowDropdown(true)
    inputRef.current?.focus()
  }

  const handleRemoveSelectedPlayer = (name: string) => {
    setSelectedPlayers((prev) => prev.filter((p) => p.toLowerCase() !== name.toLowerCase()))
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace") {
      if (playerNameInput === "" && selectedPlayers.length > 0) {
        setSelectedPlayers((prev) => prev.slice(0, -1))
      }
    } else if (e.key === "Escape") {
      setShowDropdown(false)
    } else if (e.key === "Enter") {
      e.preventDefault()
      const clean = playerNameInput.trim()
      if (clean) {
        const match = filteredCandidates.find(
          (c) => c.displayName.toLowerCase() === clean.toLowerCase(),
        )
        if (match) {
          handleSelectCandidate(match.displayName)
        }
      } else if (selectedPlayers.length > 0) {
        handleAddPlayers()
      }
    }
  }

  const handleAddPlayers = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    const pending = playerNameInput.trim()
    const playersToAdd = [...selectedPlayers]
    if (
      pending &&
      !playersToAdd.some((p) => p.toLowerCase() === pending.toLowerCase()) &&
      !(whitelist?.entries || []).some((entry) => entry.name.toLowerCase() === pending.toLowerCase())
    ) {
      playersToAdd.push(pending)
    }

    if (playersToAdd.length === 0 || loading || adding) return

    setAdding(true)
    setPlayerNameInput("")
    setShowDropdown(false)

    const added: string[] = []
    let lastUpdatedWhitelist: ServerWhitelist | null = null

    try {
      for (const name of playersToAdd) {
        lastUpdatedWhitelist = await serverWhitelistApi.addServerWhitelistPlayer(serverId, name)
        added.push(name)
      }
      if (lastUpdatedWhitelist) {
        setWhitelist(lastUpdatedWhitelist)
      }
      setSelectedPlayers((prev) => prev.filter((p) => !added.includes(p)))

      if (added.length === 1) {
        onToast?.(`Jugador "${added[0]}" añadido a la whitelist`, "success")
      } else {
        onToast?.(`${added.length} jugadores añadidos a la whitelist`, "success")
      }
    } catch (err: any) {
      if (lastUpdatedWhitelist) {
        setWhitelist(lastUpdatedWhitelist)
      }
      setSelectedPlayers((prev) => prev.filter((p) => !added.includes(p)))
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
          const alreadySelected = selectedPlayers.some(
            (p) => p.toLowerCase() === c.displayName.toLowerCase(),
          )
          return matchesSearch && !alreadyInWhitelist && !alreadySelected
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
        minHeight: 360,
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

      {/* Add Player Multi-Chip Input Form with Autocomplete */}
      <form
        onSubmit={handleAddPlayers}
        style={{
          display: "flex",
          gap: 8,
          position: "relative",
          alignItems: "flex-start",
        }}
      >
        <div style={{ position: "relative", flex: 1 }}>
          <div
            onClick={() => inputRef.current?.focus()}
            onMouseDown={(e) => {
              if (e.target !== inputRef.current) {
                e.preventDefault()
                inputRef.current?.focus()
                setShowDropdown(true)
              }
            }}
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 6,
              padding: "5px 8px",
              backgroundColor: tokens.bgInput,
              border: `1px solid ${tokens.borderSubtle}`,
              borderRadius: 10,
              minHeight: 38,
              boxSizing: "border-box",
              cursor: "text",
            }}
          >
            {selectedPlayers.map((player) => (
              <div
                key={player}
                data-testid={`chip-${player}`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "2px 8px",
                  borderRadius: 6,
                  backgroundColor: isDark ? "rgba(62, 196, 192, 0.15)" : "#e0f2fe",
                  border: `1px solid ${isDark ? "rgba(62, 196, 192, 0.3)" : "#bae6fd"}`,
                  color: isDark ? "#3ec4c0" : "#0284c7",
                  fontSize: "0.8rem",
                  fontWeight: 500,
                  lineHeight: 1.4,
                  userSelect: "none",
                }}
              >
                <span>{player}</span>
                <button
                  type="button"
                  data-testid={`remove-chip-${player}`}
                  aria-label={`Quitar ${player}`}
                  title={`Quitar ${player}`}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                  }}
                  onClick={(e) => {
                    e.stopPropagation()
                    handleRemoveSelectedPlayer(player)
                    inputRef.current?.focus()
                  }}
                  style={{
                    border: "none",
                    background: "none",
                    color: "inherit",
                    cursor: "pointer",
                    padding: "0 2px",
                    fontSize: "14px",
                    lineHeight: 1,
                    fontWeight: 700,
                    opacity: 0.75,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
                  onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.75")}
                >
                  ×
                </button>
              </div>
            ))}

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
              onKeyDown={handleKeyDown}
              placeholder="Nombre del jugador..."
              disabled={loading || adding}
              style={{
                flex: "1 1 120px",
                minWidth: 90,
                border: "none",
                outline: "none",
                backgroundColor: "transparent",
                color: tokens.textPrimary,
                fontSize: "0.85rem",
                padding: "3px 4px",
              }}
            />
          </div>

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
                    handleSelectCandidate(c.displayName)
                  }}
                  onClick={() => {
                    handleSelectCandidate(c.displayName)
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "6px 10px",
                    border: "none",
                    borderRadius: 8,
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
          disabled={loading || adding || (selectedPlayers.length === 0 && !playerNameInput.trim())}
          className="launcher-btn-primary"
          style={{
            padding: "8px 16px",
            fontSize: "12px",
            fontWeight: 600,
            borderRadius: 10,
            cursor:
              loading || adding || (selectedPlayers.length === 0 && !playerNameInput.trim())
                ? "not-allowed"
                : "pointer",
            opacity: selectedPlayers.length === 0 && !playerNameInput.trim() ? 0.6 : 1,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            height: "fit-content",
            alignSelf: "flex-start",
            marginTop: 2,
          }}
        >
          {adding && <IconSpinner size={13} />}
          <span>Añadir</span>
          {selectedPlayers.length > 1 && <span> ({selectedPlayers.length})</span>}
        </button>
      </form>

      {/* Player List Container with independent scroll */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          maxHeight: 200,
          overflowY: "auto",
          paddingRight: 2,
          flex: 1,
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

