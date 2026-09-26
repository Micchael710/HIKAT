import React, { useState } from "react"
import type { ThemeMode, ModEnvironment } from "../../types"
import { getThemeTokens } from "../../theme/tokens"
import { IconCross, IconBox } from "../../theme/icons"
import ModEnvironmentRadioGroup from "./ModEnvironmentRadioGroup"

export interface UnresolvedModItem {
  logicalPath: string
  filename: string
}

interface UnresolvedModEnvironmentModalProps {
  theme: ThemeMode
  unresolvedMods: UnresolvedModItem[]
  onCancel: () => void
  onConfirm: (environments: Record<string, ModEnvironment>) => void
}

export default function UnresolvedModEnvironmentModal({
  theme,
  unresolvedMods,
  onCancel,
  onConfirm,
}: UnresolvedModEnvironmentModalProps) {
  const isDark = theme === "dark"
  const tokens = getThemeTokens(theme)

  const isSingle = unresolvedMods.length === 1

  const [environments, setEnvironments] = useState<Record<string, ModEnvironment>>(() => {
    const initial: Record<string, ModEnvironment> = {}
    for (const mod of unresolvedMods) {
      initial[mod.logicalPath] = "BOTH"
    }
    return initial
  })

  const [globalEnv, setGlobalEnv] = useState<ModEnvironment>("BOTH")
  const [showIndividual, setShowIndividual] = useState(false)

  const handleGlobalChange = (env: ModEnvironment) => {
    setGlobalEnv(env)
    const updated: Record<string, ModEnvironment> = {}
    for (const mod of unresolvedMods) {
      updated[mod.logicalPath] = env
    }
    setEnvironments(updated)
  }

  const handleItemChange = (path: string, env: ModEnvironment) => {
    setEnvironments((prev) => ({
      ...prev,
      [path]: env,
    }))
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onConfirm(environments)
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.78)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 950,
        padding: "16px",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div
        style={{
          backgroundColor: tokens.bgCard,
          border: `1px solid ${tokens.borderSubtle}`,
          borderRadius: "18px",
          width: "100%",
          maxWidth: "540px",
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
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "18px 24px",
            borderBottom: `1px solid ${tokens.borderSubtle}`,
            backgroundColor: tokens.bgCardInner,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div
              style={{
                width: "36px",
                height: "36px",
                borderRadius: "10px",
                backgroundColor: "rgba(234, 179, 8, 0.15)",
                color: "#eab308",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <IconBox size={20} />
            </div>
            <div>
              <h2
                style={{
                  margin: 0,
                  fontSize: "17px",
                  fontWeight: "700",
                  color: tokens.textPrimary,
                }}
              >
                {isSingle ? "¿Dónde necesita ejecutarse este mod?" : "Entorno de mods no identificados"}
              </h2>
              <p style={{ margin: "2px 0 0 0", fontSize: "12px", color: tokens.textMuted }}>
                {isSingle
                  ? "No se localizó en Modrinth ni CurseForge. Selecciona su entorno:"
                  : `No se localizó en Modrinth ni CurseForge ${unresolvedMods.length} mod(s). Selecciona el entorno:`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: tokens.textMuted,
              display: "flex",
              padding: "4px",
            }}
          >
            <IconCross size={18} />
          </button>
        </div>

        {/* Form Body */}
        <form
          onSubmit={handleSubmit}
          style={{
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            flex: 1,
          }}
        >
          <div
            style={{
              padding: "20px 24px",
              overflowY: "auto",
              flex: 1,
              display: "flex",
              flexDirection: "column",
              gap: "16px",
            }}
          >
            {isSingle ? (
              <>
                <div
                  style={{
                    padding: "10px 14px",
                    borderRadius: "10px",
                    backgroundColor: tokens.bgCardInner,
                    border: `1px solid ${tokens.borderSubtle}`,
                    fontSize: "13px",
                    fontWeight: "600",
                    color: tokens.textPrimary,
                    wordBreak: "break-all",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                  }}
                >
                  <IconBox size={16} style={{ flexShrink: 0, color: tokens.textSecondary }} />
                  <span>{unresolvedMods[0]!.filename}</span>
                </div>

                <ModEnvironmentRadioGroup
                  theme={theme}
                  value={environments[unresolvedMods[0]!.logicalPath] || "BOTH"}
                  onChange={(env) => handleItemChange(unresolvedMods[0]!.logicalPath, env)}
                  label=""
                />
              </>
            ) : (
              <>
                {/* Multi-mod selector */}
                <div
                  style={{
                    padding: "12px 14px",
                    borderRadius: "12px",
                    backgroundColor: tokens.bgCardInner,
                    border: `1px solid ${tokens.borderSubtle}`,
                    display: "flex",
                    flexDirection: "column",
                    gap: "6px",
                  }}
                >
                  <div style={{ fontSize: "12px", fontWeight: "700", color: tokens.textSecondary }}>
                    Archivos pendientes ({unresolvedMods.length}):
                  </div>
                  <div
                    style={{
                      maxHeight: "80px",
                      overflowY: "auto",
                      display: "flex",
                      flexDirection: "column",
                      gap: "4px",
                      fontSize: "12px",
                      color: tokens.textPrimary,
                    }}
                  >
                    {unresolvedMods.map((m) => (
                      <div key={m.logicalPath} style={{ wordBreak: "break-all" }}>
                        • {m.filename}
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <ModEnvironmentRadioGroup
                    theme={theme}
                    value={globalEnv}
                    onChange={handleGlobalChange}
                    label="¿Dónde necesitan ejecutarse estos mods?"
                  />
                </div>

                <div style={{ marginTop: "4px" }}>
                  <button
                    type="button"
                    onClick={() => setShowIndividual(!showIndividual)}
                    style={{
                      background: "none",
                      border: "none",
                      color: isDark ? "#3ec4c0" : "#0284c7",
                      cursor: "pointer",
                      fontSize: "12px",
                      fontWeight: "600",
                      padding: 0,
                    }}
                  >
                    {showIndividual ? "▲ Ocultar selección por mod" : "▼ Ajustar entorno individualmente por mod"}
                  </button>

                  {showIndividual && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "12px" }}>
                      {unresolvedMods.map((mod) => (
                        <div
                          key={mod.logicalPath}
                          style={{
                            padding: "12px 14px",
                            borderRadius: "10px",
                            border: `1px solid ${tokens.borderSubtle}`,
                            backgroundColor: tokens.bgCardInner,
                          }}
                        >
                          <div
                            style={{
                              fontSize: "12px",
                              fontWeight: "700",
                              color: tokens.textPrimary,
                              marginBottom: "8px",
                              wordBreak: "break-all",
                              display: "flex",
                              alignItems: "center",
                              gap: "6px",
                            }}
                          >
                            <IconBox size={14} style={{ flexShrink: 0, color: tokens.textSecondary }} />
                            <span>{mod.filename}</span>
                          </div>
                          <ModEnvironmentRadioGroup
                            theme={theme}
                            value={environments[mod.logicalPath] || "BOTH"}
                            onChange={(env) => handleItemChange(mod.logicalPath, env)}
                            name={`env-${mod.logicalPath}`}
                            label=""
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Footer Actions */}
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: "10px",
              padding: "16px 24px",
              borderTop: `1px solid ${tokens.borderSubtle}`,
              backgroundColor: tokens.bgCardInner,
            }}
          >
            <button
              type="button"
              onClick={onCancel}
              className="launcher-btn-secondary"
              style={{
                padding: "8px 18px",
                borderRadius: "10px",
                fontSize: "13px",
              }}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="launcher-btn-primary"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                padding: "8px 20px",
                borderRadius: "10px",
                fontSize: "13px",
              }}
            >
              Continuar subida
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
