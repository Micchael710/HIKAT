import React, { useState, useEffect, useCallback, useRef } from "react"
import type {
  ThemeMode,
  ServerAutomationItem,
  ServerAutomationInput,
  ServerAutomationAction,
  ServerAutomationFrequency,
} from "../../types"
import { serverApi } from "../../services/graphqlClient"
import {
  IconCalendar,
  IconPlus,
  IconPlay,
  IconEdit,
  IconTrash,
  IconRefresh,
  IconSpinner,
  IconAlertCircle,
  IconCheck,
  IconCross,
  IconArchive,
  IconTerminal,
} from "../../theme/icons"

interface ServerAutomationsViewProps {
  theme: ThemeMode
  onToast: (message: string, type: "success" | "error") => void
}

const WEEKDAYS = [
  { id: 1, label: "Lunes" },
  { id: 2, label: "Martes" },
  { id: 3, label: "Miércoles" },
  { id: 4, label: "Jueves" },
  { id: 5, label: "Viernes" },
  { id: 6, label: "Sábado" },
  { id: 0, label: "Domingo" },
]

export default function ServerAutomationsView({
  theme,
  onToast,
}: ServerAutomationsViewProps) {
  const isDark = theme === "dark"
  const [automations, setAutomations] = useState<ServerAutomationItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Create / Edit modal state
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formData, setFormData] = useState<ServerAutomationInput>({
    name: "",
    action: "BACKUP",
    frequency: "DAILY",
    time: "04:00",
    weekday: 1,
    weekdays: [1, 3, 5],
    command: "",
    enabled: true,
  })
  const [isSaving, setIsSaving] = useState(false)

  // Delete modal state
  const [deleteTarget, setDeleteTarget] = useState<ServerAutomationItem | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  // Action loading map
  const [actionLoadingMap, setActionLoadingMap] = useState<Record<string, boolean>>({})

  const isMountedRef = useRef(true)

  const fetchAutomations = useCallback(async (manual: boolean = false) => {
    if (manual) setIsRefreshing(true)
    setError(null)
    try {
      const data = await serverApi.getServerAutomations()
      if (isMountedRef.current) {
        setAutomations(data)
      }
    } catch (err: unknown) {
      if (isMountedRef.current) {
        setError(
          err instanceof Error
            ? err.message
            : "No se pudieron cargar las automatizaciones.",
        )
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false)
        setIsRefreshing(false)
      }
    }
  }, [])

  useEffect(() => {
    isMountedRef.current = true
    fetchAutomations()
    return () => {
      isMountedRef.current = false
    }
  }, [fetchAutomations])

  const openCreateModal = () => {
    setEditingId(null)
    setFormData({
      name: "",
      action: "BACKUP",
      frequency: "DAILY",
      time: "04:00",
      weekday: 1,
      weekdays: [1, 3, 5],
      command: "",
      enabled: true,
    })
    setIsModalOpen(true)
  }

  const openEditModal = (item: ServerAutomationItem) => {
    setEditingId(item.id)
    setFormData({
      name: item.name,
      action: item.action,
      frequency: item.frequency,
      time: item.time,
      weekday: item.weekday ?? 1,
      weekdays: item.weekdays ?? [1, 3, 5],
      command: item.command ?? "",
      enabled: item.enabled,
    })
    setIsModalOpen(true)
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.name.trim()) return

    if (formData.action === "COMMAND" && formData.command?.trim().toLowerCase().startsWith("kill")) {
      onToast("No se permite el comando kill en automatizaciones programadas.", "error")
      return
    }

    setIsSaving(true)
    try {
      if (editingId) {
        await serverApi.updateServerAutomation(editingId, formData)
        onToast("Automatización actualizada exitosamente.", "success")
      } else {
        await serverApi.createServerAutomation(formData)
        onToast("Automatización creada exitosamente.", "success")
      }
      setIsModalOpen(false)
      await fetchAutomations(true)
    } catch (err: unknown) {
      onToast(
        err instanceof Error ? err.message : "Error al guardar automatización.",
        "error",
      )
    } finally {
      setIsSaving(false)
    }
  }

  const handleRunNow = async (item: ServerAutomationItem) => {
    setActionLoadingMap((prev) => ({ ...prev, [item.id]: true }))
    try {
      await serverApi.runServerAutomation(item.id)
      onToast(`Ejecución de "${item.name}" iniciada.`, "success")
      await fetchAutomations(true)
    } catch (err: unknown) {
      onToast(
        err instanceof Error ? err.message : "Error al ejecutar automatización.",
        "error",
      )
    } finally {
      setActionLoadingMap((prev) => ({ ...prev, [item.id]: false }))
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setIsDeleting(true)
    try {
      await serverApi.deleteServerAutomation(deleteTarget.id)
      onToast("Automatización eliminada.", "success")
      setDeleteTarget(null)
      await fetchAutomations(true)
    } catch (err: unknown) {
      onToast(
        err instanceof Error ? err.message : "Error al eliminar automatización.",
        "error",
      )
    } finally {
      setIsDeleting(false)
    }
  }

  const formatFrequencyLabel = (item: ServerAutomationItem) => {
    if (item.frequency === "DAILY") {
      return `Todos los días a las ${item.time}`
    }
    if (item.frequency === "WEEKLY") {
      const day = WEEKDAYS.find((d) => d.id === item.weekday)?.label || "Día seleccionado"
      return `Cada ${day} a las ${item.time}`
    }
    if (item.frequency === "SELECTED_DAYS" && item.weekdays) {
      const days = item.weekdays.map((dId) => WEEKDAYS.find((d) => d.id === dId)?.label.slice(0, 3)).join(", ")
      return `${days} a las ${item.time}`
    }
    return `A las ${item.time}`
  }

  const getActionBadge = (action: ServerAutomationAction) => {
    switch (action) {
      case "BACKUP":
        return { label: "Copia de seguridad", color: isDark ? "#3ec4c0" : "#0f766e", bg: isDark ? "rgba(62,196,192,0.15)" : "#ccfbf1" }
      case "RESTART":
        return { label: "Reiniciar servidor", color: isDark ? "#60a5fa" : "#1d4ed8", bg: isDark ? "rgba(59,130,246,0.15)" : "#dbeafe" }
      case "START":
        return { label: "Iniciar servidor", color: isDark ? "#4ade80" : "#15803d", bg: isDark ? "rgba(74,222,128,0.15)" : "#dcfce7" }
      case "STOP":
        return { label: "Apagar servidor", color: isDark ? "#f87171" : "#b91c1c", bg: isDark ? "rgba(248,113,113,0.15)" : "#fee2e2" }
      case "COMMAND":
        return { label: "Comando", color: isDark ? "#c084fc" : "#7e22ce", bg: isDark ? "rgba(192,132,252,0.15)" : "#f3e8ff" }
    }
  }

  if (isLoading) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "64px 0",
          color: isDark ? "#3ec4c0" : "#0c6e6b",
          gap: 12,
        }}
      >
        <IconSpinner size={32} />
        <span style={{ fontSize: "0.95rem", fontWeight: 500 }}>
          Cargando automatizaciones...
        </span>
      </div>
    )
  }

  if (error) {
    return (
      <div
        style={{
          padding: 24,
          borderRadius: 16,
          background: isDark ? "rgba(239, 68, 68, 0.1)" : "#fee2e2",
          border: `1px solid ${isDark ? "rgba(239, 68, 68, 0.25)" : "#fca5a5"}`,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 16,
          textAlign: "center",
          margin: "24px 0",
        }}
      >
        <div style={{ color: "#ef4444" }}>
          <IconAlertCircle size={36} />
        </div>
        <div>
          <h3 style={{ margin: 0, fontSize: "1.1rem", color: isDark ? "#ffffff" : "#991b1b" }}>
            No se pudieron cargar las automatizaciones
          </h3>
          <p style={{ margin: "6px 0 0 0", fontSize: "0.875rem", color: isDark ? "rgba(255,255,255,0.7)" : "#7f1d1d" }}>
            {error}
          </p>
        </div>
        <button
          type="button"
          onClick={() => fetchAutomations(true)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 18px",
            borderRadius: 10,
            border: "none",
            background: "#ef4444",
            color: "#ffffff",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          <IconRefresh size={16} />
          <span>Reintentar</span>
        </button>
      </div>
    )
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Header bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <h2
            style={{
              margin: 0,
              fontSize: "1.25rem",
              fontWeight: 800,
              color: isDark ? "#ffffff" : "#0f172a",
            }}
          >
            Automatizaciones programadas ({automations.length})
          </h2>
          <button
            type="button"
            onClick={() => fetchAutomations(true)}
            disabled={isRefreshing}
            style={{
              border: "none",
              background: "transparent",
              color: isDark ? "rgba(255,255,255,0.6)" : "rgba(0,0,0,0.6)",
              cursor: isRefreshing ? "not-allowed" : "pointer",
              padding: 4,
              display: "flex",
              alignItems: "center",
            }}
          >
            {isRefreshing ? <IconSpinner size={16} /> : <IconRefresh size={16} />}
          </button>
        </div>

        <button
          type="button"
          onClick={openCreateModal}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 20px",
            borderRadius: 12,
            border: "none",
            background: isDark ? "#3ec4c0" : "#0c6e6b",
            color: "#ffffff",
            fontWeight: 700,
            fontSize: "0.9rem",
            cursor: "pointer",
            boxShadow: "0 4px 14px rgba(62, 196, 192, 0.3)",
          }}
        >
          <IconPlus size={18} />
          <span>Nueva automatización</span>
        </button>
      </div>

      {/* Automations list */}
      {automations.length === 0 ? (
        <div
          style={{
            padding: 48,
            borderRadius: 20,
            background: isDark ? "rgba(19, 28, 35, 0.85)" : "#ffffff",
            border: `1px solid ${isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.06)"}`,
            textAlign: "center",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div style={{ color: isDark ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.2)" }}>
            <IconCalendar size={48} />
          </div>
          <h3 style={{ margin: 0, fontSize: "1.1rem", color: isDark ? "#ffffff" : "#0f172a" }}>
            No hay tareas programadas
          </h3>
          <p style={{ margin: 0, fontSize: "0.875rem", color: isDark ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.5)" }}>
            Programa reinicios automáticos, copias de seguridad periódicas o comandos diarios.
          </p>
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))",
            gap: 16,
          }}
        >
          {automations.map((item) => {
            const badge = getActionBadge(item.action)
            const isLoadingAction = actionLoadingMap[item.id] || false
            return (
              <div
                key={item.id}
                style={{
                  padding: 20,
                  borderRadius: 16,
                  background: isDark ? "rgba(19, 28, 35, 0.85)" : "#ffffff",
                  border: `1px solid ${isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.06)"}`,
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  gap: 16,
                  boxShadow: isDark ? "0 4px 16px rgba(0,0,0,0.15)" : "0 2px 8px rgba(0,0,0,0.03)",
                }}
              >
                <div>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                    <div>
                      <h4
                        style={{
                          margin: 0,
                          fontSize: "1.05rem",
                          fontWeight: 700,
                          color: isDark ? "#ffffff" : "#0f172a",
                        }}
                      >
                        {item.name}
                      </h4>
                      <div style={{ marginTop: 6, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                        <span
                          style={{
                            padding: "3px 8px",
                            borderRadius: 6,
                            background: badge.bg,
                            color: badge.color,
                            fontSize: "0.75rem",
                            fontWeight: 700,
                          }}
                        >
                          {badge.label}
                        </span>
                        {!item.enabled && (
                          <span
                            style={{
                              padding: "3px 8px",
                              borderRadius: 6,
                              background: isDark ? "rgba(255,255,255,0.08)" : "#f1f5f9",
                              color: isDark ? "rgba(255,255,255,0.5)" : "#64748b",
                              fontSize: "0.75rem",
                              fontWeight: 600,
                            }}
                          >
                            Desactivada
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 6, fontSize: "0.85rem", color: isDark ? "rgba(255,255,255,0.6)" : "rgba(0,0,0,0.6)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <IconCalendar size={14} />
                      <span>{formatFrequencyLabel(item)}</span>
                    </div>
                    {item.action === "COMMAND" && item.command && (
                      <div style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: "monospace", fontSize: "0.8rem", color: isDark ? "#c084fc" : "#7e22ce" }}>
                        <IconTerminal size={14} />
                        <span>{item.command}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Actions row */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    paddingTop: 12,
                    borderTop: `1px solid ${isDark ? "rgba(255, 255, 255, 0.06)" : "rgba(0, 0, 0, 0.05)"}`,
                    gap: 8,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => handleRunNow(item)}
                    disabled={isLoadingAction}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "6px 12px",
                      borderRadius: 8,
                      border: "none",
                      background: isDark ? "rgba(62, 196, 192, 0.15)" : "#e0f2f1",
                      color: isDark ? "#3ec4c0" : "#00897b",
                      fontSize: "0.8rem",
                      fontWeight: 700,
                      cursor: isLoadingAction ? "not-allowed" : "pointer",
                    }}
                  >
                    {isLoadingAction ? <IconSpinner size={14} /> : <IconPlay size={14} />}
                    <span>Ejecutar ahora</span>
                  </button>

                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      type="button"
                      title="Editar"
                      onClick={() => openEditModal(item)}
                      style={{
                        padding: "6px 10px",
                        borderRadius: 8,
                        border: `1px solid ${isDark ? "rgba(255,255,255,0.1)" : "#e2e8f0"}`,
                        background: "transparent",
                        color: isDark ? "#ffffff" : "#334155",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                      }}
                    >
                      <IconEdit size={16} />
                    </button>

                    <button
                      type="button"
                      title="Eliminar"
                      onClick={() => setDeleteTarget(item)}
                      style={{
                        padding: "6px 10px",
                        borderRadius: 8,
                        border: `1px solid ${isDark ? "rgba(255,255,255,0.1)" : "#e2e8f0"}`,
                        background: "transparent",
                        color: "#ef4444",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                      }}
                    >
                      <IconTrash size={16} />
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Create / Edit Modal */}
      {isModalOpen && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0, 0, 0, 0.65)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            padding: 16,
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 520,
              maxHeight: "90vh",
              overflowY: "auto",
              borderRadius: 20,
              background: isDark ? "#131c23" : "#ffffff",
              border: `1px solid ${isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)"}`,
              padding: 28,
              boxShadow: "0 24px 60px rgba(0,0,0,0.35)",
              display: "flex",
              flexDirection: "column",
              gap: 20,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <h3 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 700, color: isDark ? "#ffffff" : "#0f172a" }}>
                {editingId ? "Editar automatización" : "Nueva automatización"}
              </h3>
              <button
                type="button"
                onClick={() => !isSaving && setIsModalOpen(false)}
                style={{
                  border: "none",
                  background: "transparent",
                  color: isDark ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.5)",
                  cursor: "pointer",
                  padding: 4,
                }}
              >
                <IconCross size={20} />
              </button>
            </div>

            <form onSubmit={handleSave} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <label style={{ display: "block", fontSize: "0.875rem", fontWeight: 600, marginBottom: 6, color: isDark ? "rgba(255,255,255,0.8)" : "#334155" }}>
                  Nombre descriptivo:
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ej: Reinicio diario nocturno"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  style={{
                    width: "100%",
                    padding: "10px 14px",
                    borderRadius: 10,
                    background: isDark ? "rgba(255,255,255,0.05)" : "#f8fafc",
                    border: `1px solid ${isDark ? "rgba(255,255,255,0.1)" : "#cbd5e1"}`,
                    color: isDark ? "#ffffff" : "#0f172a",
                    boxSizing: "border-box",
                  }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "0.875rem", fontWeight: 600, marginBottom: 6, color: isDark ? "rgba(255,255,255,0.8)" : "#334155" }}>
                  Acción a ejecutar:
                </label>
                <select
                  value={formData.action}
                  onChange={(e) => setFormData({ ...formData, action: e.target.value as ServerAutomationAction })}
                  style={{
                    width: "100%",
                    padding: "10px 14px",
                    borderRadius: 10,
                    background: isDark ? "#1a252f" : "#f8fafc",
                    border: `1px solid ${isDark ? "rgba(255,255,255,0.1)" : "#cbd5e1"}`,
                    color: isDark ? "#ffffff" : "#0f172a",
                    boxSizing: "border-box",
                  }}
                >
                  <option value="BACKUP">Crear copia de seguridad</option>
                  <option value="RESTART">Reiniciar servidor</option>
                  <option value="START">Iniciar servidor</option>
                  <option value="STOP">Apagar servidor</option>
                  <option value="COMMAND">Ejecutar comando</option>
                </select>
              </div>

              {formData.action === "COMMAND" && (
                <div>
                  <label style={{ display: "block", fontSize: "0.875rem", fontWeight: 600, marginBottom: 6, color: isDark ? "rgba(255,255,255,0.8)" : "#334155" }}>
                    Comando de Minecraft:
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Ej: say Guardado automático completado"
                    value={formData.command || ""}
                    onChange={(e) => setFormData({ ...formData, command: e.target.value })}
                    style={{
                      width: "100%",
                      padding: "10px 14px",
                      borderRadius: 10,
                      background: isDark ? "rgba(255,255,255,0.05)" : "#f8fafc",
                      border: `1px solid ${isDark ? "rgba(255,255,255,0.1)" : "#cbd5e1"}`,
                      color: isDark ? "#ffffff" : "#0f172a",
                      boxSizing: "border-box",
                      fontFamily: "monospace",
                    }}
                  />
                </div>
              )}

              <div>
                <label style={{ display: "block", fontSize: "0.875rem", fontWeight: 600, marginBottom: 6, color: isDark ? "rgba(255,255,255,0.8)" : "#334155" }}>
                  Frecuencia:
                </label>
                <select
                  value={formData.frequency}
                  onChange={(e) => setFormData({ ...formData, frequency: e.target.value as ServerAutomationFrequency })}
                  style={{
                    width: "100%",
                    padding: "10px 14px",
                    borderRadius: 10,
                    background: isDark ? "#1a252f" : "#f8fafc",
                    border: `1px solid ${isDark ? "rgba(255,255,255,0.1)" : "#cbd5e1"}`,
                    color: isDark ? "#ffffff" : "#0f172a",
                    boxSizing: "border-box",
                  }}
                >
                  <option value="DAILY">Todos los días</option>
                  <option value="WEEKLY">Una vez por semana</option>
                  <option value="SELECTED_DAYS">Días seleccionados</option>
                </select>
              </div>

              {formData.frequency === "WEEKLY" && (
                <div>
                  <label style={{ display: "block", fontSize: "0.875rem", fontWeight: 600, marginBottom: 6, color: isDark ? "rgba(255,255,255,0.8)" : "#334155" }}>
                    Día de la semana:
                  </label>
                  <select
                    value={formData.weekday ?? 1}
                    onChange={(e) => setFormData({ ...formData, weekday: parseInt(e.target.value, 10) })}
                    style={{
                      width: "100%",
                      padding: "10px 14px",
                      borderRadius: 10,
                      background: isDark ? "#1a252f" : "#f8fafc",
                      border: `1px solid ${isDark ? "rgba(255,255,255,0.1)" : "#cbd5e1"}`,
                      color: isDark ? "#ffffff" : "#0f172a",
                      boxSizing: "border-box",
                    }}
                  >
                    {WEEKDAYS.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {formData.frequency === "SELECTED_DAYS" && (
                <div>
                  <label style={{ display: "block", fontSize: "0.875rem", fontWeight: 600, marginBottom: 8, color: isDark ? "rgba(255,255,255,0.8)" : "#334155" }}>
                    Días seleccionados:
                  </label>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {WEEKDAYS.map((d) => {
                      const isSelected = formData.weekdays?.includes(d.id)
                      return (
                        <button
                          key={d.id}
                          type="button"
                          onClick={() => {
                            const current = formData.weekdays || []
                            const next = isSelected ? current.filter((x) => x !== d.id) : [...current, d.id]
                            setFormData({ ...formData, weekdays: next })
                          }}
                          style={{
                            padding: "6px 12px",
                            borderRadius: 8,
                            border: `1px solid ${isSelected ? "#3ec4c0" : isDark ? "rgba(255,255,255,0.1)" : "#cbd5e1"}`,
                            background: isSelected ? (isDark ? "rgba(62,196,192,0.2)" : "#ccfbf1") : "transparent",
                            color: isSelected ? (isDark ? "#3ec4c0" : "#0f766e") : (isDark ? "#ffffff" : "#334155"),
                            fontSize: "0.8rem",
                            fontWeight: 600,
                            cursor: "pointer",
                          }}
                        >
                          {d.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              <div>
                <label style={{ display: "block", fontSize: "0.875rem", fontWeight: 600, marginBottom: 6, color: isDark ? "rgba(255,255,255,0.8)" : "#334155" }}>
                  Hora de ejecución (HH:mm):
                </label>
                <input
                  type="time"
                  required
                  value={formData.time}
                  onChange={(e) => setFormData({ ...formData, time: e.target.value })}
                  style={{
                    width: "100%",
                    padding: "10px 14px",
                    borderRadius: 10,
                    background: isDark ? "#1a252f" : "#f8fafc",
                    border: `1px solid ${isDark ? "rgba(255,255,255,0.1)" : "#cbd5e1"}`,
                    color: isDark ? "#ffffff" : "#0f172a",
                    boxSizing: "border-box",
                  }}
                />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, marginTop: 8 }}>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  disabled={isSaving}
                  style={{
                    padding: "10px 18px",
                    borderRadius: 10,
                    border: `1px solid ${isDark ? "rgba(255,255,255,0.1)" : "#cbd5e1"}`,
                    background: "transparent",
                    color: isDark ? "#ffffff" : "#334155",
                    cursor: "pointer",
                    fontWeight: 600,
                  }}
                >
                  Cancelar
                </button>

                <button
                  type="submit"
                  disabled={isSaving}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "10px 22px",
                    borderRadius: 10,
                    border: "none",
                    background: isDark ? "#3ec4c0" : "#0c6e6b",
                    color: "#ffffff",
                    cursor: isSaving ? "not-allowed" : "pointer",
                    fontWeight: 700,
                  }}
                >
                  {isSaving ? <IconSpinner size={18} /> : <IconCheck size={18} />}
                  <span>{isSaving ? "Guardando..." : "Guardar"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0, 0, 0, 0.65)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            padding: 16,
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 440,
              borderRadius: 20,
              background: isDark ? "#131c23" : "#ffffff",
              border: `1px solid ${isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)"}`,
              padding: 28,
              boxShadow: "0 24px 60px rgba(0,0,0,0.35)",
              display: "flex",
              flexDirection: "column",
              gap: 20,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ color: "#ef4444" }}>
                <IconTrash size={28} />
              </div>
              <h3 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 700, color: isDark ? "#ffffff" : "#0f172a" }}>
                Eliminar automatización
              </h3>
            </div>

            <p style={{ margin: 0, fontSize: "0.9rem", color: isDark ? "rgba(255,255,255,0.8)" : "#334155" }}>
              ¿Estás seguro de eliminar <strong>{deleteTarget.name}</strong>?
            </p>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 12 }}>
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                disabled={isDeleting}
                style={{
                  padding: "10px 18px",
                  borderRadius: 10,
                  border: `1px solid ${isDark ? "rgba(255,255,255,0.1)" : "#cbd5e1"}`,
                  background: "transparent",
                  color: isDark ? "#ffffff" : "#334155",
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                Cancelar
              </button>

              <button
                type="button"
                onClick={handleDelete}
                disabled={isDeleting}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "10px 22px",
                  borderRadius: 10,
                  border: "none",
                  background: "#ef4444",
                  color: "#ffffff",
                  cursor: isDeleting ? "not-allowed" : "pointer",
                  fontWeight: 700,
                }}
              >
                {isDeleting ? <IconSpinner size={18} /> : <IconTrash size={18} />}
                <span>{isDeleting ? "Eliminando..." : "Eliminar"}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
