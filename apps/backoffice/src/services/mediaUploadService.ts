import {
  ALLOWED_IMAGE_MIME_TYPES,
  ALLOWED_VIDEO_MIME_TYPES,
  MAX_IMAGE_SIZE_BYTES,
  MAX_VIDEO_SIZE_BYTES,
  ImageMimeType,
  VideoMimeType,
} from "@hikat/shared"
import type { ContentMedia } from "../types"
import { newsApi } from "./graphqlClient"
import { authService } from "./authService"

const BACKEND_URL = import.meta.env.VITE_BACKEND_API_URL || "http://localhost:8787"

export class MediaUploadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "MediaUploadError"
  }
}

export async function uploadMediaFile(
  file: File,
  expectedType: "IMAGE" | "VIDEO",
  isRetry: boolean = false,
): Promise<ContentMedia> {
  const mimeType = file.type.toLowerCase().trim()

  // 1. Validate MIME type & file size
  if (expectedType === "IMAGE") {
    if (!ALLOWED_IMAGE_MIME_TYPES.includes(mimeType as ImageMimeType)) {
      throw new MediaUploadError(
        "Formato de imagen no compatible. Use PNG, JPEG o WebP.",
      )
    }
    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      throw new MediaUploadError("La imagen no puede superar los 5 MB.")
    }
  } else if (expectedType === "VIDEO") {
    if (!ALLOWED_VIDEO_MIME_TYPES.includes(mimeType as VideoMimeType)) {
      throw new MediaUploadError(
        "Formato de video no compatible. Use MP4 o WebM.",
      )
    }
    if (file.size > MAX_VIDEO_SIZE_BYTES) {
      throw new MediaUploadError("El video no puede superar los 25 MB.")
    }
  }

  if (file.size === 0) {
    throw new MediaUploadError("El archivo seleccionado está vacío.")
  }

  // 2. Request single-use upload ticket via GraphQL (with automatic refresh handling)
  const ticket = await newsApi.createContentMediaUpload({
    mimeType,
    sizeBytes: file.size,
  })

  const token = authService.getAccessToken()
  if (!token) {
    throw new MediaUploadError("No hay una sesión activa para subir archivos.")
  }

  // 3. Resolve upload URL (relative to backend endpoint or absolute)
  let targetUrl = ticket.uploadUrl
  if (targetUrl.startsWith("/")) {
    targetUrl = `${BACKEND_URL}${targetUrl}`
  }

  // 4. Send binary PUT request
  const arrayBuffer = await file.arrayBuffer()
  const response = await fetch(targetUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Upload-Token": ticket.uploadToken,
      "Content-Type": mimeType,
    },
    body: arrayBuffer,
  })

  if (!response.ok) {
    // If token expired during binary transport, refresh once and retry with fresh ticket
    if (response.status === 401) {
      if (!isRetry) {
        const refreshedToken = await authService.refresh()
        if (refreshedToken) {
          return uploadMediaFile(file, expectedType, true)
        }
      }
      authService.clearSession()
      throw new MediaUploadError("Su sesión ha expirado al subir el archivo.")
    }

    const errData = await response.json().catch(() => ({}))
    const msg =
      errData.error ||
      errData.message ||
      (response.status === 413
        ? "El archivo supera el tamaño máximo permitido."
        : "Error al subir el archivo multimedia.")
    throw new MediaUploadError(msg)
  }

  const saved = (await response.json()) as ContentMedia
  return saved
}
