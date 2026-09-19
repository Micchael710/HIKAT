import { createSHA512 } from "hash-wasm"
import { graphqlClient } from "./graphqlClient"
import { uploadFileToR2Multipart } from "./gameFileUploadService"
import type { LauncherReleaseItem } from "../types"

export interface LauncherUploadProgress {
  phase: "hashing" | "requesting_ticket" | "uploading" | "completing"
  percentage: number
  message: string
}

/**
 * Computes the SHA-512 Base64 digest of a File incrementally using hash-wasm
 * in 8 MB chunks, avoiding loading large installer files into RAM.
 */
export async function calculateFileSha512Base64(
  file: File,
  onProgress?: (progress: number) => void,
): Promise<string> {
  const hasher = await createSHA512()
  hasher.init()

  const chunkSize = 8 * 1024 * 1024 // 8 MB chunks
  const total = file.size

  for (let offset = 0; offset < total; offset += chunkSize) {
    const chunk = file.slice(offset, offset + chunkSize)
    const buffer = await chunk.arrayBuffer()
    hasher.update(new Uint8Array(buffer))
    if (onProgress && total > 0) {
      onProgress(Math.min(100, Math.round(((offset + chunk.size) / total) * 100)))
    }
  }

  const binaryDigest = hasher.digest("binary")
  let binary = ""
  const len = binaryDigest.byteLength
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(binaryDigest[i]!)
  }
  return btoa(binary)
}

export async function uploadLauncherRelease(
  file: File,
  version: string,
  notes?: string,
  onProgress?: (progress: LauncherUploadProgress) => void,
): Promise<LauncherReleaseItem> {
  const cleanVersion = version.trim()
  const cleanFilename = file.name.trim()

  if (!cleanFilename.toLowerCase().endsWith(".exe")) {
    throw new Error("El archivo debe ser un instalador ejecutable de Windows (.exe).")
  }

  if (file.size === 0) {
    throw new Error("El archivo seleccionado está vacío.")
  }

  // 1. Calculate SHA-512 incrementally
  onProgress?.({
    phase: "hashing",
    percentage: 0,
    message: "Calculando verificación SHA-512...",
  })

  const sha512 = await calculateFileSha512Base64(file, (pct) => {
    onProgress?.({
      phase: "hashing",
      percentage: pct,
      message: `Calculando verificación SHA-512 (${pct}%)...`,
    })
  })

  // 2. Request upload ticket from backend
  onProgress?.({
    phase: "requesting_ticket",
    percentage: 100,
    message: "Solicitando autorización de subida...",
  })

  const ticket = await graphqlClient.requestLauncherReleaseUploadTicket({
    version: cleanVersion,
    filename: cleanFilename,
    declaredSizeBytes: file.size,
    sha512,
  })

  // 3. Direct multipart upload to Cloudflare R2
  onProgress?.({
    phase: "uploading",
    percentage: 0,
    message: "Transfiriendo instalador a R2...",
  })

  await uploadFileToR2Multipart(file, {
    endpoint: ticket.endpoint,
    credentials: ticket.credentials,
    bucket: ticket.bucketName,
    objectKey: ticket.objectKey,
    contentType: "application/octet-stream",
  })

  // 4. Complete and verify in backend
  onProgress?.({
    phase: "completing",
    percentage: 100,
    message: "Verificando release en el servidor...",
  })

  const release = await graphqlClient.completeLauncherReleaseUpload({
    uploadToken: ticket.uploadToken,
    notes: notes?.trim() || null,
  })

  return release
}
