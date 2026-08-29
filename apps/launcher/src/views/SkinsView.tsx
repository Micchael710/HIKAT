import React, { useState, useRef, useEffect } from "react"
import {
  ThemeMode,
  SkinItem,
  CapeItem,
  PlayerSkin,
  PlayerCape,
  DEFAULT_SKINS,
  DEFAULT_CAPES,
} from "../types"
import { CANVAS_W, BASE_FONT } from "../theme/tokens"
import SkinViewer3D from "../components/minecraft/SkinViewer3D"
import SkinCardPreview from "../components/minecraft/SkinCardPreview"
import CapeCardPreview from "../components/minecraft/CapeCardPreview"
import { loadCapeToCanvas } from "skinview-utils"
import LiveToast from "../components/common/LiveToast"
import { useTranslation } from "../context/LanguageContext"
import { useDynamicAccent } from "../utils/dynamicAccent"
import {
  validateMinecraftSkinTexture,
  validateCapeTextureBuffer,
  MAX_SKIN_SIZE_BYTES,
  MAX_CAPE_SIZE_BYTES,
  MAX_PLAYER_CAPES,
} from "@hikat/shared"

interface SkinCapeItemCardProps {
  item: SkinItem | CapeItem
  skinType: "skin" | "capa"
  isSel: boolean
  isDark: boolean
  onSelect: (id: string, itemAccent?: string) => void
  t: (key: string, params?: Record<string, any>) => string
}

function SkinCapeItemCard({
  item,
  skinType,
  isSel,
  isDark,
  onSelect,
  t,
}: SkinCapeItemCardProps) {
  const isNone = item.id === "none"
  const isCustom = item.badge === "CUSTOM" || item.id === "player-custom"
  const textureUrl =
    item.customImgUrl ||
    (skinType === "skin"
      ? (item as SkinItem).skinUrl
      : (item as CapeItem).capeUrl)

  const fallbackHex =
    item.accent ||
    (skinType === "skin"
      ? (item as SkinItem).shirt
      : (item as CapeItem).color) ||
    (skinType === "capa" ? "#10b981" : "#38bdf8")

  const accent = useDynamicAccent(textureUrl, fallbackHex)

  const displayName = isNone
    ? skinType === "skin"
      ? t("skins.noSkin")
      : t("skins.noCape")
    : item.name

  return (
    <button
      type="button"
      onClick={() => onSelect(item.id, accent.hex)}
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
              background:
                skinType === "capa"
                  ? "rgba(16, 185, 129, 0.2)"
                  : "rgba(56, 189, 248, 0.2)",
              border:
                skinType === "capa"
                  ? "1px solid rgba(16, 185, 129, 0.4)"
                  : "1px solid rgba(56, 189, 248, 0.4)",
              borderRadius: 6,
              padding: "2px 8px",
              fontSize: 10,
              fontWeight: 800,
              color: skinType === "capa" ? "#10b981" : "#38bdf8",
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
                <span style={{ fontSize: 13, color: "#64748b" }}>
                  {t("skins.noSkin")}
                </span>
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
              <span style={{ fontSize: 13, color: "#64748b" }}>
                {t("skins.noCape")}
              </span>
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
}

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
  allCapes?: CapeItem[]
  playerCapes?: PlayerCape[]
  onUploadCape?: (file: File, name?: string) => Promise<PlayerCape>
  onDeleteCape?: (id: string) => Promise<boolean>
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
  allCapes = DEFAULT_CAPES,
  playerCapes = [],
  onUploadCape,
  onDeleteCape,
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
  const activeTextureUrl =
    activePreview?.customImgUrl ||
    (skinType === "skin"
      ? (activePreview as SkinItem)?.skinUrl
      : (activePreview as CapeItem)?.capeUrl)
  const activeFallbackHex =
    activePreview?.accent ||
    (skinType === "skin"
      ? (activePreview as SkinItem)?.shirt
      : (activePreview as CapeItem)?.color) ||
    (skinType === "capa" ? "#10b981" : "#38bdf8")

  const currentAccent = useDynamicAccent(activeTextureUrl, activeFallbackHex)

  const showToast = (
    msg?: string,
    type: "success" | "error" = "success",
    overrideAccent?: string,
  ) => {
    setToastState({
      message: msg || t("settings.toastSaved"),
      type,
      accentColor: type === "error" ? undefined : overrideAccent || currentAccent.hex,
    })
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current)
    toastTimerRef.current = window.setTimeout(() => {
      setToastState({ message: null })
    }, 3200)
  }

  const CONTENT_LEFT = 184

  const handleSelectItem = (id: string, itemAccentHex?: string) => {
    if (skinType === "skin") {
      setAppliedSkin(id)
    } else {
      setAppliedCape(id)
    }
    showToast(t("settings.toastSaved"), "success", itemAccentHex || currentAccent.hex)
  }

  /* File upload with strict verification & format validation */
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (skinType === "skin") {
      // 1. Format check: PNG only
      if (
        !file.type.includes("png") &&
        !file.name.toLowerCase().endsWith(".png")
      ) {
        showToast(t("skins.invalidSkinType"), "error")
        e.target.value = ""
        return
      }

      // 2. Size limit check: max 1MB
      if (file.size > MAX_SKIN_SIZE_BYTES) {
        showToast(t("skins.fileTooLarge"), "error")
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
            validation.error || t("skins.invalidSkinDimensions"),
            "error",
          )
          return
        }

        if (onUploadSkin) {
          await onUploadSkin(file)
          showToast(t("skins.skinUploadSuccess"), "success", "#38bdf8")
        }
      } catch (err: any) {
        showToast(
          err?.message || t("skins.invalidSkinDimensions"),
          "error",
        )
      } finally {
        setIsUploading(false)
        e.target.value = ""
      }
    } else {
      // Cape Upload (End-to-End Capes subsystem)
      if (
        !file.type.includes("png") &&
        !file.name.toLowerCase().endsWith(".png")
      ) {
        showToast(t("skins.invalidCapeType"), "error")
        e.target.value = ""
        return
      }

      if (file.size > MAX_CAPE_SIZE_BYTES) {
        showToast(t("skins.fileTooLarge"), "error")
        e.target.value = ""
        return
      }

      if (playerCapes.length >= MAX_PLAYER_CAPES) {
        showToast(t("skins.capeLimitReached", { limit: MAX_PLAYER_CAPES }), "error")
        e.target.value = ""
        return
      }

      try {
        setIsUploading(true)
        const arrayBuffer = await file.arrayBuffer()
        const validation = validateCapeTextureBuffer(arrayBuffer)
        if (!validation.valid) {
          showToast(
            validation.error || t("skins.invalidCapeDimensions"),
            "error",
          )
          return
        }

        // Visual compatibility validation with skinview-utils
        try {
          const imgUrl = URL.createObjectURL(file)
          const img = new Image()
          img.src = imgUrl
          await new Promise<void>((resolve, reject) => {
            img.onload = () => resolve()
            img.onerror = () => reject(new Error("No se pudo cargar la imagen"))
          })
          URL.revokeObjectURL(imgUrl)

          const tempCanvas = document.createElement("canvas")
          loadCapeToCanvas(tempCanvas, img)
        } catch {
          showToast(t("skins.invalidCapeType"), "error")
          return
        }

        if (onUploadCape) {
          const capeName = file.name.replace(/\.[^/.]+$/, "").slice(0, 20) || "Mi Capa"
          await onUploadCape(file, capeName)
          showToast(t("skins.capeUploadSuccess"), "success", "#10b981")
        }
      } catch (err: any) {
        showToast(
          err?.message || t("skins.invalidCapeDimensions"),
          "error",
        )
      } finally {
        setIsUploading(false)
        e.target.value = ""
      }
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
        showToast(t("skins.skinDeleteSuccess"), "success")
      } else {
        showToast(t("skins.skinDeleteError"), "error")
      }
    } catch (err: any) {
      showToast(err?.message || t("skins.skinDeleteError"), "error")
    } finally {
      setIsDeleting(false)
    }
  }

  /* Handle deletion of custom player cape */
  const handleDeletePersonalCape = async (capeId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    if (!onDeleteCape || isDeleting) return

    try {
      setIsDeleting(true)
      const success = await onDeleteCape(capeId)
      if (success) {
        showToast(t("skins.capeDeleteSuccess"), "success")
      } else {
        showToast(t("skins.capeDeleteError"), "error")
      }
    } catch (err: any) {
      showToast(err?.message || t("skins.capeDeleteError"), "error")
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

          {/* Right Action Tools: Delete Custom & Upload Buttons */}
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {/* Delete Custom Button */}
            {((skinType === "skin" && appliedSkin === "player-custom" && Boolean(playerSkin)) ||
              (skinType === "capa" && playerCapes.some((pc) => pc.id === appliedCape))) && (
              <button
                type="button"
                disabled={isDeleting}
                onClick={(e) => {
                  if (skinType === "skin") {
                    handleDeletePersonalSkin(e)
                  } else {
                    handleDeletePersonalCape(appliedCape, e)
                  }
                }}
                className="launcher-btn-danger"
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
                  cursor: isDeleting ? "default" : "pointer",
                  opacity: isDeleting ? 0.7 : 1,
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
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
                {isDeleting
                  ? t("common.deleting")
                  : skinType === "skin"
                    ? t("skins.deleteSkin")
                    : t("skins.deleteCape")}
              </button>
            )}

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
              {isUploading
                ? t("common.uploading")
                : skinType === "skin"
                  ? t("skins.uploadSkin")
                  : t("skins.uploadCape")}
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

              {/* 3D Skin & Cape Viewer (Uses auto-detect for skin and loadCape) */}
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
                    isCapeMode={skinType === "capa"}
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
              {items.map((item) => (
                <SkinCapeItemCard
                  key={item.id}
                  item={item}
                  skinType={skinType}
                  isSel={item.id === activeId}
                  isDark={isDark}
                  onSelect={handleSelectItem}
                  t={t}
                />
              ))}
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
