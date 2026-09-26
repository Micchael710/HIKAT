import React, { useState } from "react"
import type { ThemeMode, ModEnvironment } from "../../types"
import { getThemeTokens } from "../../theme/tokens"
import { IconCross, IconBox } from "../../theme/icons"

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

  const [environments, setEnvironments] = useState<Record<string, ModEnvironment>>(() => {
    const initial: Record<string, ModEnvironment> = {}
    for (const mod of unresolvedMods) {
      initial[mod.logicalPath] = "BOTH"
    }
    return initial
  })

  const [globalEnv, setGlobalEnv] = useState<ModEnvironment>("BOTH")

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
          maxWidth: "560px",
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
                Entorno de mods no identificados
              </h2>
              <p style={{ margin: "2px 0 0 0", fontSize: "12px", color: tokens.textMuted }}>
                No se encontró en Modrinth/CurseForge {unresolvedMods.length} mod(s). Selecciona el entorno:
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
            {unresolvedMods.length > 1 && (
              <div
                style={{
                  padding: "12px 16px",
                  borderRadius: "12px",
                  backgroundColor: tokens.bgCardInner,
                  border: `1px solid ${tokens.borderSubtle}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "12px",
                }}
              >
                <span style={{ fontSize: "13px", fontWeight: "600", color: tokens.textPrimary }}>
                  Aplicar a todos:
                </span>
                <div style={{ display: "flex", gap: "6px" }}>
                  {(["BOTH", "CLIENT", "SERVER"] as ModEnvironment[]).map((env) => (
                    <button
                      key={env}
                      type="button"
                      onClick={() => handleGlobalChange(env)}
                      style={{
                        padding: "6px 12px",
                        borderRadius: "8px",
                        fontSize: "12px",
                        fontWeight: "600",
                        cursor: "pointer",
                        border: `1px solid ${globalEnv === env ? "#3ec4c0" : tokens.borderSubtle}`,
                        backgroundColor:
                          globalEnv === env
                            ? isDark
                              ? "rgba(62, 196, 192, 0.2)"
                              : "#e0f2fe"
                            : "transparent",
                        color: globalEnv === env ? (isDark ? "#3ec4c0" : "#0284c7") : tokens.textSecondary,
                      }}
                    >
                      {env === "BOTH" ? "Cliente y Servidor" : env === "CLIENT" ? "Solo Cliente" : "Solo Servidor"}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {unresolvedMods.map((mod) => {
                const currentEnv = environments[mod.logicalPath] || "BOTH"
                return (
                  <div
                    key={mod.logicalPath}
                    style={{
                      padding: "14px 16px",
                      borderRadius: "12px",
                      border: `1px solid ${tokens.borderSubtle}`,
                      backgroundColor: tokens.bgCardInner,
                      display: "flex",
                      flexDirection: "column",
                      gap: "10px",
                    }}
                  >
                    <div style={{ fontSize: "13px", fontWeight: "600", color: tokens.textPrimary, wordBreak: "break-all" }}>
                      📦 {mod.filename}
                    </div>

                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                      {[
                        { key: "BOTH", label: "Cliente y Servidor (BOTH)" },
                        { key: "CLIENT", label: "Solo Cliente (CLIENT)" },
                        { key: "SERVER", label: "Solo Servidor (SERVER)" },
                      ].map((opt) => (
                        <label
                          key={opt.key}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "6px",
                            padding: "6px 10px",
                            borderRadius: "8px",
                            border: `1px solid ${currentEnv === opt.key ? "#3ec4c0" : tokens.borderSubtle}`,
                            backgroundColor:
                              currentEnv === opt.key
                                ? isDark
                                  ? "rgba(62, 196, 192, 0.12)"
                                  : "#f0fdfa"
                                : "transparent",
                            cursor: "pointer",
                            fontSize: "12px",
                            color: currentEnv === opt.key ? tokens.textPrimary : tokens.textSecondary,
                            fontWeight: currentEnv === opt.key ? "600" : "400",
                          }}
                        >
                          <input
                            type="radio"
                            name={`env-${mod.logicalPath}`}
                            value={opt.key}
                            checked={currentEnv === opt.key}
                            onChange={() => handleItemChange(mod.logicalPath, opt.key as ModEnvironment)}
                            style={{ accentColor: "#3ec4c0" }}
                          />
                          <span>{opt.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
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
