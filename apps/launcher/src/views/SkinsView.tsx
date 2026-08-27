import React, { useState, useRef, useEffect } from "react"
import {
  ThemeMode,
  SkinItem,
  CapeItem,
  PlayerSkin,
  DEFAULT_SKINS,
  DEFAULT_CAPES,
} from "../types"
import { hexToRGB, CANVAS_W, BASE_FONT } from "../theme/tokens"
import SkinViewer3D from "../components/minecraft/SkinViewer3D"
import SkinCardPreview from "../components/minecraft/SkinCardPreview"
import CapeCardPreview from "../components/minecraft/CapeCardPreview"
import LiveToast from "../components/common/LiveToast"
import { useTranslation } from "../context/LanguageContext"
import {
  validateMinecraftSkinTexture,
  MAX_SKIN_SIZE_BYTES,
} from "@hikat/shared"

interface SkinsViewProps {
  username: string
  appliedSkin: string
  setAppliedSkin: (id: string) => void
  appliedCape: string
  setAppliedCape: (id: string) => void
  allSkins?: SkinItem[]
  playerSkin?: PlayerSkin | null
  onUploadSkin?: (file: File) => Promise<PlayerSkin>
  onDeleteSkin?: () => Promise<boolean>
  customCapes: CapeItem[]
  setCustomCapes: React.Dispatch<React.SetStateAction<CapeItem[]>>
  theme?: ThemeMode
}

export default function SkinsView({
  username,
  appliedSkin,
  setAppliedSkin,
  appliedCape,
  setAppliedCape,
  allSkins = DEFAULT_SKINS,
  playerSkin = null,
  onUploadSkin,
  onDeleteSkin,
  customCapes,
  setCustomCapes,
  theme = "dark",
}: SkinsViewProps) {
  const { t } = useTranslation()
  const [skinType, setSkinType] = useState<"skin" | "capa">("skin")
  const [isUploading, setIsUploading] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [toastState, setToastState] = useState<{
    message: string | null
    type?: "success" | "error"
    accentColor?: string
  }>({
    message: null,
  })

  const toastTimerRef = useRef<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const isDark = theme === "dark"

  const allCapes = [...customCapes, ...DEFAULT_CAPES]
  const items = skinType === "skin" ? allSkins : allCapes
  const activeId = skinType === "skin" ? appliedSkin : appliedCape

  const previewSkin =
    allSkins.find((sk) => sk.id === appliedSkin) ?? allSkins[0] ?? null
  const previewCape =
    allCapes.find((cp) => cp.id === appliedCape) ?? allCapes[0] ?? null

  const hasSelectedSkin = Boolean(
    previewSkin &&
      previewSkin.id !== "none" &&
      (previewSkin.customImgUrl || previewSkin.skinUrl),
  )
  const hasSelectedCape = Boolean(
    previewCape &&
      previewCape.id !== "none" &&
      (previewCape.customImgUrl || previewCape.capeUrl),
  )

  const activePreview = skinType === "skin" ? previewSkin : previewCape
  const accentHex =
    activePreview?.accent ||
    (skinType === "skin"
      ? (activePreview as SkinItem)?.shirt
      : (activePreview as CapeItem)?.color) ||
    "#38bdf8"
  const currentAccent = hexToRGB(accentHex)

  const showToast = (
    msg?: string,
    type: "success" | "error" = "success",
    overrideAccent?: string,
  ) => {
    setToastState({
      message: msg || t("settings.toastSaved"),
      type,
      accentColor: type === "error" ? undefined : overrideAccent || accentHex,
    })
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current)
    toastTimerRef.current = window.setTimeout(() => {
      setToastState({ message: null })
    }, 3200)
  }

  const CONTENT_LEFT = 184

  const handleSelectItem = (id: string) => {
    const item = items.find((i) => i.id === id)
    const itemAccent =
      item?.accent ||
      (skinType === "skin"
        ? (item as SkinItem)?.shirt
        : (item as CapeItem)?.color) ||
      accentHex

    if (skinType === "skin") {
      setAppliedSkin(id)
    } else {
      setAppliedCape(id)
    }
    showToast(t("settings.toastSaved"), "success", itemAccent)
  }

  /* File upload with strict Minecraft dimensions & format validation */
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (skinType === "skin") {
      // 1. Format check: PNG only
      if (
        !file.type.includes("png") &&
        !file.name.toLowerCase().endsWith(".png")
      ) {
        showToast("El archivo de skin debe estar en formato PNG (.png).", "error")
        e.target.value = ""
        return
      }

      // 2. Size limit check: max 1MB
      if (file.size > MAX_SKIN_SIZE_BYTES) {
        showToast("El archivo supera el tamaño máximo permitido de 1 MB.", "error")
        e.target.value = ""
        return
      }

      try {
        setIsUploading(true)
        const arrayBuffer = await file.arrayBuffer()

        // 3. Exact Minecraft Skin Dimensions Check (64x64 or 64x32)
        const validation = validateMinecraftSkinTexture(arrayBuffer)
        if (!validation.valid) {
          showToast(
            validation.error ||
              validation.reason ||
              "Dimensiones no válidas. Debe ser una skin de Minecraft 64x64 o 64x32.",
            "error",
          )
          return
        }

        if (onUploadSkin) {
          await onUploadSkin(file)
          showToast("¡Skin personalizada subida y aplicada con éxito!", "success", "#38bdf8")
        }
      } catch (err: any) {
        showToast(
          err?.message || "Error al subir la skin al servidor. Inténtalo de nuevo.",
          "error",
        )
      } finally {
        setIsUploading(false)
        e.target.value = ""
      }
    } else {
      // Cape Upload (Capes subsystem)
      if (
        !file.type.includes("png") &&
        !file.name.toLowerCase().endsWith(".png")
      ) {
        showToast("La capa debe estar en formato PNG (.png).", "error")
        e.target.value = ""
        return
      }

      const reader = new FileReader()
      reader.onload = (ev) => {
        const url = ev.target?.result as string
        if (!url) return
        const newId = `custom-cape-${Date.now()}`
        const newName =
          file.name.replace(/\.[^/.]+$/, "").slice(0, 15) || "Personalizada"
        const newCape: CapeItem = {
          id: newId,
          name: newName,
          color: "#38bdf8",
          badge: "CUSTOM",
          accent: "#38bdf8",
          customImgUrl: url,
          capeUrl: url,
        }
        setCustomCapes((prev) => [newCape, ...prev])
        setAppliedCape(newId)
        showToast("Capa personalizada añadida.", "success")
      }
      reader.readAsDataURL(file)
      e.target.value = ""
    }
  }

  /* Handle deletion of player personal skin */
  const handleDeletePersonalSkin = async (e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    if (!onDeleteSkin || isDeleting) return

    try {
      setIsDeleting(true)
      const success = await onDeleteSkin()
      if (success) {
        showToast("Skin personalizada eliminada correctamente.", "success")
      } else {
        showToast("No se pudo eliminar la skin personalizada.", "error")
      }
    } catch (err: any) {
      showToast(err?.message || "Error al eliminar la skin.", "error")
    } finally {
      setIsDeleting(false)
    }
  }

  /* Smooth delayed mouse-following parallax for the ambient glowing orbs */
  const [mouseOffset, setMouseOffset] = useState({ x: 0, y: 0 })
  useEffect(() => {
    const handleWindowMouseMove = (e: MouseEvent) => {
      const relX = e.clientX / window.innerWidth - 0.5
      const relY = e.clientY / window.innerHeight - 0.5
      setMouseOffset({
        x: Math.round(relX * 220),
        y: Math.round(relY * 150),
      })
    }
    window.addEventListener("mousemove", handleWindowMouseMove, {
      passive: true,
    })
    return () => window.removeEventListener("mousemove", handleWindowMouseMove)
  }, [])

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: CANVAS_W,
        height: 1080,
        overflow: "hidden",
      }}
    >
      {/* 🌌 Dynamic Atmospheric Breathing Background 🌌 */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          overflow: "hidden",
          zIndex: 0,
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            transform: `translate3d(${mouseOffset.x}px, ${mouseOffset.y}px, 0)`,
            transition: "transform 1.4s cubic-bezier(0.16, 1, 0.3, 1)",
            willChange: "transform",
          }}
        >
          <div
            className="skins-bg-orb-1"
            style={{
              position: "absolute",
              top: "-10%",
              left: "15%",
              width: 850,
              height: 850,
              background: `radial-gradient(circle, rgba(${currentAccent.r}, ${currentAccent.g}, ${currentAccent.b}, ${
                isDark ? 0.28 : 0.16
              }) 0%, transparent 68%)`,
              filter: "blur(55px)",
              transition: "background 0.55s ease",
            }}
          />
        </div>

        <div
          style={{
            position: "absolute",
            inset: 0,
            transform: `translate3d(${Math.round(mouseOffset.x * 0.45)}px, ${Math.round(mouseOffset.y * 0.45)}px, 0)`,
            transition: "transform 1.8s cubic-bezier(0.16, 1, 0.3, 1)",
            willChange: "transform",
          }}
        >
          <div
            className="skins-bg-orb-2"
            style={{
              position: "absolute",
              top: "25%",
              right: "5%",
              width: 900,
              height: 900,
              background: `radial-gradient(circle, rgba(${currentAccent.r}, ${currentAccent.g}, ${currentAccent.b}, ${
                isDark ? 0.2 : 0.12
              }) 0%, transparent 68%)`,
              filter: "blur(65px)",
              transition: "background 0.55s ease",
            }}
          />
        </div>
      </div>

      {/* Hidden file uploader input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileUpload}
        accept="image/png"
        style={{ display: "none" }}
      />

      {/* 🚀 Main Content Container 🚀 */}
      <div
        style={{
          position: "absolute",
          left: CONTENT_LEFT,
          top: 145,
          width: CANVAS_W - CONTENT_LEFT - 80,
          height: 880,
          display: "flex",
          flexDirection: "column",
          fontFamily: BASE_FONT,
          zIndex: 1,
          animation: "viewFadeIn 0.24s ease",
        }}
      >
        {/* 🌟 Top Header Row 🌟 */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 22,
            position: "relative",
            minHeight: 48,
          }}
        >
          {/* Title & Subtitle */}
          <div>
            <div
              style={{
                fontSize: 32,
                fontWeight: 800,
                color: isDark ? "white" : "#111822",
                letterSpacing: "-0.02em",
                marginBottom: 4,
              }}
            >
              {t("skins.title")}
            </div>
            <div
              style={{
                fontSize: 16,
                fontWeight: 400,
                color: isDark ? "#8899aa" : "#556677",
              }}
            >
              {t("skins.subtitle")}
            </div>
          </div>

          {/* Category Tabs: Skins / Capas */}
          <div
            style={{
              position: "absolute",
              left: "48%",
              transform: "translateX(-50%)",
              display: "inline-flex",
              background: isDark ? "#0d1217" : "#e6ebf0",
              border: isDark
                ? "1.5px solid rgba(255,255,255,0.08)"
                : "1.5px solid rgba(0,0,0,0.08)",
              borderRadius: 14,
              padding: 4,
              gap: 4,
            }}
          >
            {(["skin", "capa"] as const).map((tab) => {
              const isCurrent = skinType === tab
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setSkinType(tab)}
                  style={{
                    padding: "9px 26px",
                    borderRadius: 10,
                    background: isCurrent
                      ? isDark
                        ? "#1c2630"
                        : "#ffffff"
                      : "transparent",
                    border: isCurrent
                      ? isDark
                        ? "1.5px solid rgba(255,255,255,0.14)"
                        : "1.5px solid rgba(0,0,0,0.08)"
                      : "1.5px solid transparent",
                    color: isCurrent
                      ? isDark
                        ? "white"
                        : "#111822"
                      : isDark
                        ? "#7a8b9e"
                        : "#667788",
                    boxShadow:
                      isCurrent && !isDark
                        ? "0 2px 8px rgba(0,0,0,0.08)"
                        : "none",
                    fontSize: 15,
                    fontWeight: 700,
                    fontFamily: BASE_FONT,
                    cursor: "pointer",
                    transition:
                      "background 0.16s, color 0.16s, border-color 0.16s",
                  }}
                >
                  {tab === "skin" ? t("skins.tabSkins") : t("skins.tabCapes")}
                </button>
              )
            })}
          </div>

          {/* Right Action Tools: Upload Button */}
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>

            {/* Upload Button */}
            <button
              type="button"
              disabled={isUploading}
              onClick={() => fileInputRef.current?.click()}
              className="launcher-btn-secondary"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                height: 44,
                padding: "0 22px",
                borderRadius: 14,
                fontSize: 15,
                fontWeight: 600,
                fontFamily: BASE_FONT,
                cursor: isUploading ? "default" : "pointer",
                opacity: isUploading ? 0.7 : 1,
              }}
            >
              <svg
                width={16}
                height={16}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              {isUploading ? "Subiendo..." : t("skins.uploadSkin")}
            </button>
          </div>
        </div>

        {/* 🎭 Two-Column Main Stage & Grid Area 🎭 */}
        <div style={{ display: "flex", gap: 36, flex: 1 }}>
          {/* 🌟 Left: Preview Stage Panel 🌟 */}
          <div
            style={{
              width: 420,
              flexShrink: 0,
              display: "flex",
              flexDirection: "column",
              gap: 14,
            }}
          >
            {/* Character Stage Box */}
            <div
              style={{
                height: 560,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: isDark ? "#080e13" : "#e6ebf2",
                borderRadius: 24,
                border: isDark
                  ? "3px solid rgba(255, 255, 255, 0.06)"
                  : "3px solid rgba(0, 0, 0, 0.08)",
                position: "relative",
                overflow: "hidden",
                boxShadow: isDark
                  ? "0 16px 48px rgba(0, 0, 0, 0.55)"
                  : "0 16px 48px rgba(0, 0, 0, 0.12)",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background: `radial-gradient(ellipse 70% 60% at 50% 55%, rgba(${currentAccent.r},${currentAccent.g},${currentAccent.b}, ${
                    isDark ? 0.22 : 0.15
                  }) 0%, transparent 70%)`,
                  pointerEvents: "none",
                  transition: "background 0.5s ease",
                }}
              />

              {/* 3D Skin & Cape Viewer */}
              <div
                style={{
                  position: "relative",
                  zIndex: 2,
                  width: "100%",
                  height: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {hasSelectedSkin || hasSelectedCape ? (
                  <SkinViewer3D
                    skinUrl={
                      hasSelectedSkin
                        ? previewSkin?.customImgUrl || previewSkin?.skinUrl
                        : undefined
                    }
                    capeUrl={
                      hasSelectedCape
                        ? previewCape?.customImgUrl || previewCape?.capeUrl
                        : undefined
                    }
                    width={380}
                    height={520}
                    model={
                      previewSkin?.model === "slim" ? "slim" : "classic"
                    }
                  />

                ) : (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 14,
                    }}
                  >
                    <span
                      style={{
                        color: isDark
                          ? "rgba(255,255,255,0.4)"
                          : "rgba(0,0,0,0.4)",
                        fontWeight: 600,
                        fontSize: 16,
                      }}
                    >
                      {t("skins.noSkin")}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Info card */}
            <div
              style={{
                background: isDark ? "#131c23" : "#ffffff",
                borderRadius: 20,
                border: isDark
                  ? "2px solid rgba(255,255,255,0.08)"
                  : "1.5px solid rgba(0,0,0,0.08)",
                padding: "14px 22px",
                display: "flex",
                flexDirection: "column",
                gap: 10,
                boxShadow: isDark ? "none" : "0 8px 24px rgba(0,0,0,0.06)",
              }}
            >
              {([
                [
                  t("skins.currentSkin"),
                  hasSelectedSkin ? previewSkin.name : t("skins.noSkin"),
                ],
                [
                  t("skins.currentCape"),
                  hasSelectedCape ? previewCape.name : t("skins.noCape"),
                ],
                [t("skins.character"), username],
              ] as const).map(([lbl, val]) => (
                <div
                  key={lbl}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 800,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      color: isDark ? "#657788" : "#778899",
                    }}
                  >
                    {lbl}
                  </span>
                  <span
                    style={{
                      fontSize: 16,
                      color: isDark ? "white" : "#111822",
                      fontWeight: 700,
                    }}
                  >
                    {val}
                  </span>
                </div>
              ))}

              {/* Action row for personal custom skin */}
              {appliedSkin === "player-custom" && playerSkin && (
                <div
                  style={{
                    marginTop: 6,
                    paddingTop: 10,
                    borderTop: isDark
                      ? "1px solid rgba(255,255,255,0.08)"
                      : "1px solid rgba(0,0,0,0.08)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <span style={{ fontSize: 13, color: "#38bdf8", fontWeight: 600 }}>
                    Tu skin personalizada activa
                  </span>
                  <button
                    type="button"
                    onClick={handleDeletePersonalSkin}
                    disabled={isDeleting}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      background: "rgba(239, 68, 68, 0.12)",
                      border: "1px solid rgba(239, 68, 68, 0.25)",
                      borderRadius: 8,
                      padding: "5px 12px",
                      color: "#f87171",
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: isDeleting ? "default" : "pointer",
                    }}
                  >
                    <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                    {isDeleting ? "Eliminando..." : "Eliminar Skin"}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* 🌟 Right: Collection Panel 🌟 */}
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <div
              key={skinType}
              className="custom-grid-scroll"
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, 1fr)",
                gap: 14,
                alignContent: "start",
                maxHeight: 800,
                overflowY: "auto",
                padding: "16px 36px 36px 36px",
                margin: "-16px -36px -28px -36px",
                animation: "fadeScaleIn 0.26s cubic-bezier(0.16, 1, 0.3, 1)",
              }}
            >
              {items.map((item) => {
                const isSel = item.id === activeId
                const isNone = item.id === "none"
                const isCustom = item.badge === "CUSTOM" || item.id === "player-custom"
                const itemAccentHex =
                  item.accent ||
                  (skinType === "skin"
                    ? (item as SkinItem).shirt
                    : (item as CapeItem).color) ||
                  "#38bdf8"
                const accent = hexToRGB(itemAccentHex)
                const displayName = isNone
                  ? skinType === "skin"
                    ? t("skins.noSkin")
                    : t("skins.noCape")
                  : item.name

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleSelectItem(item.id)}
                    className={`skin-card-item ${isSel ? "is-selected" : ""}`}
                    style={{
                      ["--card-border-color" as any]: `rgba(${accent.css}, 0.88)`,
                      ["--card-glow-color" as any]: `rgba(${accent.css}, 0.28)`,
                      position: "relative",
                    }}
                  >
                    {/* Inner Container */}
                    <div
                      style={{
                        borderRadius: 14,
                        overflow: "hidden",
                        position: "relative",
                        height: 256,
                        background: isDark ? "#080e13" : "#e6ebf2",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <div
                        style={{
                          position: "absolute",
                          inset: 0,
                          background: `radial-gradient(ellipse 85% 75% at 50% 62%, rgba(${accent.r},${accent.g},${accent.b}, ${
                            isDark ? 0.12 : 0.2
                          }) 0%, ${isDark ? "#080e13" : "#e6ebf2"} 75%)`,
                          pointerEvents: "none",
                        }}
                      />

                      {/* Badge if custom */}
                      {isCustom && (
                        <div
                          style={{
                            position: "absolute",
                            top: 8,
                            right: 8,
                            background: "rgba(56, 189, 248, 0.2)",
                            border: "1px solid rgba(56, 189, 248, 0.4)",
                            borderRadius: 6,
                            padding: "2px 8px",
                            fontSize: 10,
                            fontWeight: 800,
                            color: "#38bdf8",
                            letterSpacing: "0.05em",
                            zIndex: 3,
                          }}
                        >
                          PERSONAL
                        </div>
                      )}

                      <div style={{ position: "relative", zIndex: 1 }}>
                        {skinType === "skin" ? (
                          isNone || (!item.customImgUrl && !(item as SkinItem).skinUrl) ? (
                            <div
                              style={{
                                width: 90,
                                height: 145,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                              }}
                            >
                              <span style={{ fontSize: 13, color: "#64748b" }}>Sin Skin</span>
                            </div>
                          ) : (
                            <SkinCardPreview
                              skinUrl={item.customImgUrl || (item as SkinItem).skinUrl}
                              alt={item.name}
                              width={110}
                              height={185}
                            />
                          )
                        ) : isNone || (!item.customImgUrl && !(item as CapeItem).capeUrl) ? (
                          <div
                            style={{
                              width: 86,
                              height: 124,
                              borderRadius: 12,
                              border: isDark
                                ? "2.4px dashed rgba(255,255,255,0.18)"
                                : "2.4px dashed rgba(0,0,0,0.18)",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            <span style={{ fontSize: 13, color: "#64748b" }}>Sin Capa</span>
                          </div>
                        ) : (
                          <CapeCardPreview
                            capeUrl={item.customImgUrl || (item as CapeItem).capeUrl}
                            alt={item.name}
                            width={85}
                            height={136}
                          />
                        )}
                      </div>

                    </div>

                    {/* Name + Selected Status Row */}
                    <div
                      style={{
                        padding: "8px 8px 4px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                      }}
                    >
                      <span
                        style={{
                          fontSize: 16.5,
                          fontWeight: 700,
                          color: isSel
                            ? isDark
                              ? "white"
                              : "#111822"
                            : isDark
                              ? "rgba(255,255,255,0.7)"
                              : "#556677",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {displayName}
                      </span>
                      {isSel && (
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 800,
                            color: `rgb(${accent.css})`,
                            letterSpacing: "0.06em",
                            textTransform: "uppercase",
                          }}
                        >
                          {t("skins.selected")}
                        </span>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      <LiveToast
        message={toastState.message}
        type={toastState.type}
        accentColor={toastState.accentColor}
      />
    </div>
  )
}

