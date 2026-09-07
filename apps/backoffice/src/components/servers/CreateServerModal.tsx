import React, { useState, useEffect, useRef } from "react"
import type {
  ThemeMode,
  ServerItem,
  CreateServerInput,
  GameEnvironmentCatalog,
  GameLoaderVersion,
} from "../../types"
import { serverApi, gameApi } from "../../services/graphqlClient"
import { uploadMediaFile } from "../../services/mediaUploadService"
import {
  IconCross,
  IconSpinner,
  IconCheck,
  IconWarning,
  IconUpload,
  IconTrash,
  IconServer,
  IconCpu,
  IconRam,
  IconDisk,
  IconImage,
} from "../../theme/icons"

interface CreateServerModalProps {
  isOpen: boolean
  onClose: () => void
  onCreated: (server: ServerItem) => void
  theme?: ThemeMode
}

type Step = 1 | 2 | 3 | 4 | 5

const LOADER_OPTIONS = [
  { value: "VANILLA", label: "Vanilla" },
  { value: "FABRIC", label: "Fabric" },
  { value: "FORGE", label: "Forge" },
  { value: "NEOFORGE", label: "NeoForge" },
  { value: "QUILT", label: "Quilt" },
]

export default function CreateServerModal({
  isOpen,
  onClose,
  onCreated,
  theme = "dark",
}: CreateServerModalProps) {
  const isDark = theme === "dark"

  // Step state
  const [currentStep, setCurrentStep] = useState<Step>(1)

  // Step 1: General
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [isDefault, setIsDefault] = useState(false)

  // Step 2: Environment
  const [catalog, setCatalog] = useState<GameEnvironmentCatalog | null>(null)
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [minecraftVersion, setMinecraftVersion] = useState("1.20.1")
  const [loader, setLoader] = useState("FABRIC")
  const [loaderVersions, setLoaderVersions] = useState<GameLoaderVersion[]>([])
  const [loaderVersionsLoading, setLoaderVersionsLoading] = useState(false)
  const [loaderVersion, setLoaderVersion] = useState("")
  const [javaVersion, setJavaVersion] = useState<number>(17)

  // Step 3: Resources
  const [cpu, setCpu] = useState<number>(200)
  const [ram, setRam] = useState<number>(4096)
  const [disk, setDisk] = useState<number>(10240)

  // Step 4: Appearance
  const [logoSquareFile, setLogoSquareFile] = useState<File | null>(null)
  const [logoSquarePreview, setLogoSquarePreview] = useState<string | null>(null)
  const [logoWideFile, setLogoWideFile] = useState<File | null>(null)
  const [logoWidePreview, setLogoWidePreview] = useState<string | null>(null)
  const [accentColor, setAccentColor] = useState("#3ec4c0")

  // Submission & Error states
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitStatusText, setSubmitStatusText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const isMountedRef = useRef(true)

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  // Load catalog when modal opens
  useEffect(() => {
    if (!isOpen) return

    // Reset fields on modal open
    setCurrentStep(1)
    setName("")
    setDescription("")
    setIsDefault(false)
    setCpu(200)
    setRam(4096)
    setDisk(10240)
    setAccentColor("#3ec4c0")
    setLogoSquareFile(null)
    setLogoSquarePreview(null)
    setLogoWideFile(null)
    setLogoWidePreview(null)
    setError(null)
    setIsSubmitting(false)
    setSubmitStatusText(null)

    setCatalogLoading(true)
    gameApi
      .getGameEnvironmentCatalog()
      .then((cat) => {
        if (!isMountedRef.current) return
        setCatalog(cat)
        if (cat.minecraftVersions && cat.minecraftVersions.length > 0) {
          const firstVer = cat.minecraftVersions[0]
          setMinecraftVersion(firstVer)
          handleMinecraftVersionChange(firstVer)
        }
      })
      .catch(() => {
        // Fallback gracefully
      })
      .finally(() => {
        if (isMountedRef.current) setCatalogLoading(false)
      })
  }, [isOpen])

  // Fetch loader versions whenever loader or minecraftVersion changes
  useEffect(() => {
    if (!isOpen || loader === "VANILLA") {
      setLoaderVersions([])
      setLoaderVersion("")
      return
    }

    setLoaderVersionsLoading(true)
    gameApi
      .getGameLoaderVersions(minecraftVersion, loader as import("../../types").GameModLoader)
      .then((versions) => {
        if (!isMountedRef.current) return
        setLoaderVersions(versions || [])
        if (versions && versions.length > 0) {
          const rec = versions.find((v) => v.stable) || versions[0]
          setLoaderVersion(rec.version)
        } else {
          setLoaderVersion("")
        }
      })
      .catch(() => {
        if (isMountedRef.current) {
          setLoaderVersions([])
          setLoaderVersion("")
        }
      })
      .finally(() => {
        if (isMountedRef.current) setLoaderVersionsLoading(false)
      })
  }, [isOpen, loader, minecraftVersion])

  // Update Java version recommendation when minecraftVersion changes
  const handleMinecraftVersionChange = (ver: string) => {
    setMinecraftVersion(ver)
    if (ver.startsWith("1.21") || ver.startsWith("1.20.5")) {
      setJavaVersion(21)
    } else if (ver.startsWith("1.18") || ver.startsWith("1.19") || ver.startsWith("1.20")) {
      setJavaVersion(17)
    } else if (ver.startsWith("1.17")) {
      setJavaVersion(16)
    } else {
      setJavaVersion(8)
    }
  }

  // Handle Square Logo File
  const handleSquareLogoSelected = (file: File) => {
    if (!file.type.startsWith("image/")) {
      setError("El logo cuadrado debe ser una imagen (PNG, JPEG, WebP).")
      return
    }
    setError(null)
    setLogoSquareFile(file)
    setLogoSquarePreview(URL.createObjectURL(file))
  }

  const handleClearSquareLogo = () => {
    if (logoSquarePreview) URL.revokeObjectURL(logoSquarePreview)
    setLogoSquareFile(null)
    setLogoSquarePreview(null)
  }

  // Handle Wide Logo File
  const handleWideLogoSelected = (file: File) => {
    if (!file.type.startsWith("image/")) {
      setError("El banner/logo ancho debe ser una imagen (PNG, JPEG, WebP).")
      return
    }
    setError(null)
    setLogoWideFile(file)
    setLogoWidePreview(URL.createObjectURL(file))
  }

  const handleClearWideLogo = () => {
    if (logoWidePreview) URL.revokeObjectURL(logoWidePreview)
    setLogoWideFile(null)
    setLogoWidePreview(null)
  }

  // Step Navigations
  const handleNextFromStep1 = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!name.trim()) {
      setError("El nombre del servidor es obligatorio.")
      return
    }
    setCurrentStep(2)
  }

  const handleNextFromStep2 = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!minecraftVersion) {
      setError("Debes seleccionar una versión de Minecraft.")
      return
    }
    if (loader !== "VANILLA" && !loaderVersion.trim()) {
      setError(`Debes especificar o seleccionar la versión de ${loader}.`)
      return
    }
    setCurrentStep(3)
  }

  const handleNextFromStep3 = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (cpu < 50) {
      setError("La CPU mínima es 50%.")
      return
    }
    if (ram < 512) {
      setError("La memoria RAM mínima es 512 MB.")
      return
    }
    if (disk < 1024) {
      setError("El disco mínimo es 1024 MB (1 GB).")
      return
    }
    setCurrentStep(4)
  }

  const handleNextFromStep4 = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!/^#[0-9a-fA-F]{6}$/.test(accentColor)) {
      setError("El color de acento debe ser un código HEX válido (ej. #3ec4c0).")
      return
    }
    setCurrentStep(5)
  }

  // Final Submit
  const handleCreateServer = async () => {
    if (isSubmitting) return
    setError(null)
    setIsSubmitting(true)

    try {
      let mainLogoMediaId: string | undefined = undefined
      let sidebarLogoMediaId: string | undefined = undefined

      // 1. Upload Square Logo if provided
      if (logoSquareFile) {
        setSubmitStatusText("Subiendo logo cuadrado...")
        const media = await uploadMediaFile(logoSquareFile, "IMAGE")
        mainLogoMediaId = media.id
      }

      // 2. Upload Wide Logo if provided
      if (logoWideFile) {
        setSubmitStatusText("Subiendo banner...")
        const media = await uploadMediaFile(logoWideFile, "IMAGE")
        sidebarLogoMediaId = media.id
      }

      // 3. Create Server mutation
      setSubmitStatusText("Creando servidor y provisionando Pterodactyl...")
      const input: CreateServerInput = {
        name: name.trim(),
        minecraftVersion: minecraftVersion.trim(),
        modLoader: loader as import("../../types").GameModLoader,
        modLoaderVersion: loader !== "VANILLA" && loaderVersion.trim() ? loaderVersion.trim() : undefined,
        cpu,
        memoryMb: ram,
        diskMb: disk,
        mainLogoMediaId,
        sidebarLogoMediaId,
        accentColor: accentColor.trim() || undefined,
      }

      const created = await serverApi.createServer(input)
      onCreated(created)
      onClose()
    } catch (err: any) {
      if (isMountedRef.current) {
        setError(err.message || "Error al crear el servidor.")
      }
    } finally {
      if (isMountedRef.current) {
        setIsSubmitting(false)
        setSubmitStatusText(null)
      }
    }
  }

  if (!isOpen) return null

  return (
    <div
      onClick={isSubmitting ? undefined : onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0, 0, 0, 0.78)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        animation: "fadeIn 0.18s ease",
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 680,
          maxWidth: "94vw",
          maxHeight: "90vh",
          background: isDark ? "#131d25" : "#ffffff",
          borderRadius: 20,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          border: isDark
            ? "1.5px solid rgba(255, 255, 255, 0.1)"
            : "1.5px solid rgba(0, 0, 0, 0.1)",
          boxShadow: isDark
            ? "0 24px 80px rgba(0, 0, 0, 0.75)"
            : "0 20px 60px rgba(0, 0, 0, 0.15)",
          animation: "slideUp 0.22s cubic-bezier(0.16, 1, 0.3, 1) both",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "20px 24px 16px",
            borderBottom: isDark
              ? "1px solid rgba(255, 255, 255, 0.08)"
              : "1px solid rgba(0, 0, 0, 0.08)",
            background: isDark ? "rgba(18, 26, 34, 0.6)" : "#f8fafc",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 16,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  background: "rgba(62, 196, 192, 0.15)",
                  color: "#3ec4c0",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <IconServer size={20} />
              </div>
              <h2
                style={{
                  margin: 0,
                  fontSize: 18,
                  fontWeight: 800,
                  color: isDark ? "#ffffff" : "#111822",
                }}
              >
                Crear nuevo servidor
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              style={{
                background: "none",
                border: "none",
                cursor: isSubmitting ? "not-allowed" : "pointer",
                color: isDark ? "rgba(255, 255, 255, 0.4)" : "#8899a6",
                display: "flex",
                padding: 4,
              }}
            >
              <IconCross size={18} />
            </button>
          </div>

          {/* Stepper Indicators */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(5, 1fr)",
              gap: 6,
            }}
          >
            {[
              { num: 1, label: "1. General" },
              { num: 2, label: "2. Entorno" },
              { num: 3, label: "3. Recursos" },
              { num: 4, label: "4. Apariencia" },
              { num: 5, label: "5. Resumen" },
            ].map((s) => {
              const isActive = currentStep === s.num
              const isPast = currentStep > s.num
              return (
                <div
                  key={s.num}
                  style={{
                    padding: "6px 8px",
                    borderRadius: 8,
                    textAlign: "center",
                    fontSize: 11.5,
                    fontWeight: 700,
                    background: isActive
                      ? "rgba(62, 196, 192, 0.2)"
                      : isPast
                      ? "rgba(34, 197, 94, 0.15)"
                      : isDark
                      ? "#0d141a"
                      : "#eef2f6",
                    color: isActive
                      ? "#3ec4c0"
                      : isPast
                      ? "#22c55e"
                      : isDark
                      ? "#64748b"
                      : "#94a3b8",
                    border: `1px solid ${
                      isActive
                        ? "rgba(62, 196, 192, 0.4)"
                        : isPast
                        ? "rgba(34, 197, 94, 0.3)"
                        : "transparent"
                    }`,
                    transition: "all 0.2s ease",
                  }}
                >
                  {s.label}
                </div>
              )
            })}
          </div>
        </div>

        {/* Modal Scrollable Body */}
        <div style={{ padding: "22px 24px", overflowY: "auto", flex: 1 }}>
          {error && (
            <div
              style={{
                marginBottom: 18,
                padding: "12px 16px",
                borderRadius: 10,
                background: "rgba(239, 68, 68, 0.15)",
                border: "1px solid rgba(239, 68, 68, 0.3)",
                color: "#ef4444",
                fontSize: 13,
                lineHeight: 1.4,
              }}
            >
              {error}
            </div>
          )}

          {/* STEP 1: GENERAL */}
          {currentStep === 1 && (
            <form onSubmit={handleNextFromStep1} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: 13,
                    fontWeight: 700,
                    color: isDark ? "#cbd5e1" : "#334155",
                    marginBottom: 6,
                  }}
                >
                  Nombre del servidor <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ej. HiKAT Survival, HiKAT RPG..."
                  autoFocus
                  style={{
                    width: "100%",
                    padding: "11px 14px",
                    borderRadius: 10,
                    border: `1px solid ${isDark ? "#334155" : "#cbd5e1"}`,
                    background: isDark ? "#0d141a" : "#ffffff",
                    color: isDark ? "#ffffff" : "#111822",
                    fontSize: 14,
                    fontWeight: 600,
                    boxSizing: "border-box",
                  }}
                />

                {/* Permanent Name Notice */}
                <div
                  style={{
                    marginTop: 8,
                    padding: "10px 14px",
                    borderRadius: 10,
                    background: "rgba(62, 196, 192, 0.08)",
                    border: "1px solid rgba(62, 196, 192, 0.25)",
                    fontSize: 12.5,
                    color: isDark ? "rgba(255, 255, 255, 0.8)" : "#334155",
                    lineHeight: 1.4,
                  }}
                >
                  <div>
                    <strong style={{ color: "#3ec4c0" }}>Importante:</strong> El nombre del servidor será permanente y también se utilizará como nombre de la carpeta local.
                  </div>
                  <div style={{ marginTop: 4, fontFamily: "monospace", fontSize: 11.5, color: isDark ? "#94a3b8" : "#64748b" }}>
                    Ruta local: HiKAT/games/{name.trim() ? name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-") : "<nombre-servidor>"}
                  </div>
                </div>
              </div>

              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: 13,
                    fontWeight: 700,
                    color: isDark ? "#cbd5e1" : "#334155",
                    marginBottom: 6,
                  }}
                >
                  Descripción (Opcional)
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Breve descripción del servidor o características principales..."
                  rows={3}
                  style={{
                    width: "100%",
                    padding: "10px 14px",
                    borderRadius: 10,
                    border: `1px solid ${isDark ? "#334155" : "#cbd5e1"}`,
                    background: isDark ? "#0d141a" : "#ffffff",
                    color: isDark ? "#ffffff" : "#111822",
                    fontSize: 13.5,
                    fontFamily: "inherit",
                    resize: "vertical",
                    boxSizing: "border-box",
                  }}
                />
              </div>

              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  cursor: "pointer",
                  userSelect: "none",
                  padding: "10px 14px",
                  borderRadius: 10,
                  background: isDark ? "rgba(255, 255, 255, 0.03)" : "rgba(0, 0, 0, 0.02)",
                  border: isDark ? "1px solid rgba(255, 255, 255, 0.06)" : "1px solid rgba(0, 0, 0, 0.06)",
                }}
              >
                <input
                  type="checkbox"
                  checked={isDefault}
                  onChange={(e) => setIsDefault(e.target.checked)}
                  style={{ width: 16, height: 16, accentColor: "#3ec4c0" }}
                />
                <span style={{ fontSize: 13.5, fontWeight: 600, color: isDark ? "#ffffff" : "#111822" }}>
                  Establecer como servidor por defecto de la comunidad
                </span>
              </label>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 10 }}>
                <button
                  type="button"
                  onClick={onClose}
                  className="launcher-btn-secondary"
                  style={{ padding: "10px 18px", borderRadius: 12, fontSize: 14 }}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="launcher-btn-primary"
                  style={{ padding: "10px 22px", borderRadius: 12, fontSize: 14 }}
                >
                  Siguiente: Entorno
                </button>
              </div>
            </form>
          )}

          {/* STEP 2: ENTORNO */}
          {currentStep === 2 && (
            <form onSubmit={handleNextFromStep2} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              {/* Minecraft Version */}
              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: 13,
                    fontWeight: 700,
                    color: isDark ? "#cbd5e1" : "#334155",
                    marginBottom: 6,
                  }}
                >
                  Versión de Minecraft <span style={{ color: "#ef4444" }}>*</span>
                </label>
                {catalogLoading ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#64748b", fontSize: 13 }}>
                    <IconSpinner size={16} /> Cargando catálogo de versiones...
                  </div>
                ) : catalog?.minecraftVersions && catalog.minecraftVersions.length > 0 ? (
                  <select
                    value={minecraftVersion}
                    onChange={(e) => handleMinecraftVersionChange(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "11px 14px",
                      borderRadius: 10,
                      border: `1px solid ${isDark ? "#334155" : "#cbd5e1"}`,
                      background: isDark ? "#0d141a" : "#ffffff",
                      color: isDark ? "#ffffff" : "#111822",
                      fontSize: 14,
                      fontWeight: 600,
                    }}
                  >
                    {catalog.minecraftVersions.map((v) => (
                      <option key={v} value={v}>
                        Minecraft {v}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={minecraftVersion}
                    onChange={(e) => handleMinecraftVersionChange(e.target.value)}
                    placeholder="Ej. 1.20.1"
                    style={{
                      width: "100%",
                      padding: "11px 14px",
                      borderRadius: 10,
                      border: `1px solid ${isDark ? "#334155" : "#cbd5e1"}`,
                      background: isDark ? "#0d141a" : "#ffffff",
                      color: isDark ? "#ffffff" : "#111822",
                      fontSize: 14,
                      fontWeight: 600,
                      boxSizing: "border-box",
                    }}
                  />
                )}
              </div>

              {/* Loader */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: 13,
                      fontWeight: 700,
                      color: isDark ? "#cbd5e1" : "#334155",
                      marginBottom: 6,
                    }}
                  >
                    Mod Loader <span style={{ color: "#ef4444" }}>*</span>
                  </label>
                  <select
                    value={loader}
                    onChange={(e) => setLoader(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "11px 14px",
                      borderRadius: 10,
                      border: `1px solid ${isDark ? "#334155" : "#cbd5e1"}`,
                      background: isDark ? "#0d141a" : "#ffffff",
                      color: isDark ? "#ffffff" : "#111822",
                      fontSize: 14,
                      fontWeight: 600,
                    }}
                  >
                    {LOADER_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Loader Version */}
                {loader !== "VANILLA" && (
                  <div>
                    <label
                      style={{
                        display: "block",
                        fontSize: 13,
                        fontWeight: 700,
                        color: isDark ? "#cbd5e1" : "#334155",
                        marginBottom: 6,
                      }}
                    >
                      Versión de {loader} <span style={{ color: "#ef4444" }}>*</span>
                    </label>
                    {loaderVersionsLoading ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#64748b", fontSize: 13, height: 42 }}>
                        <IconSpinner size={16} /> Cargando versiones...
                      </div>
                    ) : loaderVersions.length > 0 ? (
                      <select
                        value={loaderVersion}
                        onChange={(e) => setLoaderVersion(e.target.value)}
                        style={{
                          width: "100%",
                          padding: "11px 14px",
                          borderRadius: 10,
                          border: `1px solid ${isDark ? "#334155" : "#cbd5e1"}`,
                          background: isDark ? "#0d141a" : "#ffffff",
                          color: isDark ? "#ffffff" : "#111822",
                          fontSize: 14,
                          fontWeight: 600,
                        }}
                      >
                        {loaderVersions.map((lv) => (
                          <option key={lv.version} value={lv.version}>
                            {lv.version} {lv.stable ? "★ (Estable)" : ""}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={loaderVersion}
                        onChange={(e) => setLoaderVersion(e.target.value)}
                        placeholder="Ej. 0.15.11"
                        style={{
                          width: "100%",
                          padding: "11px 14px",
                          borderRadius: 10,
                          border: `1px solid ${isDark ? "#334155" : "#cbd5e1"}`,
                          background: isDark ? "#0d141a" : "#ffffff",
                          color: isDark ? "#ffffff" : "#111822",
                          fontSize: 14,
                          fontWeight: 600,
                          boxSizing: "border-box",
                        }}
                      />
                    )}
                  </div>
                )}
              </div>

              {/* Java Version */}
              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: 13,
                    fontWeight: 700,
                    color: isDark ? "#cbd5e1" : "#334155",
                    marginBottom: 6,
                  }}
                >
                  Versión de Java Runtime
                </label>
                <div style={{ display: "flex", gap: 10 }}>
                  {[8, 11, 16, 17, 21].map((jVer) => (
                    <button
                      key={jVer}
                      type="button"
                      onClick={() => setJavaVersion(jVer)}
                      style={{
                        flex: 1,
                        padding: "10px 8px",
                        borderRadius: 10,
                        fontWeight: 700,
                        fontSize: 13.5,
                        cursor: "pointer",
                        background: javaVersion === jVer
                          ? "rgba(62, 196, 192, 0.2)"
                          : isDark
                          ? "#0d141a"
                          : "#eef2f6",
                        border: javaVersion === jVer
                          ? "1.5px solid #3ec4c0"
                          : isDark
                          ? "1px solid #334155"
                          : "1px solid #cbd5e1",
                        color: javaVersion === jVer ? "#3ec4c0" : isDark ? "#ffffff" : "#111822",
                        transition: "all 0.15s ease",
                      }}
                    >
                      Java {jVer}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10 }}>
                <button
                  type="button"
                  onClick={() => setCurrentStep(1)}
                  className="launcher-btn-secondary"
                  style={{ padding: "10px 18px", borderRadius: 12, fontSize: 14 }}
                >
                  Atrás
                </button>
                <button
                  type="submit"
                  className="launcher-btn-primary"
                  style={{ padding: "10px 22px", borderRadius: 12, fontSize: 14 }}
                >
                  Siguiente: Recursos
                </button>
              </div>
            </form>
          )}

          {/* STEP 3: RECURSOS */}
          {currentStep === 3 && (
            <form onSubmit={handleNextFromStep3} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              <div style={{ fontSize: 13, color: isDark ? "#94a3b8" : "#64748b" }}>
                Asigna las especificaciones de hardware para la instancia de Pterodactyl.
              </div>

              {/* CPU */}
              <div
                style={{
                  padding: "14px 16px",
                  borderRadius: 12,
                  background: isDark ? "#0d141a" : "#f8fafc",
                  border: isDark ? "1px solid #334155" : "1px solid #e2e8f0",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ color: "#3ec4c0" }}>
                      <IconCpu size={18} />
                    </div>
                    <span style={{ fontSize: 13.5, fontWeight: 700, color: isDark ? "#ffffff" : "#111822" }}>
                      Límite de CPU (%)
                    </span>
                  </div>
                  <span style={{ fontSize: 14, fontWeight: 800, color: "#3ec4c0" }}>{cpu}%</span>
                </div>
                <input
                  type="range"
                  min={50}
                  max={800}
                  step={25}
                  value={cpu}
                  onChange={(e) => setCpu(Number(e.target.value))}
                  style={{ width: "100%", accentColor: "#3ec4c0" }}
                />
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#64748b", marginTop: 4 }}>
                  <span>50% (0.5 cores)</span>
                  <span>200% (2 cores)</span>
                  <span>400% (4 cores)</span>
                  <span>800% (8 cores)</span>
                </div>
              </div>

              {/* RAM */}
              <div
                style={{
                  padding: "14px 16px",
                  borderRadius: 12,
                  background: isDark ? "#0d141a" : "#f8fafc",
                  border: isDark ? "1px solid #334155" : "1px solid #e2e8f0",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ color: "#3ec4c0" }}>
                      <IconRam size={18} />
                    </div>
                    <span style={{ fontSize: 13.5, fontWeight: 700, color: isDark ? "#ffffff" : "#111822" }}>
                      Memoria RAM
                    </span>
                  </div>
                  <span style={{ fontSize: 14, fontWeight: 800, color: "#3ec4c0" }}>
                    {ram >= 1024 ? `${(ram / 1024).toFixed(1)} GB` : `${ram} MB`}
                  </span>
                </div>
                <input
                  type="range"
                  min={1024}
                  max={32768}
                  step={1024}
                  value={ram}
                  onChange={(e) => setRam(Number(e.target.value))}
                  style={{ width: "100%", accentColor: "#3ec4c0" }}
                />
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#64748b", marginTop: 4 }}>
                  <span>1 GB</span>
                  <span>4 GB (Recomendado)</span>
                  <span>8 GB</span>
                  <span>16 GB</span>
                  <span>32 GB</span>
                </div>
              </div>

              {/* Disk */}
              <div
                style={{
                  padding: "14px 16px",
                  borderRadius: 12,
                  background: isDark ? "#0d141a" : "#f8fafc",
                  border: isDark ? "1px solid #334155" : "1px solid #e2e8f0",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ color: "#3ec4c0" }}>
                      <IconDisk size={18} />
                    </div>
                    <span style={{ fontSize: 13.5, fontWeight: 700, color: isDark ? "#ffffff" : "#111822" }}>
                      Espacio en Disco
                    </span>
                  </div>
                  <span style={{ fontSize: 14, fontWeight: 800, color: "#3ec4c0" }}>
                    {disk >= 1024 ? `${(disk / 1024).toFixed(0)} GB` : `${disk} MB`}
                  </span>
                </div>
                <input
                  type="range"
                  min={2048}
                  max={102400}
                  step={2048}
                  value={disk}
                  onChange={(e) => setDisk(Number(e.target.value))}
                  style={{ width: "100%", accentColor: "#3ec4c0" }}
                />
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#64748b", marginTop: 4 }}>
                  <span>2 GB</span>
                  <span>10 GB (Recomendado)</span>
                  <span>25 GB</span>
                  <span>50 GB</span>
                  <span>100 GB</span>
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10 }}>
                <button
                  type="button"
                  onClick={() => setCurrentStep(2)}
                  className="launcher-btn-secondary"
                  style={{ padding: "10px 18px", borderRadius: 12, fontSize: 14 }}
                >
                  Atrás
                </button>
                <button
                  type="submit"
                  className="launcher-btn-primary"
                  style={{ padding: "10px 22px", borderRadius: 12, fontSize: 14 }}
                >
                  Siguiente: Apariencia
                </button>
              </div>
            </form>
          )}

          {/* STEP 4: APARIENCIA */}
          {currentStep === 4 && (
            <form onSubmit={handleNextFromStep4} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              {/* Accent Color Selection (Manual Color Picker + HEX) */}
              <div
                style={{
                  padding: "16px 18px",
                  borderRadius: 14,
                  background: isDark ? "#0d141a" : "#f8fafc",
                  border: isDark ? "1px solid #334155" : "1px solid #e2e8f0",
                }}
              >
                <label
                  style={{
                    display: "block",
                    fontSize: 13,
                    fontWeight: 700,
                    color: isDark ? "#cbd5e1" : "#334155",
                    marginBottom: 10,
                  }}
                >
                  Color de Acento del Servidor
                </label>
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <input
                    type="color"
                    value={accentColor}
                    onChange={(e) => setAccentColor(e.target.value)}
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: 10,
                      border: "none",
                      cursor: "pointer",
                      background: "transparent",
                    }}
                  />
                  <input
                    type="text"
                    value={accentColor}
                    onChange={(e) => setAccentColor(e.target.value)}
                    placeholder="#3ec4c0"
                    maxLength={7}
                    style={{
                      width: 140,
                      padding: "10px 12px",
                      borderRadius: 10,
                      border: `1px solid ${isDark ? "#334155" : "#cbd5e1"}`,
                      background: isDark ? "#131d25" : "#ffffff",
                      color: isDark ? "#ffffff" : "#111822",
                      fontSize: 14,
                      fontFamily: "monospace",
                      fontWeight: 700,
                    }}
                  />
                  <div
                    style={{
                      padding: "6px 14px",
                      borderRadius: 8,
                      background: `${accentColor}22`,
                      color: accentColor,
                      fontSize: 12.5,
                      fontWeight: 700,
                      border: `1px solid ${accentColor}66`,
                    }}
                  >
                    Vista previa de acento
                  </div>
                </div>
              </div>

              {/* Square Logo */}
              <div
                style={{
                  padding: "16px 18px",
                  borderRadius: 14,
                  background: isDark ? "#0d141a" : "#f8fafc",
                  border: isDark ? "1px solid #334155" : "1px solid #e2e8f0",
                }}
              >
                <label
                  style={{
                    display: "block",
                    fontSize: 13,
                    fontWeight: 700,
                    color: isDark ? "#cbd5e1" : "#334155",
                    marginBottom: 6,
                  }}
                >
                  Logo Cuadrado / Ícono (1:1)
                </label>
                <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                  {logoSquarePreview ? (
                    <div style={{ position: "relative", width: 64, height: 64 }}>
                      <img
                        src={logoSquarePreview}
                        alt="Logo cuadrado"
                        style={{
                          width: 64,
                          height: 64,
                          borderRadius: 12,
                          objectFit: "cover",
                          border: "1px solid #3ec4c0",
                        }}
                      />
                      <button
                        type="button"
                        onClick={handleClearSquareLogo}
                        style={{
                          position: "absolute",
                          top: -6,
                          right: -6,
                          width: 22,
                          height: 22,
                          borderRadius: "50%",
                          background: "#ef4444",
                          color: "#ffffff",
                          border: "none",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <IconCross size={12} />
                      </button>
                    </div>
                  ) : (
                    <label
                      style={{
                        padding: "10px 16px",
                        borderRadius: 10,
                        background: isDark ? "#131d25" : "#ffffff",
                        border: `1.5px dashed ${isDark ? "#475569" : "#cbd5e1"}`,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        fontSize: 13,
                        fontWeight: 600,
                        color: isDark ? "#94a3b8" : "#64748b",
                      }}
                    >
                      <IconUpload size={16} />
                      <span>Seleccionar imagen (PNG, JPG, WebP)</span>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => {
                          if (e.target.files?.[0]) handleSquareLogoSelected(e.target.files[0])
                        }}
                        style={{ display: "none" }}
                      />
                    </label>
                  )}
                </div>
              </div>

              {/* Wide Logo */}
              <div
                style={{
                  padding: "16px 18px",
                  borderRadius: 14,
                  background: isDark ? "#0d141a" : "#f8fafc",
                  border: isDark ? "1px solid #334155" : "1px solid #e2e8f0",
                }}
              >
                <label
                  style={{
                    display: "block",
                    fontSize: 13,
                    fontWeight: 700,
                    color: isDark ? "#cbd5e1" : "#334155",
                    marginBottom: 6,
                  }}
                >
                  Banner / Logo Ancho (Horizontal)
                </label>
                <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                  {logoWidePreview ? (
                    <div style={{ position: "relative", width: 160, height: 60 }}>
                      <img
                        src={logoWidePreview}
                        alt="Logo horizontal"
                        style={{
                          width: 160,
                          height: 60,
                          borderRadius: 10,
                          objectFit: "cover",
                          border: "1px solid #3ec4c0",
                        }}
                      />
                      <button
                        type="button"
                        onClick={handleClearWideLogo}
                        style={{
                          position: "absolute",
                          top: -6,
                          right: -6,
                          width: 22,
                          height: 22,
                          borderRadius: "50%",
                          background: "#ef4444",
                          color: "#ffffff",
                          border: "none",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <IconCross size={12} />
                      </button>
                    </div>
                  ) : (
                    <label
                      style={{
                        padding: "10px 16px",
                        borderRadius: 10,
                        background: isDark ? "#131d25" : "#ffffff",
                        border: `1.5px dashed ${isDark ? "#475569" : "#cbd5e1"}`,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        fontSize: 13,
                        fontWeight: 600,
                        color: isDark ? "#94a3b8" : "#64748b",
                      }}
                    >
                      <IconUpload size={16} />
                      <span>Seleccionar banner horizontal</span>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => {
                          if (e.target.files?.[0]) handleWideLogoSelected(e.target.files[0])
                        }}
                        style={{ display: "none" }}
                      />
                    </label>
                  )}
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10 }}>
                <button
                  type="button"
                  onClick={() => setCurrentStep(3)}
                  className="launcher-btn-secondary"
                  style={{ padding: "10px 18px", borderRadius: 12, fontSize: 14 }}
                >
                  Atrás
                </button>
                <button
                  type="submit"
                  className="launcher-btn-primary"
                  style={{ padding: "10px 22px", borderRadius: 12, fontSize: 14 }}
                >
                  Siguiente: Resumen
                </button>
              </div>
            </form>
          )}

          {/* STEP 5: RESUMEN & CONFIRMACIÓN */}
          {currentStep === 5 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              <div
                style={{
                  padding: "18px 20px",
                  borderRadius: 14,
                  background: isDark ? "#0d141a" : "#f8fafc",
                  border: isDark ? "1px solid #334155" : "1px solid #e2e8f0",
                }}
              >
                <h4 style={{ margin: "0 0 14px", fontSize: 15, fontWeight: 800, color: isDark ? "#ffffff" : "#111822" }}>
                  Resumen de Configuración
                </h4>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 18px", fontSize: 13.5 }}>
                  <div>
                    <span style={{ color: isDark ? "#94a3b8" : "#64748b", display: "block", fontSize: 11.5, fontWeight: 600, textTransform: "uppercase" }}>
                      Nombre del Servidor
                    </span>
                    <strong style={{ color: isDark ? "#ffffff" : "#111822" }}>{name}</strong>
                  </div>

                  <div>
                    <span style={{ color: isDark ? "#94a3b8" : "#64748b", display: "block", fontSize: 11.5, fontWeight: 600, textTransform: "uppercase" }}>
                      Carpeta Local
                    </span>
                    <span style={{ fontFamily: "monospace", color: "#3ec4c0" }}>
                      HiKAT/games/{name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-")}
                    </span>
                  </div>

                  <div>
                    <span style={{ color: isDark ? "#94a3b8" : "#64748b", display: "block", fontSize: 11.5, fontWeight: 600, textTransform: "uppercase" }}>
                      Entorno
                    </span>
                    <span style={{ color: isDark ? "#ffffff" : "#111822" }}>
                      MC {minecraftVersion} · {loader} {loaderVersion ? `(${loaderVersion})` : ""} · Java {javaVersion}
                    </span>
                  </div>

                  <div>
                    <span style={{ color: isDark ? "#94a3b8" : "#64748b", display: "block", fontSize: 11.5, fontWeight: 600, textTransform: "uppercase" }}>
                      Recursos Asignados
                    </span>
                    <span style={{ color: isDark ? "#ffffff" : "#111822" }}>
                      {cpu}% CPU · {ram >= 1024 ? `${(ram / 1024).toFixed(1)} GB` : `${ram} MB`} RAM · {(disk / 1024).toFixed(0)} GB Disco
                    </span>
                  </div>

                  <div>
                    <span style={{ color: isDark ? "#94a3b8" : "#64748b", display: "block", fontSize: 11.5, fontWeight: 600, textTransform: "uppercase" }}>
                      Color de Acento
                    </span>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                      <span style={{ width: 14, height: 14, borderRadius: 3, background: accentColor, display: "inline-block" }} />
                      <span style={{ fontFamily: "monospace" }}>{accentColor}</span>
                    </div>
                  </div>

                  <div>
                    <span style={{ color: isDark ? "#94a3b8" : "#64748b", display: "block", fontSize: 11.5, fontWeight: 600, textTransform: "uppercase" }}>
                      Multimedia
                    </span>
                    <span>
                      {logoSquareFile ? "Logo cuadrado ✓ " : "Sin logo cuadrado · "}
                      {logoWideFile ? "Banner ✓" : "Sin banner"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Provisioning Warning */}
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 12,
                  padding: "14px 16px",
                  borderRadius: 12,
                  background: "rgba(62, 196, 192, 0.1)",
                  border: "1px solid rgba(62, 196, 192, 0.3)",
                  color: isDark ? "#e2e8f0" : "#1e293b",
                  fontSize: 13,
                  lineHeight: 1.45,
                }}
              >
                <div style={{ color: "#3ec4c0", marginTop: 2 }}>
                  <IconServer size={18} />
                </div>
                <div>
                  <strong>Aviso de aprovisionamiento:</strong> Al confirmar, se creará el registro en HiKAT y se solicitará la creación de la instancia en Pterodactyl. El estado inicial será <code style={{ color: "#f5a623" }}>PROVISIONING</code> y cambiará a <code style={{ color: "#22c55e" }}>READY</code> automáticamente una vez completado.
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10 }}>
                <button
                  type="button"
                  onClick={() => setCurrentStep(4)}
                  disabled={isSubmitting}
                  className="launcher-btn-secondary"
                  style={{ padding: "10px 18px", borderRadius: 12, fontSize: 14 }}
                >
                  Atrás
                </button>
                <button
                  type="button"
                  onClick={handleCreateServer}
                  disabled={isSubmitting}
                  className="launcher-btn-primary"
                  style={{
                    padding: "10px 24px",
                    borderRadius: 12,
                    fontSize: 14,
                    fontWeight: 700,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  {isSubmitting ? (
                    <>
                      <IconSpinner size={16} />
                      <span>{submitStatusText || "Creando servidor..."}</span>
                    </>
                  ) : (
                    <span>Crear Servidor</span>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
