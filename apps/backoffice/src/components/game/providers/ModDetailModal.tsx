import React, { useState, useEffect } from "react"
import type {
  ModProvider,
  ModProjectDetail,
  ModInstallationPlan,
  ModVersionOverrideInput,
  ContentType,
  ThemeMode,
} from "../../../types"
import { graphqlClient } from "../../../services/graphqlClient"
import { getThemeTokens } from "../../../theme/tokens"
import { IconBox, IconSpinner } from "../../../theme/icons"

interface ModDetailModalProps {
  provider: ModProvider
  projectId: string
  contentType?: ContentType
  onClose: () => void
  onSuccess: () => void
  theme?: ThemeMode
}

export const ModDetailModal: React.FC<ModDetailModalProps> = ({
  provider,
  projectId,
  contentType = "MOD",
  onClose,
  onSuccess,
  theme = "dark",
}) => {
  const isDark = theme === "dark"
  const tokens = getThemeTokens(theme)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<ModProjectDetail | null>(null)
  const [selectedVersionId, setSelectedVersionId] = useState<string>("")
  const [manualMode, setManualMode] = useState(false)
  const [manualOverrides, setManualOverrides] = useState<Record<string, string>>({})
  const [plan, setPlan] = useState<ModInstallationPlan | null>(null)
  const [resolvingPlan, setResolvingPlan] = useState(false)
  const [installing, setInstalling] = useState(false)

  // 1. Fetch project details
  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)

    graphqlClient
      .getModProjectDetail(provider, projectId, contentType)
      .then((data) => {
        if (!active) return
        setDetail(data)
        // Preselect latest stable release (or first compatible version)
        const stable = data.compatibleVersions.find((v) => v.releaseType === "RELEASE")
        const initialVer = stable || data.compatibleVersions[0]
        if (initialVer) {
          setSelectedVersionId(initialVer.id || initialVer.fileId || "")
        }
        setLoading(false)
      })
      .catch((err) => {
        if (!active) return
        setError(err.message || "Error al cargar los detalles del contenido")
        setLoading(false)
      })

    return () => {
      active = false
    }
  }, [provider, projectId, contentType])

  // 2. Resolve installation plan whenever selected version or manual overrides change
  useEffect(() => {
    if (!selectedVersionId) return

    let active = true
    setResolvingPlan(true)

    const overridesList: ModVersionOverrideInput[] = Object.entries(manualOverrides).map(
      ([key, verId]) => {
        const [p, pid, cType] = key.split(":")
        return {
          provider: p as ModProvider,
          projectId: pid,
          versionId: verId,
          contentType: (cType as any) || undefined,
        }
      },
    )

    graphqlClient
      .resolveModInstallationPlan({
        provider,
        projectId,
        versionId: selectedVersionId,
        contentType,
        manualOverrides: overridesList.length > 0 ? overridesList : null,
      })
      .then((resPlan) => {
        if (!active) return
        setPlan(resPlan)
        setResolvingPlan(false)
      })
      .catch((err) => {
        if (!active) return
        setError(err.message || "Error al calcular el plan de dependencias")
        setResolvingPlan(false)
      })

    return () => {
      active = false
    }
  }, [provider, projectId, selectedVersionId, manualOverrides, contentType])

  const handleInstall = async () => {
    if (!selectedVersionId || !plan || !plan.isValid) return

    try {
      setInstalling(true)
      setError(null)

      const overridesList: ModVersionOverrideInput[] = Object.entries(manualOverrides).map(
        ([key, verId]) => {
          const [p, pid, cType] = key.split(":")
          return {
            provider: p as ModProvider,
            projectId: pid,
            versionId: verId,
            contentType: (cType as any) || undefined,
          }
        },
      )

      await graphqlClient.installModPlan({
        provider,
        projectId,
        versionId: selectedVersionId,
        contentType,
        manualOverrides: overridesList.length > 0 ? overridesList : null,
      })

      onSuccess()
    } catch (err: any) {
      setError(err.message || "Error durante la instalación del contenido")
      setInstalling(false)
    }
  }

  const isModrinth = provider === "MODRINTH"

  // Count items to install/update
  const itemsToInstallCount =
    plan?.items.filter((i) => i.action === "INSTALL" || i.action === "UPDATE").length || 1

  const currentMcVersion = detail?.minecraftVersion || "1.21.1"
  const currentLoader = detail?.neoForgeVersion ? "NeoForge" : ""

  return (
    <div
      data-testid="mod-detail-modal"
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.78)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: "20px",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !installing) onClose()
      }}
    >
      <div
        style={{
          backgroundColor: tokens.bgCard,
          border: `1px solid ${tokens.borderSubtle}`,
          borderRadius: "18px",
          width: "100%",
          maxWidth: "680px",
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: tokens.cardShadowLg,
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "20px 24px",
            borderBottom: `1px solid ${tokens.borderSubtle}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: tokens.bgCardInner,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
            {detail?.iconUrl ? (
              <img
                src={detail.iconUrl}
                alt={detail.name}
                style={{
                  width: "52px",
                  height: "52px",
                  borderRadius: "10px",
                  objectFit: "cover",
                  background: "rgba(0, 0, 0, 0.2)",
                }}
              />
            ) : (
              <div
                style={{
                  width: "52px",
                  height: "52px",
                  borderRadius: "10px",
                  background: tokens.bgCardInner,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: tokens.textMuted,
                }}
              >
                <IconBox size={24} />
              </div>
            )}

            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                <h3 style={{ margin: 0, fontSize: "18px", fontWeight: "700", color: tokens.textPrimary }}>
                  {detail?.name || "Cargando..."}
                </h3>
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: "700",
                    padding: "2px 8px",
                    borderRadius: "6px",
                    background: isModrinth ? "rgba(16, 185, 129, 0.2)" : "rgba(249, 115, 22, 0.2)",
                    color: isModrinth ? "#10b981" : "#f97316",
                    border: `1px solid ${isModrinth ? "rgba(16, 185, 129, 0.3)" : "rgba(249, 115, 22, 0.3)"}`,
                  }}
                >
                  {provider}
                </span>
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: "600",
                    padding: "2px 8px",
                    borderRadius: "6px",
                    background: "rgba(139, 92, 246, 0.2)",
                    color: "#c084fc",
                    border: "1px solid rgba(139, 92, 246, 0.3)",
                  }}
                >
                  {contentType}
                </span>
              </div>
              <div style={{ fontSize: "12px", color: tokens.textSecondary, marginTop: "4px" }}>
                por <span style={{ color: tokens.textPrimary, fontWeight: "600" }}>{detail?.author || "..."}</span>
              </div>
            </div>
          </div>

          <button
            type="button"
            data-testid="button-close-modal"
            onClick={onClose}
            disabled={installing}
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

        {/* Modal Body */}
        <div style={{ padding: "20px 24px", overflowY: "auto", flex: 1 }} className="custom-scroll">
          {loading ? (
            <div style={{ textAlign: "center", padding: "40px 0", color: tokens.textMuted, display: "flex", flexDirection: "column", alignItems: "center", gap: "10px" }}>
              <IconSpinner size={28} />
              <span>Cargando información y versiones compatibles...</span>
            </div>
          ) : error && !detail ? (
            <div
              style={{
                padding: "16px",
                background: "rgba(239, 68, 68, 0.12)",
                border: "1px solid rgba(239, 68, 68, 0.25)",
                borderRadius: "10px",
                color: "#ef4444",
                fontSize: "14px",
              }}
            >
              {error}
            </div>
          ) : (
            <div>
              {/* Summary */}
              <p style={{ margin: "0 0 20px 0", fontSize: "14px", color: "#d1d5db", lineHeight: "1.5" }}>
                {detail?.summary}
              </p>

              {/* Version Selector */}
              <div style={{ marginBottom: "20px" }}>
                <label
                  style={{
                    display: "block",
                    fontSize: "13px",
                    fontWeight: "600",
                    color: "#e5e7eb",
                    marginBottom: "8px",
                  }}
                >
                  Versión (Compatible con Minecraft {currentMcVersion}{contentType === "MOD" && currentLoader ? ` · ${currentLoader}` : ""})
                </label>
                <select
                  data-testid="select-mod-version"
                  value={selectedVersionId}
                  onChange={(e) => setSelectedVersionId(e.target.value)}
                  disabled={installing}
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    background: "rgba(0, 0, 0, 0.3)",
                    border: "1px solid rgba(255, 255, 255, 0.12)",
                    borderRadius: "8px",
                    color: "#f3f4f6",
                    fontSize: "14px",
                    outline: "none",
                  }}
                >
                  {detail?.compatibleVersions.map((ver) => {
                    const verKey = ver.id || ver.fileId || ""
                    const isStable = ver.releaseType === "RELEASE"
                    return (
                      <option key={verKey} value={verKey} style={{ background: "#1f2937", color: "#fff" }}>
                        {ver.versionNumber} ({isStable ? "Estable" : ver.releaseType}) — {ver.filename}
                      </option>
                    )
                  })}
                </select>
              </div>

              {/* Dependencies Section */}
              <div
                style={{
                  background: "rgba(0, 0, 0, 0.2)",
                  border: "1px solid rgba(255, 255, 255, 0.08)",
                  borderRadius: "10px",
                  padding: "16px",
                  marginBottom: "20px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: "12px",
                  }}
                >
                  <h4 style={{ margin: 0, fontSize: "14px", fontWeight: "600", color: "#e5e7eb" }}>
                    Dependencias requeridas
                  </h4>

                  {plan && plan.items.length > 1 && (
                    <div style={{ display: "flex", gap: "12px", fontSize: "12px" }}>
                      <label style={{ display: "flex", alignItems: "center", gap: "4px", cursor: "pointer", color: !manualMode ? "#10b981" : "#9ca3af" }}>
                        <input
                          type="radio"
                          name="mode"
                          checked={!manualMode}
                          onChange={() => setManualMode(false)}
                          disabled={installing}
                        />
                        Automático
                      </label>
                      <label style={{ display: "flex", alignItems: "center", gap: "4px", cursor: "pointer", color: manualMode ? "#3b82f6" : "#9ca3af" }}>
                        <input
                          type="radio"
                          name="mode"
                          checked={manualMode}
                          onChange={() => setManualMode(true)}
                          disabled={installing}
                        />
                        Elegir versiones manualmente
                      </label>
                    </div>
                  )}
                </div>

                {resolvingPlan ? (
                  <div style={{ fontSize: "13px", color: "#9ca3af", padding: "10px 0" }}>
                    Calculando dependencias y resolviendo versiones...
                  </div>
                ) : plan && plan.items.length > 1 ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    {plan.items
                      .filter((item) => item.isDependency)
                      .map((dep) => {
                        const depKey = `${dep.provider}:${dep.projectId}:${dep.contentType}`
                        return (
                          <div
                            key={depKey}
                            data-testid={`dependency-item-${dep.projectId}`}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              padding: "8px 12px",
                              background: "rgba(255, 255, 255, 0.03)",
                              borderRadius: "6px",
                              border: "1px solid rgba(255, 255, 255, 0.05)",
                            }}
                          >
                            <div>
                              <span style={{ fontWeight: "600", fontSize: "13px", color: "#f3f4f6" }}>
                                {dep.projectName}
                              </span>
                              <span style={{ fontSize: "12px", color: "#9ca3af", marginLeft: "8px" }}>
                                {dep.versionNumber}
                              </span>
                              {dep.logicalPath && (
                                <span style={{ fontSize: "11px", color: "#6b7280", marginLeft: "6px" }}>
                                  ({dep.logicalPath})
                                </span>
                              )}
                            </div>

                            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                              {dep.action === "ALREADY_INSTALLED" && (
                                <span
                                  style={{
                                    fontSize: "11px",
                                    padding: "2px 6px",
                                    borderRadius: "4px",
                                    background: "rgba(107, 114, 128, 0.2)",
                                    color: "#9ca3af",
                                  }}
                                >
                                  Ya instalada
                                </span>
                              )}
                              {dep.action === "UPDATE" && (
                                <span
                                  style={{
                                    fontSize: "11px",
                                    padding: "2px 6px",
                                    borderRadius: "4px",
                                    background: "rgba(59, 130, 246, 0.2)",
                                    color: "#60a5fa",
                                  }}
                                >
                                  Se actualizará
                                </span>
                              )}
                              {dep.action === "INSTALL" && (
                                <span
                                  style={{
                                    fontSize: "11px",
                                    padding: "2px 6px",
                                    borderRadius: "4px",
                                    background: "rgba(16, 185, 129, 0.2)",
                                    color: "#34d399",
                                  }}
                                >
                                  Nueva
                                </span>
                              )}

                              {manualMode && dep.availableCompatibleVersions.length > 0 && (
                                <select
                                  data-testid={`select-override-${dep.projectId}`}
                                  value={manualOverrides[depKey] || dep.versionId}
                                  onChange={(e) =>
                                    setManualOverrides((prev) => ({
                                      ...prev,
                                      [depKey]: e.target.value,
                                    }))
                                  }
                                  disabled={installing}
                                  style={{
                                    padding: "4px 8px",
                                    background: "#1f2937",
                                    border: "1px solid rgba(255, 255, 255, 0.15)",
                                    borderRadius: "4px",
                                    color: "#fff",
                                    fontSize: "12px",
                                  }}
                                >
                                  {dep.availableCompatibleVersions.map((v) => (
                                    <option key={v.id || v.fileId} value={v.id || v.fileId || ""}>
                                      {v.versionNumber} ({v.releaseType})
                                    </option>
                                  ))}
                                </select>
                              )}
                            </div>
                          </div>
                        )
                      })}
                  </div>
                ) : (
                  <div style={{ fontSize: "13px", color: "#9ca3af" }}>
                    Este contenido no declara dependencias requeridas adicionales.
                  </div>
                )}

                {/* Conflicts warning */}
                {plan && plan.conflicts.length > 0 && (
                  <div
                    data-testid="plan-conflicts-warning"
                    style={{
                      marginTop: "12px",
                      padding: "10px 14px",
                      background: "rgba(239, 68, 68, 0.15)",
                      border: "1px solid rgba(239, 68, 68, 0.3)",
                      borderRadius: "8px",
                      color: "#fca5a5",
                      fontSize: "13px",
                    }}
                  >
                    <strong>Incompatibilidad o conflicto detectado:</strong>
                    <ul style={{ margin: "6px 0 0 0", paddingLeft: "18px" }}>
                      {plan.conflicts.map((c, i) => (
                        <li key={i}>{c}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* Optional Dependencies Section */}
              {plan && plan.optionalDependencies && plan.optionalDependencies.length > 0 && (
                <div
                  data-testid="optional-dependencies-section"
                  style={{
                    background: "rgba(0, 0, 0, 0.2)",
                    border: "1px solid rgba(255, 255, 255, 0.08)",
                    borderRadius: "10px",
                    padding: "16px",
                    marginBottom: "20px",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginBottom: "12px",
                    }}
                  >
                    <h4 style={{ margin: 0, fontSize: "14px", fontWeight: "600", color: "#e5e7eb" }}>
                      Dependencias opcionales
                    </h4>
                    <span style={{ fontSize: "12px", color: "#9ca3af" }}>
                      No se instalará automáticamente
                    </span>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    {plan.optionalDependencies.map((opt) => {
                      const optKey = `${opt.provider}:${opt.projectId}:${opt.contentType}`
                      return (
                        <div
                          key={optKey}
                          data-testid={`optional-dependency-item-${opt.projectId}`}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            padding: "8px 12px",
                            background: "rgba(255, 255, 255, 0.03)",
                            borderRadius: "6px",
                            border: "1px solid rgba(255, 255, 255, 0.05)",
                          }}
                        >
                          <div>
                            <span style={{ fontWeight: "600", fontSize: "13px", color: "#f3f4f6" }}>
                              {opt.projectName}
                            </span>
                            <span style={{ fontSize: "12px", color: "#9ca3af", marginLeft: "8px" }}>
                              [{opt.provider} · {opt.contentType}]
                            </span>
                            {opt.versionNumber && (
                              <span style={{ fontSize: "12px", color: "#9ca3af", marginLeft: "6px" }}>
                                {opt.versionNumber}
                              </span>
                            )}
                          </div>

                          <div>
                            {opt.isInstalled ? (
                              <span
                                data-testid={`optional-installed-${opt.projectId}`}
                                style={{
                                  fontSize: "11px",
                                  padding: "2px 6px",
                                  borderRadius: "4px",
                                  background: "rgba(107, 114, 128, 0.2)",
                                  color: "#9ca3af",
                                }}
                              >
                                Ya instalada
                              </span>
                            ) : (
                              <span
                                style={{
                                  fontSize: "11px",
                                  padding: "2px 6px",
                                  borderRadius: "4px",
                                  background: "rgba(234, 179, 8, 0.15)",
                                  color: "#fde047",
                                }}
                              >
                                No instalada (Opcional)
                              </span>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {error && (
                <div
                  style={{
                    marginBottom: "16px",
                    padding: "10px 14px",
                    background: "rgba(239, 68, 68, 0.15)",
                    border: "1px solid rgba(239, 68, 68, 0.3)",
                    borderRadius: "8px",
                    color: "#fca5a5",
                    fontSize: "13px",
                  }}
                >
                  {error}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div
          style={{
            padding: "16px 24px",
            borderTop: "1px solid rgba(255, 255, 255, 0.08)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "rgba(255, 255, 255, 0.02)",
          }}
        >
          <div style={{ fontSize: "13px", color: "#9ca3af" }}>
            {plan && plan.totalDownloadSizeBytes > 0 && (
              <span>
                Descarga estimada: {(plan.totalDownloadSizeBytes / (1024 * 1024)).toFixed(1)} MB
              </span>
            )}
          </div>

          <div style={{ display: "flex", gap: "10px" }}>
            <button
              type="button"
              onClick={onClose}
              disabled={installing}
              className="launcher-btn-secondary"
              style={{
                padding: "10px 18px",
                borderRadius: "12px",
                fontSize: "14px",
                fontWeight: "600",
              }}
            >
              Cancelar
            </button>

            <button
              type="button"
              data-testid="button-confirm-install"
              onClick={handleInstall}
              disabled={installing || loading || resolvingPlan || Boolean(plan && !plan.isValid)}
              className="launcher-btn-primary"
              style={{
                padding: "10px 22px",
                borderRadius: "12px",
                fontSize: "14px",
                fontWeight: "700",
                opacity:
                  installing || loading || resolvingPlan || Boolean(plan && !plan.isValid)
                    ? 0.5
                    : 1,
                cursor:
                  installing || loading || resolvingPlan || Boolean(plan && !plan.isValid)
                    ? "not-allowed"
                    : "pointer",
              }}
            >
              {installing
                ? "Instalando..."
                : itemsToInstallCount > 1
                ? `Añadir ${itemsToInstallCount} elementos`
                : "Añadir a la actualización"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
