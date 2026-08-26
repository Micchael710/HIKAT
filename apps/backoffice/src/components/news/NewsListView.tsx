import React, { useState, useEffect, useCallback } from "react"
import type { ThemeMode, NewsItem } from "../../types"
import type { NewsType, NewsStatus } from "@hikat/shared"
import {
  IconPlus,
  IconEdit,
  IconTrash,
  IconSpinner,
  IconNews,
} from "../../theme/icons"
import { newsApi } from "../../services/graphqlClient"
import BackofficeSelect, { SelectOption } from "../common/BackofficeSelect"
import NewsFormModal, { NewsFormData } from "./NewsFormModal"
import DeleteConfirmModal from "./DeleteConfirmModal"
import LiveToast from "../common/LiveToast"

interface NewsListViewProps {
  theme: ThemeMode
}

const TYPE_FILTER_OPTIONS: SelectOption[] = [
  { value: "ALL", label: "Todas las categorías" },
  { value: "NEWS", label: "Noticias" },
  { value: "UPDATE", label: "Actualizaciones" },
  { value: "ANNOUNCEMENT", label: "Anuncios" },
  { value: "MAINTENANCE", label: "Mantenimiento" },
]

const STATUS_FILTER_OPTIONS: SelectOption[] = [
  { value: "ALL", label: "Todos los estados" },
  { value: "PUBLISHED", label: "Publicados" },
  { value: "DRAFT", label: "Borradores" },
]

const TYPE_CONFIG: Record<NewsType, { label: string; color: string }> = {
  NEWS: { label: "Noticia", color: "#3ec4c0" },
  UPDATE: { label: "Actualización", color: "#fb923c" },
  ANNOUNCEMENT: { label: "Anuncio", color: "#a78bfa" },
  MAINTENANCE: { label: "Mantenimiento", color: "#efc436" },
}

export default function NewsListView({ theme }: NewsListViewProps) {
  const isDark = theme === "dark"

  const [newsList, setNewsList] = useState<NewsItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Filters
  const [selectedType, setSelectedType] = useState<string>("ALL")
  const [selectedStatus, setSelectedStatus] = useState<string>("ALL")

  // Modal States
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<NewsItem | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const [deleteItem, setDeleteItem] = useState<NewsItem | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  // Toast
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [toastType, setToastType] = useState<"success" | "error" | "info">("success")

  const showToast = useCallback(
    (msg: string, type: "success" | "error" | "info" = "success") => {
      setToastMessage(msg)
      setToastType(type)
      setTimeout(() => {
        setToastMessage((cur) => (cur === msg ? null : cur))
      }, 3000)
    },
    [],
  )

  // Fetch news
  const loadNews = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const typeParam = selectedType === "ALL" ? null : (selectedType as NewsType)
      const statusParam =
        selectedStatus === "ALL" ? null : (selectedStatus as NewsStatus)

      const result = await newsApi.getAdminNews({
        type: typeParam,
        status: statusParam,
        first: 50,
      })
      setNewsList(result.items || [])
    } catch (err: any) {
      setError(err.message || "Error al cargar la lista de noticias.")
    } finally {
      setIsLoading(false)
    }
  }, [selectedType, selectedStatus])

  useEffect(() => {
    loadNews()
  }, [loadNews])

  // Create or Update
  const handleFormSubmit = async (data: NewsFormData) => {
    setIsSaving(true)
    try {
      if (editingItem) {
        await newsApi.updateNews(editingItem.id, {
          title: data.title,
          content: data.content,
          type: data.type,
          status: data.status,
          imageMediaId: data.imageMediaId,
          youtubeUrl: data.youtubeUrl,
          videoMediaId: data.videoMediaId,
        })
        showToast("Noticia actualizada correctamente", "success")
      } else {
        await newsApi.createNews({
          title: data.title,
          content: data.content,
          type: data.type,
          status: data.status,
          imageMediaId: data.imageMediaId,
          youtubeUrl: data.youtubeUrl,
          videoMediaId: data.videoMediaId,
        })
        showToast("Noticia creada correctamente", "success")
      }
      setIsFormOpen(false)
      setEditingItem(null)
      await loadNews()
    } catch (err: any) {
      showToast(err.message || "Error al guardar la noticia", "error")
      throw err
    } finally {
      setIsSaving(false)
    }
  }

  // Toggle publish status
  const handleTogglePublish = async (item: NewsItem) => {
    try {
      if (item.status === "PUBLISHED") {
        await newsApi.unpublishNews(item.id)
        showToast("Noticia pasada a borrador", "info")
      } else {
        await newsApi.publishNews(item.id)
        showToast("Noticia publicada exitosamente", "success")
      }
      await loadNews()
    } catch (err: any) {
      showToast(err.message || "Error al cambiar estado de publicación", "error")
    }
  }

  // Delete
  const handleDeleteConfirm = async () => {
    if (!deleteItem) return
    setIsDeleting(true)
    try {
      await newsApi.deleteNews(deleteItem.id)
      showToast("Noticia eliminada correctamente", "success")
      setDeleteItem(null)
      await loadNews()
    } catch (err: any) {
      showToast(err.message || "Error al eliminar la noticia", "error")
    } finally {
      setIsDeleting(false)
    }
  }

  // Format date helper
  const formatDate = (isoString?: string | null) => {
    if (!isoString) return "—"
    try {
      const d = new Date(isoString)
      return d.toLocaleDateString("es-ES", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    } catch {
      return isoString
    }
  }

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        padding: "32px 36px",
        overflowY: "auto",
        animation: "viewFadeIn 0.24s ease",
        fontFamily: "Inter, sans-serif",
      }}
      className="custom-scroll"
    >
      {/* Top Action Bar: Title on Left, "+ Nueva noticia" on Right */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 24,
        }}
      >
        <div>
          <h2
            style={{
              margin: "0 0 4px",
              fontSize: 26,
              fontWeight: 800,
              color: isDark ? "#ffffff" : "#111822",
              letterSpacing: "-0.02em",
            }}
          >
            Noticias
          </h2>
          <p
            style={{
              margin: 0,
              fontSize: 14,
              fontWeight: 500,
              color: isDark ? "rgba(255, 255, 255, 0.5)" : "#657788",
            }}
          >
            Gestión de novedades, anuncios y actualizaciones
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setEditingItem(null)
            setIsFormOpen(true)
          }}
          className="launcher-btn-primary"
          style={{
            padding: "10px 22px",
            borderRadius: 14,
            fontSize: 14.5,
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <IconPlus size={18} />
          <span>Nueva noticia</span>
        </button>
      </div>

      {/* Filters Bar: Tipo & Estado */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          marginBottom: 24,
          flexWrap: "wrap",
        }}
      >
        <BackofficeSelect
          value={selectedType}
          options={TYPE_FILTER_OPTIONS}
          onChange={(val) => setSelectedType(val)}
          theme={theme}
          width={220}
        />

        <BackofficeSelect
          value={selectedStatus}
          options={STATUS_FILTER_OPTIONS}
          onChange={(val) => setSelectedStatus(val)}
          theme={theme}
          width={180}
        />
      </div>

      {/* Error Message */}
      {error && (
        <div
          style={{
            padding: "16px 20px",
            borderRadius: 14,
            background: "rgba(255, 60, 40, 0.12)",
            border: "1.5px solid rgba(255, 100, 80, 0.4)",
            color: "#ff6b5b",
            fontSize: 14,
            fontWeight: 600,
            marginBottom: 24,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={loadNews}
            className="launcher-btn-secondary"
            style={{
              padding: "6px 14px",
              borderRadius: 8,
              fontSize: 13,
            }}
          >
            Reintentar
          </button>
        </div>
      )}

      {/* Loading Skeleton */}
      {isLoading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              style={{
                height: 84,
                borderRadius: 16,
                background: isDark ? "#121a22" : "#ffffff",
                border: isDark
                  ? "1.5px solid rgba(255, 255, 255, 0.06)"
                  : "1.5px solid rgba(0, 0, 0, 0.06)",
                display: "flex",
                alignItems: "center",
                padding: "0 20px",
                gap: 16,
                opacity: 0.6,
              }}
            >
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 12,
                  background: isDark ? "#0d1217" : "#e6ebf0",
                }}
              />
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
                <div
                  style={{
                    width: "40%",
                    height: 16,
                    borderRadius: 6,
                    background: isDark ? "#0d1217" : "#e6ebf0",
                  }}
                />
                <div
                  style={{
                    width: "20%",
                    height: 12,
                    borderRadius: 4,
                    background: isDark ? "#0d1217" : "#e6ebf0",
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty State */}
      {!isLoading && !error && newsList.length === 0 && (
        <div
          style={{
            padding: "64px 32px",
            textAlign: "center",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            background: isDark ? "#121a22" : "#ffffff",
            borderRadius: 20,
            border: isDark
              ? "1.5px solid rgba(255, 255, 255, 0.08)"
              : "1.5px solid rgba(0, 0, 0, 0.08)",
          }}
        >
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 18,
              background: isDark ? "#0d1217" : "#f0f3f7",
              color: isDark ? "rgba(255,255,255,0.4)" : "#8899aa",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 16,
            }}
          >
            <IconNews size={30} />
          </div>
          <h3
            style={{
              margin: "0 0 6px",
              fontSize: 18,
              fontWeight: 800,
              color: isDark ? "#ffffff" : "#111822",
            }}
          >
            No hay noticias registradas
          </h3>
          <p
            style={{
              margin: "0 0 20px",
              fontSize: 14,
              color: isDark ? "rgba(255, 255, 255, 0.5)" : "#657788",
            }}
          >
            {selectedType !== "ALL" || selectedStatus !== "ALL"
              ? "No se encontraron noticias con los filtros seleccionados."
              : "Comienza publicando la primera noticia del servidor."}
          </p>
          <button
            type="button"
            onClick={() => {
              setEditingItem(null)
              setIsFormOpen(true)
            }}
            className="launcher-btn-primary"
            style={{
              padding: "10px 22px",
              borderRadius: 12,
              fontSize: 14,
              fontWeight: 700,
            }}
          >
            Crear primera noticia
          </button>
        </div>
      )}

      {/* News List */}
      {!isLoading && !error && newsList.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {newsList.map((item) => {
            const isPublished = item.status === "PUBLISHED"
            const typeInfo = TYPE_CONFIG[item.type] || {
              label: item.type,
              color: "#3ec4c0",
            }
            const thumbnail =
              item.image?.url ||
              (item.youtubeVideoId
                ? `https://img.youtube.com/vi/${item.youtubeVideoId}/mqdefault.jpg`
                : null)

            return (
              <div
                key={item.id}
                className="backoffice-card"
                style={{
                  background: isDark ? "#121a22" : "#ffffff",
                  border: isDark
                    ? "1.5px solid rgba(255, 255, 255, 0.08)"
                    : "1.5px solid rgba(0, 0, 0, 0.08)",
                  borderRadius: 18,
                  padding: "14px 20px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 18,
                  boxShadow: isDark
                    ? "0 4px 18px rgba(0, 0, 0, 0.25)"
                    : "0 2px 10px rgba(0, 0, 0, 0.04)",
                }}
              >
                {/* Left: Thumbnail & Details */}
                <div style={{ display: "flex", alignItems: "center", gap: 16, minWidth: 0, flex: 1 }}>
                  {/* Cover thumbnail */}
                  <div
                    style={{
                      width: 60,
                      height: 60,
                      borderRadius: 14,
                      overflow: "hidden",
                      background: isDark ? "#0d1217" : "#e6ebf0",
                      border: isDark
                        ? "1px solid rgba(255, 255, 255, 0.1)"
                        : "1px solid rgba(0, 0, 0, 0.08)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    {thumbnail ? (
                      <img
                        src={thumbnail}
                        alt={item.title}
                        style={{
                          width: "100%",
                          height: "100%",
                          objectFit: "cover",
                          display: "block",
                        }}
                      />
                    ) : (
                      <span style={{ color: isDark ? "rgba(255,255,255,0.4)" : "#8899aa" }}>
                        <IconNews size={24} />
                      </span>
                    )}
                  </div>

                  {/* Info */}
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        marginBottom: 4,
                      }}
                    >
                      <h4
                        style={{
                          margin: 0,
                          fontSize: 16,
                          fontWeight: 700,
                          color: isDark ? "#ffffff" : "#111822",
                          letterSpacing: "-0.01em",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {item.title}
                      </h4>
                    </div>

                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        fontSize: 12.5,
                      }}
                    >
                      {/* Type Badge */}
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 5,
                          padding: "2px 8px",
                          borderRadius: 6,
                          background: isDark
                            ? "rgba(255, 255, 255, 0.06)"
                            : "#f0f3f7",
                          color: typeInfo.color,
                          fontWeight: 700,
                        }}
                      >
                        <span
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: "50%",
                            background: typeInfo.color,
                          }}
                        />
                        <span>{typeInfo.label}</span>
                      </span>

                      {/* Status Badge */}
                      <span
                        style={{
                          padding: "2px 8px",
                          borderRadius: 6,
                          fontSize: 11.5,
                          fontWeight: 800,
                          textTransform: "uppercase",
                          letterSpacing: "0.04em",
                          background: isPublished
                            ? "rgba(52, 211, 153, 0.14)"
                            : "rgba(239, 196, 54, 0.14)",
                          color: isPublished ? "#34d399" : "#efc436",
                        }}
                      >
                        {isPublished ? "Publicado" : "Borrador"}
                      </span>

                      {/* Date */}
                      <span
                        style={{
                          color: isDark ? "rgba(255, 255, 255, 0.4)" : "#8899aa",
                        }}
                      >
                        {formatDate(item.publishedAt || item.createdAt)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Right: Actions (Publish/Draft toggle, Edit, Delete) */}
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                  {/* Publish/Unpublish toggle button */}
                  <button
                    type="button"
                    onClick={() => handleTogglePublish(item)}
                    className="launcher-btn-secondary"
                    style={{
                      padding: "7px 14px",
                      borderRadius: 10,
                      fontSize: 13,
                      fontWeight: 600,
                      color: isPublished ? "#efc436" : "#34d399",
                      borderColor: isPublished
                        ? "rgba(239, 196, 54, 0.3)"
                        : "rgba(52, 211, 153, 0.3)",
                    }}
                  >
                    {isPublished ? "Pasar a borrador" : "Publicar"}
                  </button>

                  {/* Edit button */}
                  <button
                    type="button"
                    onClick={() => {
                      setEditingItem(item)
                      setIsFormOpen(true)
                    }}
                    title="Editar noticia"
                    className="launcher-btn-secondary"
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 10,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: 0,
                    }}
                  >
                    <IconEdit size={16} />
                  </button>

                  {/* Delete button */}
                  <button
                    type="button"
                    onClick={() => setDeleteItem(item)}
                    title="Eliminar noticia"
                    className="launcher-btn-danger"
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 10,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: 0,
                    }}
                  >
                    <IconTrash size={16} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Create / Edit Form Modal */}
      <NewsFormModal
        isOpen={isFormOpen}
        isEditing={!!editingItem}
        initialItem={editingItem}
        isLoading={isSaving}
        onSubmit={handleFormSubmit}
        onClose={() => {
          setIsFormOpen(false)
          setEditingItem(null)
        }}
        theme={theme}
      />

      {/* Delete Confirmation Modal */}
      <DeleteConfirmModal
        newsItem={deleteItem}
        isOpen={!!deleteItem}
        isLoading={isDeleting}
        onConfirm={handleDeleteConfirm}
        onClose={() => setDeleteItem(null)}
        theme={theme}
      />

      {/* Toast Notification */}
      <LiveToast message={toastMessage} type={toastType} theme={theme} />
    </div>
  )
}
