import React, { useState, useRef, useEffect } from "react"
import {
  ThemeMode,
  SkinItem,
  CapeItem,
  DEFAULT_SKINS,
  DEFAULT_CAPES,
} from "../types"
import { hexToRGB, CANVAS_W, BASE_FONT } from "../theme/tokens"
import SkinViewer3D from "../components/minecraft/SkinViewer3D"
import SkinCardPreview from "../components/minecraft/SkinCardPreview"
import CapeCardPreview from "../components/minecraft/CapeCardPreview"
import LiveToast from "../components/common/LiveToast"
import { useTranslation } from "../context/LanguageContext"

interface SkinsViewProps {
  username: string
  appliedSkin: string
  setAppliedSkin: (id: string) => void
  appliedCape: string
  setAppliedCape: (id: string) => void
  customSkins: SkinItem[]
  setCustomSkins: React.Dispatch<React.SetStateAction<SkinItem[]>>
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
  customSkins,
  setCustomSkins,
  customCapes,
  setCustomCapes,
  theme = "dark",
}: SkinsViewProps) {
  const { t } = useTranslation()
  const [skinType, setSkinType] = useState<"skin" | "capa">("skin")
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

  const allSkins = [...customSkins, ...DEFAULT_SKINS]
  const allCapes = [...customCapes, ...DEFAULT_CAPES]
  const items = skinType === "skin" ? allSkins : allCapes

  const activeId = skinType === "skin" ? appliedSkin : appliedCape
  const previewSkin =
    allSkins.find((sk) => sk.id === appliedSkin) ?? allSkins[0] ?? null
  const previewCape =
    allCapes.find((cp) => cp.id === appliedCape) ?? allCapes[0] ?? null

  const hasSelectedSkin = Boolean(
    previewSkin && previewSkin.id !== "none" && (previewSkin.customImgUrl || previewSkin.skinUrl),
  )
  const hasSelectedCape = Boolean(
    previewCape && previewCape.id !== "none" && (previewCape.customImgUrl || previewCape.capeUrl),
  )

  /* Dynamic accent based on the currently selected / previewed skin or cape */
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
      accentColor: type === "error" ? undefined : (overrideAccent || accentHex),
    })
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current)
    toastTimerRef.current = window.setTimeout(() => {
      setToastState({ message: null })
    }, 2800)
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
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // 1. File size limit (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      showToast(t("skins.fileTooLarge") || "El archivo es demasiado grande (máximo 5MB).", "error")
      e.target.value = ""
      return
    }

    if (skinType === "skin") {
      // 2. Skin Format Check (Must be PNG)
      if (!file.type.includes("png") && !file.name.toLowerCase().endsWith(".png")) {
        showToast(t("skins.invalidSkinType") || "El archivo debe ser una imagen en formato PNG (.png).", "error")
        e.target.value = ""
        return
      }

      const reader = new FileReader()
      reader.onload = (ev) => {
        const url = ev.target?.result as string
        if (!url) return
        const img = new Image()
        img.onload = () => {
          const { width, height } = img

          // 3. Minecraft Skin Dimensions Check:
          // Standard modern: 64x64 or exact HD multiples (128x128, 256x256, 512x512, 1024x1024)
          // Standard legacy: 64x32 or exact HD multiples (128x64, 256x128, 512x256)
          const isSquare = width === height && width >= 64 && width % 64 === 0
          const isLegacy = width === height * 2 && width >= 64 && width % 64 === 0

          if (!isSquare && !isLegacy) {
            showToast(
              t("skins.invalidSkinDimensions") ||
                `Dimensiones no válidas (${width}×${height}). Debe ser una skin de Minecraft 64×64 o 64×32.`,
              "error",
            )
            return
          }

          let extractedAccent = "#38bdf8"
          try {
            const W = 48,
              H = 48
            const canvas = document.createElement("canvas")
            canvas.width = W
            canvas.height = H
            const ctx = canvas.getContext("2d")
            if (ctx) {
              ctx.drawImage(img, 0, 0, W, H)
              const data = ctx.getImageData(0, 0, W, H).data
              let bestSaturation = -1
              let bestR = 56,
                bestG = 189,
                bestB = 248
              for (let i = 0; i < data.length; i += 4) {
                const r = data[i],
                  g = data[i + 1],
                  b = data[i + 2],
                  a = data[i + 3]
                if (a > 120) {
                  const max = Math.max(r, g, b),
                    min = Math.min(r, g, b)
                  const sat = max === 0 ? 0 : (max - min) / max
                  const lum = (max + min) / 2
                  if (sat > bestSaturation && lum > 40 && lum < 220) {
                    bestSaturation = sat
                    bestR = r
                    bestG = g
                    bestB = b
                  }
                }
              }
              extractedAccent = `#${((1 << 24) + (bestR << 16) + (bestG << 8) + bestB).toString(16).slice(1)}`
            }
          } catch (_) {}

          const newId = `custom-${Date.now()}`
          const newName =
            file.name.replace(/\.[^/.]+$/, "").slice(0, 15) || "Personalizada"

          const newSkin: SkinItem = {
            id: newId,
            name: newName,
            shirt: extractedAccent,
            pants: "#1e293b",
            skin: "#f0c8a0",
            badge: "CUSTOM",
            accent: extractedAccent,
            customImgUrl: url,
            skinUrl: url,
            model: "auto-detect",
          }
          setCustomSkins((prev) => [newSkin, ...prev])
          setAppliedSkin(newId)
          showToast(t("settings.toastSaved"), "success", extractedAccent)
        }
        img.src = url
      }
      reader.readAsDataURL(file)
      e.target.value = ""
    } else {
      // 1. Cape Format Check (Must be PNG)
      if (!file.type.includes("png") && !file.name.toLowerCase().endsWith(".png")) {
        showToast(t("skins.invalidCapeType") || "Formato incorrecto. La capa debe ser una imagen PNG (.png).", "error")
        e.target.value = ""
        return
      }

      const reader = new FileReader()
      reader.onload = (ev) => {
        const url = ev.target?.result as string
        if (!url) return
        const img = new Image()
        img.onload = () => {
          const { width, height } = img

          // 2. Minecraft Cape Dimensions Check (2:1 Ratio: 64x32, 128x64, 256x128, 512x256, etc.)
          const isStandardCape = width === height * 2 && width >= 64

          if (!isStandardCape) {
            showToast(
              t("skins.invalidCapeDimensions") ||
                "La imagen no parece una capa de Minecraft. Usa un archivo de capa válido.",
              "error",
            )
            return
          }
          let extractedAccent = "#38bdf8"
          try {
            const W = 48,
              H = 48
            const canvas = document.createElement("canvas")
            canvas.width = W
            canvas.height = H
            const ctx = canvas.getContext("2d")
            if (ctx) {
              ctx.drawImage(img, 0, 0, W, H)
              const data = ctx.getImageData(0, 0, W, H).data
              let bestSaturation = -1
              let bestR = 56,
                bestG = 189,
                bestB = 248
              for (let i = 0; i < data.length; i += 4) {
                const r = data[i],
                  g = data[i + 1],
                  b = data[i + 2],
                  a = data[i + 3]
                if (a > 120) {
                  const max = Math.max(r, g, b),
                    min = Math.min(r, g, b)
                  const sat = max === 0 ? 0 : (max - min) / max
                  const lum = (max + min) / 2
                  if (sat > bestSaturation && lum > 40 && lum < 220) {
                    bestSaturation = sat
                    bestR = r
                    bestG = g
                    bestB = b
                  }
                }
              }
              extractedAccent = `#${((1 << 24) + (bestR << 16) + (bestG << 8) + bestB).toString(16).slice(1)}`
            }
          } catch (_) {}

          const newId = `custom-${Date.now()}`
          const newName =
            file.name.replace(/\.[^/.]+$/, "").slice(0, 15) || "Personalizada"

          const newCape: CapeItem = {
            id: newId,
            name: newName,
            color: extractedAccent,
            badge: "CUSTOM",
            accent: extractedAccent,
            customImgUrl: url,
            capeUrl: url,
          }
          setCustomCapes((prev) => [newCape, ...prev])
          setAppliedCape(newId)
          showToast(t("settings.toastSaved"), "success", extractedAccent)
        }
        img.src = url
      }
      reader.readAsDataURL(file)
      e.target.value = ""
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
        {/* Orb 1: Top-Left dominant glow */}
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

        {/* Orb 2: Center-Right companion ambient glow */}
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

        {/* Orb 3: Bottom-Left subtle warmth */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            transform: `translate3d(${Math.round(mouseOffset.x * 0.25)}px, ${Math.round(mouseOffset.y * 0.25)}px, 0)`,
            transition: "transform 2.2s cubic-bezier(0.16, 1, 0.3, 1)",
            willChange: "transform",
          }}
        >
          <div
            className="skins-bg-orb-3"
            style={{
              position: "absolute",
              bottom: "-15%",
              left: "25%",
              width: 800,
              height: 800,
              background: `radial-gradient(circle, rgba(${currentAccent.r}, ${currentAccent.g}, ${currentAccent.b}, ${
                isDark ? 0.18 : 0.1
              }) 0%, transparent 70%)`,
              filter: "blur(55px)",
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
        accept="image/png,image/jpeg"
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
              left: "50%",
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

          {/* Upload Button */}
          <button
            type="button"
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
              cursor: "pointer",
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
            {t("skins.uploadSkin")}
          </button>
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
              {/* Soft ambient stage backdrop */}
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background: `radial-gradient(ellipse 70% 65% at 50% 45%, rgba(${currentAccent.r}, ${currentAccent.g}, ${currentAccent.b}, ${
                    isDark ? 0.14 : 0.08
                  }) 0%, ${isDark ? "#080e13" : "#e6ebf2"} 80%)`,
                  pointerEvents: "none",
                  transition: "background 0.5s ease",
                }}
              />

              {/* Stage Content */}
              <div
                style={{
                  position: "relative",
                  zIndex: 1,
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
                        ? previewSkin.customImgUrl || previewSkin.skinUrl
                        : undefined
                    }
                    capeUrl={
                      hasSelectedCape
                        ? previewCape.customImgUrl || previewCape.capeUrl
                        : undefined
                    }
                    model={previewSkin?.model || "auto-detect"}
                    accentHex={accentHex}
                    width={414}
                    height={554}
                    isDark={isDark}
                    isCapeMode={skinType === "capa" && hasSelectedCape}
                  />
                ) : (
                  /* Elongated Minecraft character limbs with dashed border on stage */
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 14,
                    }}
                  >
                    <svg
                      width="130"
                      height="220"
                      viewBox="0 0 100 170"
                      fill="none"
                      stroke={isDark ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.25)"}
                      strokeWidth="2.4"
                      strokeDasharray="4 3"
                      strokeLinejoin="round"
                    >
                      {/* Head */}
                      <rect x="30" y="4" width="40" height="38" rx="5" />
                      {/* Left Arm */}
                      <rect x="8" y="46" width="18" height="56" rx="5" />
                      {/* Torso */}
                      <rect x="30" y="46" width="40" height="56" rx="5" />
                      {/* Right Arm */}
                      <rect x="74" y="46" width="18" height="56" rx="5" />
                      {/* Left Leg */}
                      <rect x="30" y="106" width="18" height="58" rx="5" />
                      {/* Right Leg */}
                      <rect x="52" y="106" width="18" height="58" rx="5" />
                      {/* Center X */}
                      <line x1="44" y1="68" x2="56" y2="80" strokeDasharray="none" strokeWidth="2.2" strokeLinecap="round" />
                      <line x1="56" y1="68" x2="44" y2="80" strokeDasharray="none" strokeWidth="2.2" strokeLinecap="round" />
                    </svg>
                    <span
                      style={{
                        color: isDark ? "rgba(255,255,255,0.4)" : "rgba(0,0,0,0.4)",
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
                [t("skins.currentSkin"), hasSelectedSkin ? previewSkin.name : t("skins.noSkin")],
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

                      <div style={{ position: "relative", zIndex: 1 }}>
                        {skinType === "skin" ? (
                          isNone || (!item.customImgUrl && !item.skinUrl) ? (
                            /* Perfectly elongated limbs for "Sin Skin" card */
                            <div
                              style={{
                                width: 90,
                                height: 145,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                              }}
                            >
                              <svg
                                width="82"
                                height="138"
                                viewBox="0 0 100 170"
                                fill="none"
                                stroke={isDark ? "rgba(255,255,255,0.22)" : "rgba(0,0,0,0.22)"}
                                strokeWidth="2.4"
                                strokeDasharray="4 3"
                                strokeLinejoin="round"
                              >
                                {/* Head */}
                                <rect x="30" y="4" width="40" height="38" rx="5" />
                                {/* Left Arm */}
                                <rect x="8" y="46" width="18" height="56" rx="5" />
                                {/* Torso */}
                                <rect x="30" y="46" width="40" height="56" rx="5" />
                                {/* Right Arm */}
                                <rect x="74" y="46" width="18" height="56" rx="5" />
                                {/* Left Leg */}
                                <rect x="30" y="106" width="18" height="58" rx="5" />
                                {/* Right Leg */}
                                <rect x="52" y="106" width="18" height="58" rx="5" />
                                {/* Center X */}
                                <line x1="44" y1="68" x2="56" y2="80" strokeDasharray="none" strokeWidth="2" strokeLinecap="round" />
                                <line x1="56" y1="68" x2="44" y2="80" strokeDasharray="none" strokeWidth="2" strokeLinecap="round" />
                              </svg>
                            </div>
                          ) : (
                            <SkinCardPreview
                              skinUrl={item.customImgUrl || item.skinUrl}
                              alt={item.name}
                              width={110}
                              height={185}
                            />
                          )
                        ) : isNone || (!item.customImgUrl && !item.capeUrl) ? (
                          /* Dashed Card for "Sin Capa" */
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
                              boxShadow: (item as CapeItem).color
                                ? isDark
                                  ? "0 8px 24px rgba(0,0,0,0.4)"
                                  : "0 6px 18px rgba(0,0,0,0.12)"
                                : "none",
                            }}
                          >
                            {!(item as CapeItem).color && (
                              <svg
                                width={22}
                                height={22}
                                viewBox="0 0 18 18"
                                fill="none"
                                stroke={
                                  isDark
                                    ? "rgba(255,255,255,0.25)"
                                    : "rgba(0,0,0,0.25)"
                                }
                                strokeWidth="2"
                                strokeLinecap="round"
                              >
                                <line x1="4" y1="4" x2="14" y2="14" />
                                <line x1="14" y1="4" x2="4" y2="14" />
                              </svg>
                            )}
                          </div>
                        ) : (
                          <CapeCardPreview
                            capeUrl={item.customImgUrl || item.capeUrl}
                            alt={item.name}
                            width={85}
                            height={136}
                          />
                        )}
                      </div>
                    </div>

                    {/* Name + Seleccionado Status Row */}
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
                          maxWidth: 130,
                        }}
                      >
                        {displayName}
                      </span>
                      {isSel && (
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                            color: `rgb(${accent.css})`,
                            fontSize: 12.5,
                            fontWeight: 700,
                            fontFamily: BASE_FONT,
                          }}
                        >
                          <svg
                            width={12}
                            height={12}
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="3"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                          {t("skins.selected")}
                        </div>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ── Real-time Live Toast notification matching settings & profile ── */}
      <LiveToast message={toastState.message} type={toastState.type} accentColor={toastState.accentColor} />
    </div>
  )
}
