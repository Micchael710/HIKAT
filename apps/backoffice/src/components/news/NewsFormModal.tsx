import React, { useState, useEffect, useRef } from "react"
import type { ThemeMode, NewsItem, ContentMedia } from "../../types"
import type { NewsType, NewsStatus } from "@hikat/shared"
import { parseAndNormalizeYouTubeUrl } from "@hikat/shared"
import {
  IconCross,
  IconSpinner,
  IconUpload,
  IconImage,
  IconYouTube,
  IconVideo,
  IconTrash,
} from "../../theme/icons"
import { uploadMediaFile } from "../../services/mediaUploadService"
import { BASE_FONT } from "../../theme/tokens"

export interface NewsFormData {
  title: string
  content: string
  type: NewsType
  imageMediaId?: string | null
  imageUrl?: string | null
  youtubeUrl?: string | null
  videoMediaId?: string | null
  videoUrl?: string | null
  status: NewsStatus
}

interface NewsFormModalProps {
  isOpen: boolean
  isEditing: boolean
  initialItem?: NewsItem | null
  isLoading: boolean
  onSubmit: (data: NewsFormData) => Promise<void>
  onClose: () => void
  theme?: ThemeMode
}

const NEWS_TYPE_OPTIONS: { value: NewsType; label: string; color: string }[] = [
  { value: "NEWS", label: "Noticia", color: "#3ec4c0" },
  { value: "UPDATE", label: "Actualización", color: "#fb923c" },
  { value: "ANNOUNCEMENT", label: "Anuncio", color: "#a78bfa" },
  { value: "MAINTENANCE", label: "Mantenimiento", color: "#efc436" },
]

export default function NewsFormModal({
  isOpen,
  isEditing,
  initialItem,
  isLoading,
  onSubmit,
  onClose,
  theme = "dark",
}: NewsFormModalProps) {
  const isDark = theme === "dark"

  const [title, setTitle] = useState("")
  const [content, setContent] = useState("")
  const [type, setType] = useState<NewsType>("NEWS")
  const [status, setStatus] = useState<NewsStatus>("DRAFT")

  // Media state
  const [imageMediaId, setImageMediaId] = useState<string | null>(null)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [isUploadingImage, setIsUploadingImage] = useState(false)

  const [youtubeUrl, setYoutubeUrl] = useState("")
  const [parsedYouTube, setParsedYouTube] = useState<{
    videoId: string
    canonicalUrl: string
  } | null>(null)

  const [videoMediaId, setVideoMediaId] = useState<string | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [isUploadingVideo, setIsUploadingVideo] = useState(false)

  const [formError, setFormError] = useState<string | null>(null)

  const imageInputRef = useRef<HTMLInputElement>(null)
  const videoInputRef = useRef<HTMLInputElement>(null)

  // Initialize or reset form data
  useEffect(() => {
    if (isOpen) {
      if (initialItem) {
        setTitle(initialItem.title || "")
        setContent(initialItem.content || "")
        setType(initialItem.type || "NEWS")
        setStatus(initialItem.status || "DRAFT")
        setImageMediaId(initialItem.image?.id || null)
        setImageUrl(initialItem.image?.url || null)
        setYoutubeUrl(initialItem.youtubeUrl || "")
        setVideoMediaId(initialItem.video?.id || null)
        setVideoUrl(initialItem.video?.url || null)
      } else {
        setTitle("")
        setContent("")
        setType("NEWS")
        setStatus("DRAFT")
        setImageMediaId(null)
        setImageUrl(null)
        setYoutubeUrl("")
        setVideoMediaId(null)
        setVideoUrl(null)
      }
      setFormError(null)
    }
  }, [isOpen, initialItem])

  // Update YouTube preview on URL change
  useEffect(() => {
    if (youtubeUrl.trim()) {
      const parsed = parseAndNormalizeYouTubeUrl(youtubeUrl)
      setParsedYouTube(parsed)
    } else {
      setParsedYouTube(null)
    }
  }, [youtubeUrl])

  if (!isOpen) return null

  // Handle image upload
  const handleImageFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setIsUploadingImage(true)
    setFormError(null)
    try {
      const media: ContentMedia = await uploadMediaFile(file, "IMAGE")
      setImageMediaId(media.id)
      setImageUrl(media.url)
    } catch (err: any) {
      setFormError(err.message || "Error al subir la imagen.")
    } finally {
      setIsUploadingImage(false)
      if (imageInputRef.current) imageInputRef.current.value = ""
    }
  }

  // Handle video upload
  const handleVideoFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setIsUploadingVideo(true)
    setFormError(null)
    try {
      const media: ContentMedia = await uploadMediaFile(file, "VIDEO")
      setVideoMediaId(media.id)
      setVideoUrl(media.url)
    } catch (err: any) {
      setFormError(err.message || "Error al subir el video.")
    } finally {
      setIsUploadingVideo(false)
      if (videoInputRef.current) videoInputRef.current.value = ""
    }
  }

  // Handle form submission
  const handleSubmit = async (submitStatus?: NewsStatus) => {
    setFormError(null)

    if (!title.trim()) {
      setFormError("El título de la noticia es obligatorio.")
      return
    }

    if (!content.trim()) {
      setFormError("El contenido de la noticia es obligatorio.")
      return
    }

    if (youtubeUrl.trim() && !parsedYouTube) {
      setFormError("El enlace de YouTube ingresado no es válido.")
      return
    }

    const finalStatus = submitStatus || status

    try {
      await onSubmit({
        title: title.trim(),
        content: content.trim(),
        type,
        status: finalStatus,
        imageMediaId: imageMediaId || null,
        imageUrl: imageUrl || null,
        youtubeUrl: parsedYouTube ? parsedYouTube.canonicalUrl : null,
        videoMediaId: videoMediaId || null,
        videoUrl: videoUrl || null,
      })
    } catch (err: any) {
      setFormError(err.message || "Error al guardar la noticia.")
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 900,
        background: "rgba(0, 0, 0, 0.78)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        animation: "fadeIn 0.2s ease",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 760,
          maxWidth: "94vw",
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          background: isDark ? "#121a22" : "#ffffff",
          borderRadius: 22,
          border: isDark
            ? "1.5px solid rgba(255, 255, 255, 0.1)"
            : "1.5px solid rgba(0, 0, 0, 0.1)",
          boxShadow: isDark
            ? "0 24px 80px rgba(0, 0, 0, 0.8)"
            : "0 20px 60px rgba(0, 0, 0, 0.15)",
          animation: "slideUp 0.24s cubic-bezier(0.16, 1, 0.3, 1) both",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "20px 28px",
            borderBottom: isDark
              ? "1px solid rgba(255, 255, 255, 0.08)"
              : "1px solid rgba(0, 0, 0, 0.08)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div>
            <h2
              style={{
                margin: "0 0 2px",
                fontSize: 20,
                fontWeight: 800,
                color: isDark ? "#ffffff" : "#111822",
                letterSpacing: "-0.02em",
              }}
            >
              {isEditing ? "Editar Noticia" : "Nueva Noticia"}
            </h2>
            <p
              style={{
                margin: 0,
                fontSize: 13,
                color: isDark ? "rgba(255, 255, 255, 0.5)" : "#657788",
              }}
            >
              {isEditing
                ? "Modifica los campos y publica cuando esté lista"
                : "Completa la información para crear una nueva publicación"}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            style={{
              width: 34,
              height: 34,
              borderRadius: 10,
              border: "none",
              background: isDark
                ? "rgba(255, 255, 255, 0.06)"
                : "rgba(0, 0, 0, 0.06)",
              color: isDark ? "#ffffff" : "#111822",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <IconCross size={16} />
          </button>
        </div>

        {/* Scrollable Form Body */}
        <div
          className="custom-scroll"
          style={{
            padding: "24px 28px",
            overflowY: "auto",
            flex: 1,
            display: "flex",
            flexDirection: "column",
            gap: 20,
          }}
        >
          {/* Form Error Banner */}
          {formError && (
            <div
              style={{
                padding: "12px 16px",
                borderRadius: 12,
                background: "rgba(255, 60, 40, 0.12)",
                border: "1.5px solid rgba(255, 100, 80, 0.4)",
                color: "#ff6b5b",
                fontSize: 13.5,
                fontWeight: 600,
              }}
            >
              {formError}
            </div>
          )}

          {/* 1. Título */}
          <div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: 6,
              }}
            >
              <label
                htmlFor="news-title"
                style={{
                  fontSize: 13.5,
                  fontWeight: 700,
                  color: isDark ? "#ffffff" : "#111822",
                }}
              >
                Título
              </label>
              <span
                style={{
                  fontSize: 12,
                  color: isDark ? "rgba(255, 255, 255, 0.4)" : "#8899aa",
                }}
              >
                {title.length}/200
              </span>
            </div>
            <input
              id="news-title"
              type="text"
              maxLength={200}
              placeholder="Ej: Gran actualización del servidor y eventos"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="launcher-input"
              style={{
                width: "100%",
                height: 44,
                padding: "0 14px",
                borderRadius: 12,
                background: isDark ? "#0d1217" : "#f0f3f7",
                border: isDark
                  ? "1.5px solid rgba(255, 255, 255, 0.12)"
                  : "1.5px solid rgba(0, 0, 0, 0.12)",
                color: isDark ? "#ffffff" : "#111822",
                fontSize: 14.5,
                fontWeight: 500,
              }}
            />
          </div>

          {/* 2. Tipo de Noticia & Estado */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            {/* Tipo */}
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: 13.5,
                  fontWeight: 700,
                  color: isDark ? "#ffffff" : "#111822",
                  marginBottom: 8,
                }}
              >
                Categoría
              </label>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 8,
                }}
              >
                {NEWS_TYPE_OPTIONS.map((opt) => {
                  const selected = type === opt.value
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setType(opt.value)}
                      style={{
                        padding: "8px 10px",
                        borderRadius: 10,
                        border: selected
                          ? `1.5px solid ${opt.color}`
                          : isDark
                            ? "1.5px solid rgba(255, 255, 255, 0.08)"
                            : "1.5px solid rgba(0, 0, 0, 0.08)",
                        background: selected
                          ? isDark
                            ? "rgba(255, 255, 255, 0.08)"
                            : "#e6ebf0"
                          : isDark
                            ? "#0d1217"
                            : "#f0f3f7",
                        color: selected ? opt.color : isDark ? "rgba(255, 255, 255, 0.7)" : "#556677",
                        fontSize: 13,
                        fontWeight: selected ? 700 : 500,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 6,
                        transition: "all 0.15s ease",
                      }}
                    >
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          background: opt.color,
                        }}
                      />
                      <span>{opt.label}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Estado */}
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: 13.5,
                  fontWeight: 700,
                  color: isDark ? "#ffffff" : "#111822",
                  marginBottom: 8,
                }}
              >
                Estado
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <button
                  type="button"
                  onClick={() => setStatus("DRAFT")}
                  style={{
                    padding: "8px 10px",
                    borderRadius: 10,
                    border:
                      status === "DRAFT"
                        ? "1.5px solid #efc436"
                        : isDark
                          ? "1.5px solid rgba(255, 255, 255, 0.08)"
                          : "1.5px solid rgba(0, 0, 0, 0.08)",
                    background:
                      status === "DRAFT"
                        ? isDark
                          ? "rgba(239, 196, 54, 0.12)"
                          : "#fdf8ea"
                        : isDark
                          ? "#0d1217"
                          : "#f0f3f7",
                    color: status === "DRAFT" ? "#efc436" : isDark ? "rgba(255, 255, 255, 0.7)" : "#556677",
                    fontSize: 13,
                    fontWeight: status === "DRAFT" ? 700 : 500,
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                  }}
                >
                  Borrador
                </button>

                <button
                  type="button"
                  onClick={() => setStatus("PUBLISHED")}
                  style={{
                    padding: "8px 10px",
                    borderRadius: 10,
                    border:
                      status === "PUBLISHED"
                        ? "1.5px solid #34d399"
                        : isDark
                          ? "1.5px solid rgba(255, 255, 255, 0.08)"
                          : "1.5px solid rgba(0, 0, 0, 0.08)",
                    background:
                      status === "PUBLISHED"
                        ? isDark
                          ? "rgba(52, 211, 153, 0.12)"
                          : "#edfcf6"
                        : isDark
                          ? "#0d1217"
                          : "#f0f3f7",
                    color: status === "PUBLISHED" ? "#34d399" : isDark ? "rgba(255, 255, 255, 0.7)" : "#556677",
                    fontSize: 13,
                    fontWeight: status === "PUBLISHED" ? 700 : 500,
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                  }}
                >
                  Publicado
                </button>
              </div>
            </div>
          </div>

          {/* 3. Imagen de Portada */}
          <div>
            <label
              style={{
                display: "block",
                fontSize: 13.5,
                fontWeight: 700,
                color: isDark ? "#ffffff" : "#111822",
                marginBottom: 8,
              }}
            >
              Imagen de Portada (Opcional)
            </label>

            <input
              ref={imageInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              style={{ display: "none" }}
              onChange={handleImageFileChange}
            />

            {imageUrl ? (
              <div
                style={{
                  position: "relative",
                  width: "100%",
                  height: 180,
                  borderRadius: 14,
                  overflow: "hidden",
                  border: isDark
                    ? "1.5px solid rgba(255, 255, 255, 0.12)"
                    : "1.5px solid rgba(0, 0, 0, 0.12)",
                }}
              >
                <img
                  src={imageUrl}
                  alt="Vista previa portada"
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    display: "block",
                  }}
                />
                <button
                  type="button"
                  onClick={() => {
                    setImageMediaId(null)
                    setImageUrl(null)
                  }}
                  title="Quitar imagen"
                  style={{
                    position: "absolute",
                    top: 10,
                    right: 10,
                    background: "rgba(0, 0, 0, 0.75)",
                    border: "1px solid rgba(255, 100, 80, 0.5)",
                    color: "#ff6b5b",
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <IconTrash size={16} />
                </button>
              </div>
            ) : (
              <div
                onClick={() => imageInputRef.current?.click()}
                style={{
                  width: "100%",
                  height: 90,
                  borderRadius: 14,
                  border: isDark
                    ? "1.5px dashed rgba(255, 255, 255, 0.18)"
                    : "1.5px dashed rgba(0, 0, 0, 0.18)",
                  background: isDark ? "#0d1217" : "#f0f3f7",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  cursor: isUploadingImage ? "wait" : "pointer",
                  transition: "border-color 0.18s ease",
                }}
              >
                {isUploadingImage ? (
                  <>
                    <IconSpinner size={22} />
                    <span style={{ fontSize: 13, color: "#3ec4c0", fontWeight: 600 }}>
                      Subiendo imagen...
                    </span>
                  </>
                ) : (
                  <>
                    <span style={{ color: isDark ? "rgba(255,255,255,0.6)" : "#657788" }}>
                      <IconImage size={24} />
                    </span>
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: isDark ? "rgba(255, 255, 255, 0.8)" : "#334455",
                      }}
                    >
                      Haz clic para seleccionar una imagen (PNG, JPG, WebP)
                    </span>
                  </>
                )}
              </div>
            )}
          </div>

          {/* 4. Video de YouTube */}
          <div>
            <label
              htmlFor="youtube-url"
              style={{
                display: "block",
                fontSize: 13.5,
                fontWeight: 700,
                color: isDark ? "#ffffff" : "#111822",
                marginBottom: 8,
              }}
            >
              Enlace de YouTube (Opcional)
            </label>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <div style={{ position: "relative", flex: 1 }}>
                <input
                  id="youtube-url"
                  type="text"
                  placeholder="https://www.youtube.com/watch?v=..."
                  value={youtubeUrl}
                  onChange={(e) => setYoutubeUrl(e.target.value)}
                  className="launcher-input"
                  style={{
                    width: "100%",
                    height: 42,
                    padding: "0 14px 0 38px",
                    borderRadius: 12,
                    background: isDark ? "#0d1217" : "#f0f3f7",
                    border: isDark
                      ? "1.5px solid rgba(255, 255, 255, 0.12)"
                      : "1.5px solid rgba(0, 0, 0, 0.12)",
                    color: isDark ? "#ffffff" : "#111822",
                    fontSize: 14,
                    fontWeight: 500,
                  }}
                />
                <span
                  style={{
                    position: "absolute",
                    left: 12,
                    top: "50%",
                    transform: "translateY(-50%)",
                    color: "#ff0000",
                    display: "flex",
                    alignItems: "center",
                  }}
                >
                  <IconYouTube size={18} />
                </span>
              </div>
              {youtubeUrl && (
                <button
                  type="button"
                  onClick={() => setYoutubeUrl("")}
                  style={{
                    height: 42,
                    padding: "0 14px",
                    borderRadius: 12,
                    border: "none",
                    background: isDark ? "#1a242e" : "#e0e6ed",
                    color: isDark ? "white" : "#111822",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Limpiar
                </button>
              )}
            </div>

            {/* YouTube Live Embed Preview */}
            {parsedYouTube && (
              <div
                style={{
                  marginTop: 10,
                  borderRadius: 14,
                  overflow: "hidden",
                  aspectRatio: "16 / 9",
                  maxHeight: 220,
                  border: isDark
                    ? "1.5px solid rgba(255, 255, 255, 0.1)"
                    : "1.5px solid rgba(0, 0, 0, 0.1)",
                }}
              >
                <iframe
                  width="100%"
                  height="100%"
                  src={`https://www.youtube.com/embed/${parsedYouTube.videoId}`}
                  title="YouTube video preview"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  style={{ border: "none", display: "block" }}
                />
              </div>
            )}
          </div>

          {/* 5. Video subido */}
          <div>
            <label
              style={{
                display: "block",
                fontSize: 13.5,
                fontWeight: 700,
                color: isDark ? "#ffffff" : "#111822",
                marginBottom: 8,
              }}
            >
              Video Subido (Opcional)
            </label>

            <input
              ref={videoInputRef}
              type="file"
              accept="video/mp4,video/webm"
              style={{ display: "none" }}
              onChange={handleVideoFileChange}
            />

            {videoUrl ? (
              <div
                style={{
                  position: "relative",
                  borderRadius: 14,
                  overflow: "hidden",
                  border: isDark
                    ? "1.5px solid rgba(255, 255, 255, 0.12)"
                    : "1.5px solid rgba(0, 0, 0, 0.12)",
                }}
              >
                <video
                  src={videoUrl}
                  controls
                  style={{ width: "100%", maxHeight: 200, display: "block", background: "#000" }}
                />
                <button
                  type="button"
                  onClick={() => {
                    setVideoMediaId(null)
                    setVideoUrl(null)
                  }}
                  title="Quitar video"
                  style={{
                    position: "absolute",
                    top: 10,
                    right: 10,
                    background: "rgba(0, 0, 0, 0.75)",
                    border: "1px solid rgba(255, 100, 80, 0.5)",
                    color: "#ff6b5b",
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <IconTrash size={16} />
                </button>
              </div>
            ) : (
              <div
                onClick={() => videoInputRef.current?.click()}
                style={{
                  width: "100%",
                  height: 80,
                  borderRadius: 14,
                  border: isDark
                    ? "1.5px dashed rgba(255, 255, 255, 0.18)"
                    : "1.5px dashed rgba(0, 0, 0, 0.18)",
                  background: isDark ? "#0d1217" : "#f0f3f7",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  cursor: isUploadingVideo ? "wait" : "pointer",
                  transition: "border-color 0.18s ease",
                }}
              >
                {isUploadingVideo ? (
                  <>
                    <IconSpinner size={22} />
                    <span style={{ fontSize: 13, color: "#3ec4c0", fontWeight: 600 }}>
                      Subiendo video...
                    </span>
                  </>
                ) : (
                  <>
                    <span style={{ color: isDark ? "rgba(255,255,255,0.6)" : "#657788" }}>
                      <IconVideo size={24} />
                    </span>
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: isDark ? "rgba(255, 255, 255, 0.8)" : "#334455",
                      }}
                    >
                      Haz clic para subir un video (MP4, WebM - máx 25 MB)
                    </span>
                  </>
                )}
              </div>
            )}
          </div>

          {/* 6. Contenido */}
          <div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: 6,
              }}
            >
              <label
                htmlFor="news-content"
                style={{
                  fontSize: 13.5,
                  fontWeight: 700,
                  color: isDark ? "#ffffff" : "#111822",
                }}
              >
                Contenido
              </label>
              <span
                style={{
                  fontSize: 12,
                  color: isDark ? "rgba(255, 255, 255, 0.4)" : "#8899aa",
                }}
              >
                {content.length} caracteres
              </span>
            </div>
            <textarea
              id="news-content"
              rows={7}
              placeholder="Escribe el cuerpo de la noticia aquí..."
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="launcher-input"
              style={{
                width: "100%",
                padding: "12px 14px",
                borderRadius: 12,
                background: isDark ? "#0d1217" : "#f0f3f7",
                border: isDark
                  ? "1.5px solid rgba(255, 255, 255, 0.12)"
                  : "1.5px solid rgba(0, 0, 0, 0.12)",
                color: isDark ? "#ffffff" : "#111822",
                fontSize: 14.5,
                fontWeight: 400,
                lineHeight: 1.6,
                resize: "vertical",
              }}
            />
          </div>
        </div>

        {/* Footer Actions */}
        <div
          style={{
            padding: "16px 28px",
            borderTop: isDark
              ? "1px solid rgba(255, 255, 255, 0.08)"
              : "1px solid rgba(0, 0, 0, 0.08)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading || isUploadingImage || isUploadingVideo}
            className="launcher-btn-secondary"
            style={{
              padding: "10px 18px",
              borderRadius: 12,
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            Cancelar
          </button>

          <div style={{ display: "flex", gap: 10 }}>
            {status === "DRAFT" && (
              <button
                type="button"
                onClick={() => handleSubmit("PUBLISHED")}
                disabled={isLoading || isUploadingImage || isUploadingVideo}
                className="launcher-btn-primary"
                style={{
                  padding: "10px 20px",
                  borderRadius: 12,
                  fontSize: 14,
                  fontWeight: 700,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                {isLoading ? (
                  <>
                    <IconSpinner size={16} />
                    <span>Guardando...</span>
                  </>
                ) : (
                  <span>Guardar y Publicar</span>
                )}
              </button>
            )}

            <button
              type="button"
              onClick={() => handleSubmit()}
              disabled={isLoading || isUploadingImage || isUploadingVideo}
              className={status === "DRAFT" ? "launcher-btn-secondary" : "launcher-btn-primary"}
              style={{
                padding: "10px 20px",
                borderRadius: 12,
                fontSize: 14,
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              {isLoading ? (
                <>
                  <IconSpinner size={16} />
                  <span>Guardando...</span>
                </>
              ) : (
                <span>{isEditing ? "Guardar Cambios" : "Guardar Borrador"}</span>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
