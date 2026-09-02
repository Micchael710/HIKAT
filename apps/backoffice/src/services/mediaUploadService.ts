import {
  ALLOWED_IMAGE_MIME_TYPES,
  ALLOWED_VIDEO_MIME_TYPES,
  ImageMimeType,
  VideoMimeType,
} from "@hikat/shared"
import type { ContentMedia } from "../types"
import { newsApi } from "./graphqlClient"
import { uploadFileToR2Multipart } from "./gameFileUploadService"

export class MediaUploadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "MediaUploadError"
  }
}

export async function uploadMediaFile(
  file: File,
  expectedType: "IMAGE" | "VIDEO",
): Promise<ContentMedia> {
  const mimeType = file.type.toLowerCase().trim()

  // 1. Validate MIME type
  if (expectedType === "IMAGE") {
    if (!ALLOWED_IMAGE_MIME_TYPES.includes(mimeType as ImageMimeType)) {
      throw new MediaUploadError(
        "Formato de imagen no compatible. Use PNG, JPEG o WebP.",
      )
    }
  } else if (expectedType === "VIDEO") {
    if (!ALLOWED_VIDEO_MIME_TYPES.includes(mimeType as VideoMimeType)) {
      throw new MediaUploadError(
        "Formato de video no compatible. Use MP4 o WebM.",
      )
    }
  }

  // 2. Reject empty files
  if (file.size === 0) {
    throw new MediaUploadError("El archivo seleccionado está vacío.")
  }

  // 3. Request single-use upload ticket via GraphQL
  let ticket: import("./graphqlClient").MediaUploadTicketPayload
  try {
    ticket = await newsApi.createContentMediaUpload({
      mimeType,
      sizeBytes: file.size,
    })
  } catch (err: any) {
    throw new MediaUploadError(err.message || "Error al solicitar autorización de subida.")
  }

  if (!ticket || !ticket.credentials || !ticket.endpoint || !ticket.bucket || !ticket.objectKey) {
    throw new MediaUploadError("Credenciales de subida directa R2 no disponibles.")
  }

  // 4. Direct multipart upload to R2 (without reading the entire file into memory)
  try {
    await uploadFileToR2Multipart(file, {
      endpoint: ticket.endpoint,
      credentials: ticket.credentials,
      bucket: ticket.bucket,
      objectKey: ticket.objectKey,
      contentType: mimeType,
    })
  } catch (err: any) {
    throw new MediaUploadError(err.message || "Error al transferir el archivo multimedia a R2.")
  }

  // 5. Finalize and verify in Backend via completeContentMediaUpload
  try {
    const saved = await newsApi.completeContentMediaUpload({
      uploadToken: ticket.uploadToken,
    })
    return saved
  } catch (err: any) {
    throw new MediaUploadError(err.message || "Error al verificar la subida en el servidor.")
  }
}
