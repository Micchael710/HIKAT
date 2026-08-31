import React, { useState, useEffect, useCallback, useRef } from "react"
import type {
  ThemeMode,
  ServerAutomationItem,
  ServerAutomationInput,
  ServerTaskTemplate,
  ServerAutomationAction,
  ServerAutomationFrequency,
  ServerStatus,
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
  IconClock,
} from "../../theme/icons"

interface ServerTasksViewProps {
  theme: ThemeMode
  serverStatus?: ServerStatus
  onToast: (message: string, type: "success" | "error") => void
}

interface TemplateMeta {
  id: ServerTaskTemplate
  label: string
  description: string
  defaultName: string
  icon: string
  action?: ServerAutomationAction
  needsCommand?: boolean
  needsDelay?: boolean
  needsMessage?: boolean
}

const TASK_TEMPLATES: TemplateMeta[] = [
  {
    id: "AUTO_STOP",
    label: "Apagado automático",
    description: "Apaga el servidor de forma segura según el horario establecido.",
    defaultName: "Apagado automático",
    icon: "⏹",
    action: "STOP",
  },
  {
    id: "AUTO_START",
    label: "Encendido automático",
    description: "Inicia el servidor automáticamente a una hora específica.",
    defaultName: "Encendido automático",
    icon: "▶",
    action: "START",
  },
  {
    id: "AUTO_RESTART",
    label: "Reinicio programado",
    description: "Reinicia el servidor en horarios de baja actividad para mantener el rendimiento.",
    defaultName: "Reinicio programado",
    icon: "🔄",
    action: "RESTART",
  },
  {
    id: "AUTO_BACKUP",
    label: "Backup automático",
    description: "Crea una copia de seguridad periódica sin interrumpir el juego.",
    defaultName: "Backup automático",
    icon: "💾",
    action: "BACKUP",
  },
  {
    id: "RUN_COMMAND",
    label: "Ejecutar comando",
    description: "Envía un comando de consola de Minecraft de manera programada.",
    defaultName: "Comando programado",
    icon: "💻",
    action: "COMMAND",
    needsCommand: true,
  },
  {
    id: "BACKUP_AND_RESTART",
    label: "Backup antes de reiniciar",
    description: "Genera una copia de seguridad y tras unos segundos reinicia el servidor.",
    defaultName: "Backup y reinicio",
    icon: "📦",
    action: "RESTART",
    needsDelay: true,
  },
  {
    id: "BACKUP_AND_STOP",
    label: "Backup antes de apagar",
    description: "Genera una copia de seguridad y tras unos segundos apaga el servidor.",
    defaultName: "Backup y apagado",
    icon: "🛑",
    action: "STOP",
    needsDelay: true,
  },
  {
    id: "WARN_AND_RESTART",
    label: "Avisar a jugadores y reiniciar",
    description: "Envía un mensaje de advertencia al chat y reinicia el servidor.",
    defaultName: "Aviso y reinicio",
    icon: "📢",
    action: "RESTART",
    needsMessage: true,
    needsDelay: true,
  },
  {
    id: "WARN_AND_STOP",
    label: "Avisar a jugadores y apagar",
    description: "Envía un mensaje de advertencia al chat y apaga el servidor.",
    defaultName: "Aviso y apagado",
    icon: "⚠️",
    action: "STOP",
    needsMessage: true,
    needsDelay: true,
  },
  {
    id: "SAVE_AND_BACKUP",
    label: "Guardar mundo y backup",
    description: "Fuerza el guardado del mundo (save-all flush) y luego genera el backup.",
    defaultName: "Guardado y backup",
    icon: "🛡️",
    action: "BACKUP",
    needsDelay: true,
  },
  {
    id: "CUSTOM",
    label: "Tarea personalizada",
    description: "Configuración personalizada de comandos u operaciones.",
    defaultName: "Tarea personalizada",
    icon: "⚙️",
    action: "COMMAND",
    needsCommand: true,
  },
]

const WEEKDAYS = [
  { id: 1, label: "Lunes", short: "L" },
  { id: 2, label: "Martes", short: "M" },
  { id: 3, label: "Miércoles", short: "X" },
  { id: 4, label: "Jueves", short: "J" },
  { id: 5, label: "Viernes", short: "V" },
  { id: 6, label: "Sábado", short: "S" },
  { id: 0, label: "Domingo", short: "D" },
]

const INTERVAL_OPTIONS = [
  { value: 1, label: "Cada 1 hora" },
  { value: 2, label: "Cada 2 horas" },
  { value: 3, label: "Cada 3 horas" },
  { value: 4, label: "Cada 4 horas" },
  { value: 6, label: "Cada 6 horas" },
  { value: 8, label: "Cada 8 horas" },
  { value: 12, label: "Cada 12 horas" },
  { value: 24, label: "Cada 24 horas" },
]

export default function ServerTasksView({
  theme,
  serverStatus,
  onToast,
}: ServerTasksViewProps) {
  const isDark = theme === "dark"
  const [tasks, setTasks] = useState<ServerAutomationItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isDisconnected =
    serverStatus === "DISCONNECTED" || (Boolean(error) && tasks.length === 0)

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formData, setFormData] = useState<{
    name: string
    template: ServerTaskTemplate
    frequency: ServerAutomationFrequency
    time: string
    intervalHours: number
    weekday: number
    weekdays: number[]
    command: string
    delaySeconds: number
    action: ServerAutomationAction
    warnMessage: string
    enabled: boolean
  }>({
    name: "",
    template: "AUTO_BACKUP",
    action: "BACKUP",
    frequency: "DAILY",
    time: "04:00",
    intervalHours: 6,
    weekday: 1,
    weekdays: [1, 3, 5],
    command: "",
    delaySeconds: 60,
    warnMessage: "El servidor se reiniciará en 60 segundos.",
    enabled: true,
  })
  const [isSaving, setIsSaving] = useState(false)

  // Delete modal state
  const [deleteTarget, setDeleteTarget] = useState<ServerAutomationItem | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  // Action loading map
  const [actionLoadingMap, setActionLoadingMap] = useState<Record<string, boolean>>({})

  const isMountedRef = useRef(true)

  const fetchTasks = useCallback(async (manual: boolean = false) => {
    if (manual) setIsRefreshing(true)
    setError(null)
    try {
      const data = await serverApi.getServerAutomations()
      if (isMountedRef.current) {
        setTasks(data)
      }
    } catch (err: unknown) {
      if (isMountedRef.current) {
        setError(
          err instanceof Error
            ? err.message
            : "No se pudieron cargar las tareas programadas.",
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
    fetchTasks()
    return () => {
      isMountedRef.current = false
    }
  }, [fetchTasks])

  const openCreateModal = (initialTemplate: ServerTaskTemplate = "AUTO_BACKUP") => {
    const tmpl = TASK_TEMPLATES.find((t) => t.id === initialTemplate) || TASK_TEMPLATES[0]
    setEditingId(null)
    setFormData({
      name: tmpl.defaultName,
      template: initialTemplate,
      action: tmpl.action || "COMMAND",
      frequency: "DAILY",
      time: "04:00",
      intervalHours: 6,
      weekday: 1,
      weekdays: [1, 3, 5],
      command: "",
      delaySeconds: 60,
      warnMessage: "El servidor se reiniciará en 60 segundos.",
      enabled: true,
    })
    setIsModalOpen(true)
  }

  const openEditModal = (task: ServerAutomationItem) => {
    if (task.isAdvanced && task.isManaged === false) {
      onToast(
        "Esta tarea fue configurada fuera de HiKAT y solo puede visualizarse.",
        "error",
      )
      return
    }

    setEditingId(task.id)
    const tmplId = (task.template as ServerTaskTemplate) || "CUSTOM"
    setFormData({
      name: task.name,
      template: tmplId,
      action: task.action || (task.command ? "COMMAND" : "BACKUP"),
      frequency: task.frequency || "DAILY",
      time: task.time || "04:00",
      intervalHours: task.intervalHours || 6,
      weekday: task.weekday ?? 1,
      weekdays: task.weekdays && task.weekdays.length > 0 ? task.weekdays : [1, 3, 5],
      command: task.command || "",
      delaySeconds: task.delaySeconds || 60,
      warnMessage: task.command?.startsWith("say ") ? task.command.slice(4) : task.command || "",
      enabled: task.enabled,
    })
    setIsModalOpen(true)
  }

  const handleTemplateChange = (newTemplate: ServerTaskTemplate) => {
    const tmpl = TASK_TEMPLATES.find((t) => t.id === newTemplate)
    setFormData((prev) => ({
      ...prev,
      template: newTemplate,
      action: tmpl?.action || (newTemplate === "CUSTOM" ? prev.action : "COMMAND"),
      name: prev.name === "" || TASK_TEMPLATES.some((t) => t.defaultName === prev.name)
        ? (tmpl?.defaultName || "Nueva tarea")
        : prev.name,
    }))
  }

  const handleToggleWeekday = (dayId: number) => {
    setFormData((prev) => {
      const current = prev.weekdays
      if (current.includes(dayId)) {
        if (current.length === 1) return prev
        return { ...prev, weekdays: current.filter((d) => d !== dayId).sort((a, b) => a - b) }
      } else {
        return { ...prev, weekdays: [...current, dayId].sort((a, b) => a - b) }
      }
    })
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.name.trim()) {
      onToast("Introduce un nombre descriptivo para la tarea.", "error")
      return
    }

    const currentTmpl = TASK_TEMPLATES.find((t) => t.id === formData.template)
    if (formData.template === "RUN_COMMAND" && !formData.command.trim()) {
      onToast("Introduce el comando de Minecraft que deseas ejecutar.", "error")
      return
    }
    if (formData.template === "CUSTOM" && formData.action === "COMMAND" && !formData.command.trim()) {
      onToast("Introduce el comando de Minecraft que deseas ejecutar.", "error")
      return
    }

    setIsSaving(true)
    try {
      let finalCommand: string | undefined = undefined
      if (formData.template === "RUN_COMMAND") {
        finalCommand = formData.command.trim()
      } else if (formData.template === "CUSTOM") {
        if (formData.action === "COMMAND") {
          finalCommand = formData.command.trim()
        }
      } else if (formData.template === "WARN_AND_RESTART" || formData.template === "WARN_AND_STOP") {
        finalCommand = formData.warnMessage.trim() ? `say ${formData.warnMessage.trim()}` : "say Reinicio programado en breves momentos"
      }

      const input: ServerAutomationInput = {
        name: formData.name.trim(),
        template: formData.template,
        action: formData.template === "CUSTOM" ? formData.action : undefined,
        frequency: formData.frequency,
        time: formData.frequency !== "INTERVAL" ? formData.time : undefined,
        intervalHours: formData.frequency === "INTERVAL" ? formData.intervalHours : undefined,
        weekday: formData.frequency === "WEEKLY" ? formData.weekday : undefined,
        weekdays: formData.frequency === "SELECTED_DAYS" ? formData.weekdays : undefined,
        command: finalCommand,
        delaySeconds: currentTmpl?.needsDelay ? formData.delaySeconds : undefined,
        enabled: formData.enabled,
      }

      if (editingId) {
        await serverApi.updateServerAutomation(editingId, input)
        onToast("Tarea programada actualizada correctamente.", "success")
      } else {
        await serverApi.createServerAutomation(input)
        onToast("Nueva tarea programada creada.", "success")
      }

      setIsModalOpen(false)
      fetchTasks()
    } catch (err: unknown) {
      onToast(
        err instanceof Error ? err.message : "Error al guardar la tarea programada.",
        "error",
      )
    } finally {
      setIsSaving(false)
    }
  }

  const handleToggleEnabled = async (task: ServerAutomationItem) => {
    if (task.isManaged === false) {
      onToast(
        "Esta tarea es externa y no puede modificarse desde HiKAT.",
        "error",
      )
      return
    }

    setActionLoadingMap((prev) => ({ ...prev, [task.id]: true }))
    try {
      await serverApi.updateServerAutomation(task.id, {
        name: task.name,
        template: task.template,
        action: task.template === "CUSTOM" ? task.action : undefined,
        frequency: task.frequency,
        time: task.time,
        intervalHours: task.intervalHours,
        weekday: task.weekday,
        weekdays: task.weekdays,
        command: task.command,
        delaySeconds: task.delaySeconds,
        enabled: !task.enabled,
      })
      onToast(
        task.enabled ? "Tarea desactivada." : "Tarea activada.",
        "success",
      )
      fetchTasks()
    } catch (err: unknown) {
      onToast(
        err instanceof Error ? err.message : "No se pudo cambiar el estado de la tarea.",
        "error",
      )
    } finally {
      setActionLoadingMap((prev) => ({ ...prev, [task.id]: false }))
    }
  }

  const handleRunNow = async (task: ServerAutomationItem) => {
    setActionLoadingMap((prev) => ({ ...prev, [`run-${task.id}`]: true }))
    try {
      await serverApi.runServerAutomation(task.id)
      onToast(`Ejecutando "${task.name}" ahora...`, "success")
      fetchTasks()
    } catch (err: unknown) {
      onToast(
        err instanceof Error ? err.message : "No se pudo ejecutar la tarea.",
        "error",
      )
    } finally {
      setActionLoadingMap((prev) => ({ ...prev, [`run-${task.id}`]: false }))
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setIsDeleting(true)
    try {
      await serverApi.deleteServerAutomation(deleteTarget.id)
      onToast(`Tarea "${deleteTarget.name}" eliminada.`, "success")
      setDeleteTarget(null)
      fetchTasks()
    } catch (err: unknown) {
      onToast(
        err instanceof Error ? err.message : "No se pudo eliminar la tarea.",
        "error",
      )
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 20,
        animation: "fadeIn 0.2s ease",
      }}
    >
      {/* Header section */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 16,
        }}
      >
        <div>
          <h2
            style={{
              margin: 0,
              fontSize: "1.25rem",
              fontWeight: 700,
              color: isDark ? "#ffffff" : "#0f172a",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <IconCalendar size={22} />
            <span>Tasks Programadas</span>
          </h2>
          <p
            style={{
              margin: "4px 0 0",
              fontSize: "0.875rem",
              color: isDark ? "rgba(255, 255, 255, 0.6)" : "rgba(0, 0, 0, 0.6)",
            }}
          >
            Automatiza backups, reinicios, avisos y mantenimiento del servidor de forma sencilla.
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            type="button"
            onClick={() => fetchTasks(true)}
            disabled={isLoading || isRefreshing}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "9px 14px",
              borderRadius: 10,
              border: `1px solid ${
                isDark ? "rgba(255, 255, 255, 0.12)" : "rgba(0, 0, 0, 0.12)"
              }`,
              background: isDark ? "rgba(255, 255, 255, 0.05)" : "#ffffff",
              color: isDark ? "#ffffff" : "#0f172a",
              fontSize: "0.85rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            <IconRefresh size={16} />
            <span>Actualizar</span>
          </button>

          <button
            type="button"
            onClick={() => openCreateModal()}
            disabled={isDisconnected}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "9px 16px",
              borderRadius: 10,
              border: "none",
              background: isDisconnected
                ? isDark ? "rgba(255, 255, 255, 0.1)" : "#e2e8f0"
                : "linear-gradient(135deg, #3ec4c0 0%, #2ba5a1 100%)",
              color: isDisconnected ? (isDark ? "rgba(255, 255, 255, 0.3)" : "#94a3b8") : "#08131d",
              fontSize: "0.85rem",
              fontWeight: 700,
              cursor: isDisconnected ? "not-allowed" : "pointer",
              boxShadow: isDisconnected ? "none" : "0 4px 14px rgba(62, 196, 192, 0.3)",
            }}
          >
            <IconPlus size={16} />
            <span>Nueva Task</span>
          </button>
        </div>
      </div>

      {/* Disconnected error banner */}
      {isDisconnected && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "14px 18px",
            borderRadius: 12,
            background: isDark ? "rgba(239, 68, 68, 0.12)" : "#fee2e2",
            border: `1px solid ${
              isDark ? "rgba(239, 68, 68, 0.3)" : "rgba(239, 68, 68, 0.2)"
            }`,
            color: isDark ? "#fca5a5" : "#b91c1c",
            fontSize: "0.875rem",
          }}
        >
          <IconAlertCircle size={20} />
          <span>
            {error || "El servidor no está disponible en este momento. Las tareas programadas no se pueden cargar."}
          </span>
        </div>
      )}

      {/* Content list or empty state */}
      {isLoading ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "64px 0",
            gap: 12,
            color: isDark ? "#3ec4c0" : "#0c6e6b",
          }}
        >
          <IconSpinner size={28} />
          <span style={{ fontSize: "0.95rem", fontWeight: 500 }}>
            Cargando tareas programadas...
          </span>
        </div>
      ) : tasks.length === 0 ? (
        <div
          style={{
            padding: "48px 24px",
            borderRadius: 16,
            background: isDark ? "rgba(19, 28, 35, 0.7)" : "#ffffff",
            border: `1px solid ${
              isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.08)"
            }`,
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: "2.5rem", marginBottom: 12 }}>⏰</div>
          <h3
            style={{
              margin: "0 0 6px",
              fontSize: "1.1rem",
              fontWeight: 700,
              color: isDark ? "#ffffff" : "#0f172a",
            }}
          >
            No hay tareas programadas
          </h3>
          <p
            style={{
              margin: "0 0 20px",
              fontSize: "0.875rem",
              color: isDark ? "rgba(255, 255, 255, 0.6)" : "rgba(0, 0, 0, 0.6)",
              maxWidth: 420,
              marginLeft: "auto",
              marginRight: "auto",
            }}
          >
            Configura tareas automáticas para backups diarios, reinicios periódicos o comandos de mantenimiento.
          </p>

          <div
            style={{
              display: "flex",
              justifyContent: "center",
              flexWrap: "wrap",
              gap: 10,
            }}
          >
            <button
              type="button"
              onClick={() => openCreateModal("AUTO_BACKUP")}
              style={{
                padding: "8px 14px",
                borderRadius: 8,
                border: "none",
                background: isDark ? "rgba(62, 196, 192, 0.15)" : "#e6fffa",
                color: isDark ? "#3ec4c0" : "#0c6e6b",
                fontWeight: 600,
                fontSize: "0.85rem",
                cursor: "pointer",
              }}
            >
              + Backup automático
            </button>
            <button
              type="button"
              onClick={() => openCreateModal("AUTO_RESTART")}
              style={{
                padding: "8px 14px",
                borderRadius: 8,
                border: "none",
                background: isDark ? "rgba(62, 196, 192, 0.15)" : "#e6fffa",
                color: isDark ? "#3ec4c0" : "#0c6e6b",
                fontWeight: 600,
                fontSize: "0.85rem",
                cursor: "pointer",
              }}
            >
              + Reinicio programado
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {tasks.map((task) => {
            const tmpl = TASK_TEMPLATES.find((t) => t.id === task.template)
            const isUnmanaged = task.isManaged === false
            const isRunningThis = actionLoadingMap[`run-${task.id}`]
            const isTogglingThis = actionLoadingMap[task.id]

            return (
              <div
                key={task.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: 16,
                  padding: "16px 20px",
                  borderRadius: 14,
                  background: isDark ? "rgba(19, 28, 35, 0.85)" : "#ffffff",
                  border: `1px solid ${
                    isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.08)"
                  }`,
                  boxShadow: isDark
                    ? "0 4px 16px rgba(0, 0, 0, 0.2)"
                    : "0 2px 8px rgba(0, 0, 0, 0.04)",
                  opacity: task.enabled ? 1 : 0.65,
                  transition: "all 0.2s ease",
                }}
              >
                {/* Left info */}
                <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 260 }}>
                  <div
                    style={{
                      width: 42,
                      height: 42,
                      borderRadius: 10,
                      background: isDark ? "rgba(62, 196, 192, 0.15)" : "#e6fffa",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "1.25rem",
                      flexShrink: 0,
                    }}
                  >
                    {tmpl?.icon || "⏱️"}
                  </div>

                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span
                        style={{
                          fontWeight: 700,
                          fontSize: "0.95rem",
                          color: isDark ? "#ffffff" : "#0f172a",
                        }}
                      >
                        {task.name}
                      </span>

                      {isUnmanaged && (
                        <span
                          style={{
                            padding: "2px 8px",
                            borderRadius: 6,
                            background: isDark ? "rgba(245, 158, 11, 0.2)" : "#fef3c7",
                            color: isDark ? "#fbbf24" : "#b45309",
                            fontSize: "0.725rem",
                            fontWeight: 700,
                          }}
                        >
                          {task.template ? "Modificada fuera de HiKAT" : "Tarea externa"}
                        </span>
                      )}

                      {task.isProcessing && (
                        <span
                          style={{
                            padding: "2px 8px",
                            borderRadius: 6,
                            background: isDark ? "rgba(59, 130, 246, 0.2)" : "#dbeafe",
                            color: isDark ? "#60a5fa" : "#1d4ed8",
                            fontSize: "0.725rem",
                            fontWeight: 700,
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                          }}
                        >
                          <IconSpinner size={12} />
                          En ejecución
                        </span>
                      )}
                    </div>

                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        marginTop: 4,
                        fontSize: "0.8rem",
                        color: isDark ? "rgba(255, 255, 255, 0.6)" : "rgba(0, 0, 0, 0.6)",
                        flexWrap: "wrap",
                      }}
                    >
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                        <IconClock size={14} />
                        {task.humanSchedule || "Programada"}
                      </span>

                      {tmpl && (
                        <span style={{ color: isDark ? "#3ec4c0" : "#0c6e6b", fontWeight: 600 }}>
                          • {tmpl.label}
                        </span>
                      )}

                      {task.command && (
                        <span
                          style={{
                            fontFamily: "monospace",
                            fontSize: "0.75rem",
                            background: isDark ? "rgba(0, 0, 0, 0.3)" : "#f1f5f9",
                            padding: "1px 6px",
                            borderRadius: 4,
                          }}
                        >
                          {task.command}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right controls */}
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {/* Enable / Disable toggle */}
                  <button
                    type="button"
                    onClick={() => handleToggleEnabled(task)}
                    disabled={isUnmanaged || isTogglingThis}
                    title={isUnmanaged ? "No modificable desde HiKAT" : task.enabled ? "Desactivar tarea" : "Activar tarea"}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "6px 12px",
                      borderRadius: 8,
                      border: `1px solid ${
                        task.enabled
                          ? isDark ? "rgba(74, 222, 128, 0.3)" : "rgba(22, 163, 74, 0.3)"
                          : isDark ? "rgba(255, 255, 255, 0.15)" : "rgba(0, 0, 0, 0.15)"
                      }`,
                      background: task.enabled
                        ? isDark ? "rgba(74, 222, 128, 0.1)" : "#dcfce7"
                        : isDark ? "rgba(255, 255, 255, 0.05)" : "#f1f5f9",
                      color: task.enabled
                        ? isDark ? "#4ade80" : "#16a34a"
                        : isDark ? "rgba(255, 255, 255, 0.6)" : "rgba(0, 0, 0, 0.6)",
                      fontSize: "0.8rem",
                      fontWeight: 700,
                      cursor: isUnmanaged ? "not-allowed" : "pointer",
                      opacity: isUnmanaged ? 0.4 : 1,
                    }}
                  >
                    {isTogglingThis ? (
                      <IconSpinner size={14} />
                    ) : task.enabled ? (
                      <>
                        <IconCheck size={14} />
                        <span>Activa</span>
                      </>
                    ) : (
                      <>
                        <IconCross size={14} />
                        <span>Inactiva</span>
                      </>
                    )}
                  </button>

                  {/* Run Now */}
                  <button
                    type="button"
                    onClick={() => handleRunNow(task)}
                    disabled={isUnmanaged || isRunningThis}
                    title={isUnmanaged ? "No ejecutable para tareas no gestionadas" : "Ejecutar ahora"}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "6px 10px",
                      borderRadius: 8,
                      border: `1px solid ${
                        isDark ? "rgba(255, 255, 255, 0.12)" : "rgba(0, 0, 0, 0.12)"
                      }`,
                      background: isDark ? "rgba(255, 255, 255, 0.05)" : "#ffffff",
                      color: isDark ? "#ffffff" : "#0f172a",
                      fontSize: "0.8rem",
                      fontWeight: 600,
                      cursor: isUnmanaged ? "not-allowed" : "pointer",
                      opacity: isUnmanaged ? 0.4 : 1,
                    }}
                  >
                    {isRunningThis ? (
                      <IconSpinner size={14} />
                    ) : (
                      <IconPlay size={14} />
                    )}
                    <span>Ejecutar</span>
                  </button>

                  {/* Edit */}
                  <button
                    type="button"
                    onClick={() => openEditModal(task)}
                    disabled={isUnmanaged}
                    title={isUnmanaged ? "No editable desde HiKAT" : "Editar tarea"}
                    style={{
                      padding: "6px 8px",
                      borderRadius: 8,
                      border: `1px solid ${
                        isDark ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.1)"
                      }`,
                      background: isDark ? "rgba(255, 255, 255, 0.04)" : "#ffffff",
                      color: isDark ? "#ffffff" : "#0f172a",
                      cursor: isUnmanaged ? "not-allowed" : "pointer",
                      opacity: isUnmanaged ? 0.4 : 1,
                    }}
                  >
                    <IconEdit size={15} />
                  </button>

                  {/* Delete */}
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(task)}
                    disabled={isUnmanaged}
                    title={isUnmanaged ? "No eliminable desde HiKAT" : "Eliminar tarea"}
                    style={{
                      padding: "6px 8px",
                      borderRadius: 8,
                      border: "none",
                      background: isDark ? "rgba(239, 68, 68, 0.15)" : "#fee2e2",
                      color: isDark ? "#f87171" : "#b91c1c",
                      cursor: isUnmanaged ? "not-allowed" : "pointer",
                      opacity: isUnmanaged ? 0.4 : 1,
                    }}
                  >
                    <IconTrash size={15} />
                  </button>
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
            zIndex: 900,
            padding: 16,
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 620,
              maxHeight: "90vh",
              overflowY: "auto",
              borderRadius: 20,
              background: isDark ? "#131c23" : "#ffffff",
              border: `1px solid ${
                isDark ? "rgba(255, 255, 255, 0.12)" : "rgba(0, 0, 0, 0.1)"
              }`,
              boxShadow: "0 20px 40px rgba(0, 0, 0, 0.4)",
              padding: "24px 28px",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 20,
              }}
            >
              <h3
                style={{
                  margin: 0,
                  fontSize: "1.2rem",
                  fontWeight: 700,
                  color: isDark ? "#ffffff" : "#0f172a",
                }}
              >
                {editingId ? "Editar Task Programada" : "Crear Nueva Task Programada"}
              </h3>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                style={{
                  border: "none",
                  background: "transparent",
                  color: isDark ? "rgba(255, 255, 255, 0.6)" : "rgba(0, 0, 0, 0.6)",
                  cursor: "pointer",
                  padding: 4,
                }}
              >
                <IconCross size={20} />
              </button>
            </div>

            <form onSubmit={handleSave} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              {/* Template selector cards */}
              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "0.825rem",
                    fontWeight: 700,
                    marginBottom: 8,
                    color: isDark ? "rgba(255, 255, 255, 0.8)" : "rgba(0, 0, 0, 0.8)",
                  }}
                >
                  Selecciona la plantilla de tarea:
                </label>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))",
                    gap: 8,
                    maxHeight: 200,
                    overflowY: "auto",
                    padding: 4,
                  }}
                >
                  {TASK_TEMPLATES.map((tmpl) => {
                    const isSelected = formData.template === tmpl.id
                    return (
                      <div
                        key={tmpl.id}
                        onClick={() => handleTemplateChange(tmpl.id)}
                        style={{
                          padding: "10px 12px",
                          borderRadius: 10,
                          border: `1px solid ${
                            isSelected
                              ? isDark ? "#3ec4c0" : "#0c6e6b"
                              : isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.08)"
                          }`,
                          background: isSelected
                            ? isDark ? "rgba(62, 196, 192, 0.15)" : "#e6fffa"
                            : isDark ? "rgba(255, 255, 255, 0.03)" : "#f8fafc",
                          cursor: "pointer",
                          transition: "all 0.15s ease",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                          <span>{tmpl.icon}</span>
                          <span
                            style={{
                              fontSize: "0.825rem",
                              fontWeight: 700,
                              color: isSelected
                                ? isDark ? "#3ec4c0" : "#0c6e6b"
                                : isDark ? "#ffffff" : "#0f172a",
                            }}
                          >
                            {tmpl.label}
                          </span>
                        </div>
                        <div
                          style={{
                            fontSize: "0.725rem",
                            color: isDark ? "rgba(255, 255, 255, 0.5)" : "rgba(0, 0, 0, 0.5)",
                            lineHeight: 1.3,
                          }}
                        >
                          {tmpl.description}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Task Name */}
              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "0.825rem",
                    fontWeight: 700,
                    marginBottom: 6,
                    color: isDark ? "rgba(255, 255, 255, 0.8)" : "rgba(0, 0, 0, 0.8)",
                  }}
                >
                  Nombre de la tarea:
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Ej: Backup diario a las 4 AM"
                  required
                  style={{
                    width: "100%",
                    padding: "10px 14px",
                    borderRadius: 10,
                    border: `1px solid ${
                      isDark ? "rgba(255, 255, 255, 0.15)" : "rgba(0, 0, 0, 0.15)"
                    }`,
                    background: isDark ? "rgba(0, 0, 0, 0.25)" : "#ffffff",
                    color: isDark ? "#ffffff" : "#0f172a",
                    fontSize: "0.9rem",
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                />
              </div>

              {/* Frequency selection */}
              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "0.825rem",
                    fontWeight: 700,
                    marginBottom: 6,
                    color: isDark ? "rgba(255, 255, 255, 0.8)" : "rgba(0, 0, 0, 0.8)",
                  }}
                >
                  Frecuencia de ejecución:
                </label>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, frequency: "DAILY" })}
                    style={{
                      padding: "8px 12px",
                      borderRadius: 8,
                      border: `1px solid ${
                        formData.frequency === "DAILY"
                          ? isDark ? "#3ec4c0" : "#0c6e6b"
                          : isDark ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.1)"
                      }`,
                      background: formData.frequency === "DAILY"
                        ? isDark ? "rgba(62, 196, 192, 0.15)" : "#e6fffa"
                        : "transparent",
                      color: formData.frequency === "DAILY"
                        ? isDark ? "#3ec4c0" : "#0c6e6b"
                        : isDark ? "#ffffff" : "#0f172a",
                      fontSize: "0.85rem",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Diariamente
                  </button>

                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, frequency: "SELECTED_DAYS" })}
                    style={{
                      padding: "8px 12px",
                      borderRadius: 8,
                      border: `1px solid ${
                        formData.frequency === "SELECTED_DAYS"
                          ? isDark ? "#3ec4c0" : "#0c6e6b"
                          : isDark ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.1)"
                      }`,
                      background: formData.frequency === "SELECTED_DAYS"
                        ? isDark ? "rgba(62, 196, 192, 0.15)" : "#e6fffa"
                        : "transparent",
                      color: formData.frequency === "SELECTED_DAYS"
                        ? isDark ? "#3ec4c0" : "#0c6e6b"
                        : isDark ? "#ffffff" : "#0f172a",
                      fontSize: "0.85rem",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Días específicos
                  </button>

                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, frequency: "WEEKLY" })}
                    style={{
                      padding: "8px 12px",
                      borderRadius: 8,
                      border: `1px solid ${
                        formData.frequency === "WEEKLY"
                          ? isDark ? "#3ec4c0" : "#0c6e6b"
                          : isDark ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.1)"
                      }`,
                      background: formData.frequency === "WEEKLY"
                        ? isDark ? "rgba(62, 196, 192, 0.15)" : "#e6fffa"
                        : "transparent",
                      color: formData.frequency === "WEEKLY"
                        ? isDark ? "#3ec4c0" : "#0c6e6b"
                        : isDark ? "#ffffff" : "#0f172a",
                      fontSize: "0.85rem",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Semanalmente
                  </button>

                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, frequency: "INTERVAL" })}
                    style={{
                      padding: "8px 12px",
                      borderRadius: 8,
                      border: `1px solid ${
                        formData.frequency === "INTERVAL"
                          ? isDark ? "#3ec4c0" : "#0c6e6b"
                          : isDark ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.1)"
                      }`,
                      background: formData.frequency === "INTERVAL"
                        ? isDark ? "rgba(62, 196, 192, 0.15)" : "#e6fffa"
                        : "transparent",
                      color: formData.frequency === "INTERVAL"
                        ? isDark ? "#3ec4c0" : "#0c6e6b"
                        : isDark ? "#ffffff" : "#0f172a",
                      fontSize: "0.85rem",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Intervalo de horas
                  </button>
                </div>
              </div>

              {/* Schedule details based on frequency */}
              {formData.frequency === "INTERVAL" ? (
                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: "0.825rem",
                      fontWeight: 700,
                      marginBottom: 6,
                      color: isDark ? "rgba(255, 255, 255, 0.8)" : "rgba(0, 0, 0, 0.8)",
                    }}
                  >
                    Repetir cada:
                  </label>
                  <select
                    value={formData.intervalHours}
                    onChange={(e) => setFormData({ ...formData, intervalHours: Number(e.target.value) })}
                    style={{
                      width: "100%",
                      padding: "10px 14px",
                      borderRadius: 10,
                      border: `1px solid ${
                        isDark ? "rgba(255, 255, 255, 0.15)" : "rgba(0, 0, 0, 0.15)"
                      }`,
                      background: isDark ? "#0f172a" : "#ffffff",
                      color: isDark ? "#ffffff" : "#0f172a",
                      fontSize: "0.9rem",
                      outline: "none",
                      boxSizing: "border-box",
                    }}
                  >
                    {INTERVAL_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {formData.frequency === "SELECTED_DAYS" && (
                    <div>
                      <label
                        style={{
                          display: "block",
                          fontSize: "0.825rem",
                          fontWeight: 700,
                          marginBottom: 6,
                          color: isDark ? "rgba(255, 255, 255, 0.8)" : "rgba(0, 0, 0, 0.8)",
                        }}
                      >
                        Días de la semana:
                      </label>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {WEEKDAYS.map((day) => {
                          const isSelected = formData.weekdays.includes(day.id)
                          return (
                            <button
                              key={day.id}
                              type="button"
                              onClick={() => handleToggleWeekday(day.id)}
                              style={{
                                width: 38,
                                height: 38,
                                borderRadius: 8,
                                border: `1px solid ${
                                  isSelected
                                    ? isDark ? "#3ec4c0" : "#0c6e6b"
                                    : isDark ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.1)"
                                }`,
                                background: isSelected
                                  ? isDark ? "rgba(62, 196, 192, 0.2)" : "#e6fffa"
                                  : "transparent",
                                color: isSelected
                                  ? isDark ? "#3ec4c0" : "#0c6e6b"
                                  : isDark ? "#ffffff" : "#0f172a",
                                fontWeight: 700,
                                fontSize: "0.85rem",
                                cursor: "pointer",
                              }}
                            >
                              {day.short}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {formData.frequency === "WEEKLY" && (
                    <div>
                      <label
                        style={{
                          display: "block",
                          fontSize: "0.825rem",
                          fontWeight: 700,
                          marginBottom: 6,
                          color: isDark ? "rgba(255, 255, 255, 0.8)" : "rgba(0, 0, 0, 0.8)",
                        }}
                      >
                        Día de la semana:
                      </label>
                      <select
                        value={formData.weekday}
                        onChange={(e) => setFormData({ ...formData, weekday: Number(e.target.value) })}
                        style={{
                          width: "100%",
                          padding: "10px 14px",
                          borderRadius: 10,
                          border: `1px solid ${
                            isDark ? "rgba(255, 255, 255, 0.15)" : "rgba(0, 0, 0, 0.15)"
                          }`,
                          background: isDark ? "#0f172a" : "#ffffff",
                          color: isDark ? "#ffffff" : "#0f172a",
                          fontSize: "0.9rem",
                          outline: "none",
                          boxSizing: "border-box",
                        }}
                      >
                        {WEEKDAYS.map((day) => (
                          <option key={day.id} value={day.id}>
                            {day.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div>
                    <label
                      style={{
                        display: "block",
                        fontSize: "0.825rem",
                        fontWeight: 700,
                        marginBottom: 6,
                        color: isDark ? "rgba(255, 255, 255, 0.8)" : "rgba(0, 0, 0, 0.8)",
                      }}
                    >
                      Hora de ejecución (HH:MM):{" "}
                      <span style={{ fontSize: "0.75rem", fontWeight: 500, color: isDark ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.5)" }}>
                        · Hora de Santo Domingo (UTC-4)
                      </span>
                    </label>
                    <input
                      type="time"
                      value={formData.time}
                      onChange={(e) => setFormData({ ...formData, time: e.target.value })}
                      required
                      style={{
                        padding: "10px 14px",
                        borderRadius: 10,
                        border: `1px solid ${
                          isDark ? "rgba(255, 255, 255, 0.15)" : "rgba(0, 0, 0, 0.15)"
                        }`,
                        background: isDark ? "rgba(0, 0, 0, 0.25)" : "#ffffff",
                        color: isDark ? "#ffffff" : "#0f172a",
                        fontSize: "0.9rem",
                        outline: "none",
                      }}
                    />
                  </div>
                </div>
              )}

              {/* Custom Action Selector */}
              {formData.template === "CUSTOM" && (
                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: "0.825rem",
                      fontWeight: 700,
                      marginBottom: 6,
                      color: isDark ? "rgba(255, 255, 255, 0.8)" : "rgba(0, 0, 0, 0.8)",
                    }}
                  >
                    Tipo de acción a ejecutar:
                  </label>
                  <select
                    value={formData.action}
                    onChange={(e) => setFormData({ ...formData, action: e.target.value as ServerAutomationAction })}
                    style={{
                      width: "100%",
                      padding: "10px 14px",
                      borderRadius: 10,
                      border: `1px solid ${
                        isDark ? "rgba(255, 255, 255, 0.15)" : "rgba(0, 0, 0, 0.15)"
                      }`,
                      background: isDark ? "#0f172a" : "#ffffff",
                      color: isDark ? "#ffffff" : "#0f172a",
                      fontSize: "0.9rem",
                      outline: "none",
                      boxSizing: "border-box",
                    }}
                  >
                    <option value="COMMAND">Ejecutar comando de Minecraft</option>
                    <option value="BACKUP">Crear copia de seguridad (backup)</option>
                    <option value="START">Encender servidor</option>
                    <option value="STOP">Apagar servidor</option>
                    <option value="RESTART">Reiniciar servidor</option>
                  </select>
                </div>
              )}

              {/* Command parameter for templates that need it */}
              {(formData.template === "RUN_COMMAND" || (formData.template === "CUSTOM" && formData.action === "COMMAND")) && (
                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: "0.825rem",
                      fontWeight: 700,
                      marginBottom: 6,
                      color: isDark ? "rgba(255, 255, 255, 0.8)" : "rgba(0, 0, 0, 0.8)",
                    }}
                  >
                    Comando de Minecraft a ejecutar:
                  </label>
                  <input
                    type="text"
                    value={formData.command}
                    onChange={(e) => setFormData({ ...formData, command: e.target.value })}
                    placeholder="Ej: save-all flush, say Servidor guardado, whitelist on"
                    required
                    style={{
                      width: "100%",
                      padding: "10px 14px",
                      borderRadius: 10,
                      border: `1px solid ${
                        isDark ? "rgba(255, 255, 255, 0.15)" : "rgba(0, 0, 0, 0.15)"
                      }`,
                      background: isDark ? "rgba(0, 0, 0, 0.25)" : "#ffffff",
                      color: isDark ? "#ffffff" : "#0f172a",
                      fontSize: "0.9rem",
                      fontFamily: "monospace",
                      outline: "none",
                      boxSizing: "border-box",
                    }}
                  />
                </div>
              )}

              {/* Message parameter for warn templates */}
              {(formData.template === "WARN_AND_RESTART" || formData.template === "WARN_AND_STOP") && (
                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: "0.825rem",
                      fontWeight: 700,
                      marginBottom: 6,
                      color: isDark ? "rgba(255, 255, 255, 0.8)" : "rgba(0, 0, 0, 0.8)",
                    }}
                  >
                    Mensaje de aviso para los jugadores:
                  </label>
                  <input
                    type="text"
                    value={formData.warnMessage}
                    onChange={(e) => setFormData({ ...formData, warnMessage: e.target.value })}
                    placeholder="El servidor se reiniciará en 60 segundos."
                    style={{
                      width: "100%",
                      padding: "10px 14px",
                      borderRadius: 10,
                      border: `1px solid ${
                        isDark ? "rgba(255, 255, 255, 0.15)" : "rgba(0, 0, 0, 0.15)"
                      }`,
                      background: isDark ? "rgba(0, 0, 0, 0.25)" : "#ffffff",
                      color: isDark ? "#ffffff" : "#0f172a",
                      fontSize: "0.9rem",
                      outline: "none",
                      boxSizing: "border-box",
                    }}
                  />
                </div>
              )}

              {/* Buttons */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: 10,
                  marginTop: 10,
                  paddingTop: 16,
                  borderTop: `1px solid ${
                    isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.08)"
                  }`,
                }}
              >
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  disabled={isSaving}
                  style={{
                    padding: "9px 16px",
                    borderRadius: 10,
                    border: `1px solid ${
                      isDark ? "rgba(255, 255, 255, 0.12)" : "rgba(0, 0, 0, 0.12)"
                    }`,
                    background: "transparent",
                    color: isDark ? "rgba(255, 255, 255, 0.7)" : "rgba(0, 0, 0, 0.7)",
                    fontWeight: 600,
                    fontSize: "0.85rem",
                    cursor: "pointer",
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
                    gap: 6,
                    padding: "9px 20px",
                    borderRadius: 10,
                    border: "none",
                    background: "linear-gradient(135deg, #3ec4c0 0%, #2ba5a1 100%)",
                    color: "#08131d",
                    fontWeight: 700,
                    fontSize: "0.85rem",
                    cursor: isSaving ? "not-allowed" : "pointer",
                    boxShadow: "0 4px 14px rgba(62, 196, 192, 0.3)",
                  }}
                >
                  {isSaving ? <IconSpinner size={16} /> : <IconCheck size={16} />}
                  <span>{editingId ? "Guardar Cambios" : "Crear Task"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
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
            zIndex: 1000,
            padding: 16,
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 420,
              borderRadius: 16,
              background: isDark ? "#131c23" : "#ffffff",
              border: `1px solid ${
                isDark ? "rgba(255, 255, 255, 0.12)" : "rgba(0, 0, 0, 0.1)"
              }`,
              boxShadow: "0 20px 40px rgba(0, 0, 0, 0.4)",
              padding: "24px 28px",
            }}
          >
            <div style={{ textAlign: "center", marginBottom: 16 }}>
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: "50%",
                  background: isDark ? "rgba(239, 68, 68, 0.15)" : "#fee2e2",
                  color: isDark ? "#f87171" : "#b91c1c",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: 12,
                }}
              >
                <IconTrash size={22} />
              </div>
              <h3
                style={{
                  margin: "0 0 6px",
                  fontSize: "1.15rem",
                  fontWeight: 700,
                  color: isDark ? "#ffffff" : "#0f172a",
                }}
              >
                ¿Eliminar esta tarea programada?
              </h3>
              <p
                style={{
                  margin: 0,
                  fontSize: "0.875rem",
                  color: isDark ? "rgba(255, 255, 255, 0.6)" : "rgba(0, 0, 0, 0.6)",
                }}
              >
                Se eliminará la tarea <strong>"{deleteTarget.name}"</strong>. Esta acción no se puede deshacer.
              </p>
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 10,
                marginTop: 20,
              }}
            >
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                disabled={isDeleting}
                style={{
                  padding: "8px 16px",
                  borderRadius: 10,
                  border: `1px solid ${
                    isDark ? "rgba(255, 255, 255, 0.12)" : "rgba(0, 0, 0, 0.12)"
                  }`,
                  background: "transparent",
                  color: isDark ? "rgba(255, 255, 255, 0.7)" : "rgba(0, 0, 0, 0.7)",
                  fontWeight: 600,
                  fontSize: "0.85rem",
                  cursor: "pointer",
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
                  gap: 6,
                  padding: "8px 18px",
                  borderRadius: 10,
                  border: "none",
                  background: isDark ? "#dc2626" : "#ef4444",
                  color: "#ffffff",
                  fontWeight: 700,
                  fontSize: "0.85rem",
                  cursor: isDeleting ? "not-allowed" : "pointer",
                }}
              >
                {isDeleting ? <IconSpinner size={14} /> : <IconTrash size={14} />}
                <span>Eliminar</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
