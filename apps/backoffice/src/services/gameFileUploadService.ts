import { S3Client } from "@aws-sdk/client-s3"
import { Upload } from "@aws-sdk/lib-storage"
import { createSHA256 } from "hash-wasm"
import { validateGameFileHeader, type GameFileCategory } from "@hikat/shared"
import type { GameFileUploadPayloadGql } from "@hikat/graphql"

/**
 * Computes the SHA-256 hex digest of a File incrementally using hash-wasm
 * in 8 MB chunks, avoiding loading large multi-gigabyte files into RAM.
 */
export async function calculateFileSha256(file: File): Promise<string> {
  const hasher = await createSHA256()
  hasher.init()

  const chunkSize = 8 * 1024 * 1024 // 8 MB chunks

  for (let offset = 0; offset < file.size; offset += chunkSize) {
    const chunk = file.slice(offset, offset + chunkSize)
    const buffer = await chunk.arrayBuffer()
    hasher.update(new Uint8Array(buffer))
  }

  return hasher.digest("hex")
}

export const MULTIPART_PART_SIZE = 10 * 1024 * 1024 // 10 MiB

export interface DirectR2UploadTarget {
  endpoint: string
  credentials: {
    accessKeyId: string
    secretAccessKey: string
    sessionToken: string
  }
  bucket: string
  objectKey: string
  contentType?: string
}

/**
 * Performs a direct multipart upload from the browser to Cloudflare R2 using AWS S3 SDK.
 * Handles File/Blob streams without reading the full file into memory.
 */
export async function uploadFileToR2Multipart(
  file: File | Blob,
  target: DirectR2UploadTarget,
): Promise<void> {
  const client = new S3Client({
    region: "auto",
    endpoint: target.endpoint,
    credentials: target.credentials,
  })

  const upload = new Upload({
    client,
    params: {
      Bucket: target.bucket,
      Key: target.objectKey,
      Body: file,
      ContentLength: file.size,
      ContentType: target.contentType || ("type" in file && file.type ? file.type : "application/octet-stream"),
    },
    partSize: MULTIPART_PART_SIZE,
    queueSize: 4,
    leavePartsOnError: false,
  })

  await upload.done()
}

/**
 * Uploads a game file directly from the browser to Cloudflare R2 using AWS S3 multipart,
 * calculates SHA-256 incrementally, and returns { sha256, sizeBytes }.
 */
export async function uploadGameFileDirect(
  file: File,
  ticket: GameFileUploadPayloadGql,
): Promise<{ sha256: string; sizeBytes: number }> {
  const category = ticket.expectedCategory as GameFileCategory

  // 1. Validate magic bytes / header for category before starting upload
  if (
    category === "MOD" ||
    category === "DATA_PACK" ||
    category === "RESOURCE_PACK" ||
    category === "SHADER_PACK"
  ) {
    const headerSlice = file.slice(0, 4)
    const headerBuffer = await headerSlice.arrayBuffer()
    const validation = validateGameFileHeader(new Uint8Array(headerBuffer), file.name, category)
    if (!validation.valid) {
      throw new Error(validation.error || "Formato de archivo inválido.")
    }
  }

  // 2. Compute incremental SHA-256 hash
  const sha256 = await calculateFileSha256(file)

  // 3. Perform direct multipart upload to R2
  await uploadFileToR2Multipart(file, {
    endpoint: ticket.endpoint,
    credentials: ticket.credentials,
    bucket: ticket.bucket,
    objectKey: ticket.objectKey,
    contentType: file.type || "application/octet-stream",
  })

  return {
    sha256,
    sizeBytes: file.size,
  }
}

export interface BatchUploadFileItem {
  file: File
  uploadToken: string
  objectKey: string
  expectedCategory: GameFileCategory
  name: string
  logicalPath?: string | null
  explicitPolicy?: import("@hikat/graphql").SyncPolicyGql | null
}

export interface BatchUploadProgress {
  completed: number
  total: number
  currentFilename: string
}

/**
 * Uploads a batch of game files with a strict concurrency limit of 2 files simultaneously.
 * Each file uses up to 4 multipart parts of 10 MiB concurrently without loading full files in memory.
 */
export async function uploadGameFilesBatch(
  items: BatchUploadFileItem[],
  target: {
    endpoint: string
    credentials: {
      accessKeyId: string
      secretAccessKey: string
      sessionToken: string
    }
    bucket: string
  },
  onProgress?: (progress: BatchUploadProgress) => void,
  concurrencyLimit = 2,
): Promise<Array<{
  uploadToken: string
  sha256: string
  sizeBytes: number
  name: string
  logicalPath?: string | null
  category?: GameFileCategory | null
  explicitPolicy?: import("@hikat/graphql").SyncPolicyGql | null
}>> {
  const results: Array<{
    uploadToken: string
    sha256: string
    sizeBytes: number
    name: string
    logicalPath?: string | null
    category?: GameFileCategory | null
    explicitPolicy?: import("@hikat/graphql").SyncPolicyGql | null
  }> = new Array(items.length)

  let completedCount = 0
  let nextIndex = 0

  async function worker() {
    while (nextIndex < items.length) {
      const idx = nextIndex++
      const item = items[idx]

      onProgress?.({
        completed: completedCount,
        total: items.length,
        currentFilename: item.file.name,
      })

      // 1. Validate magic bytes / header for category
      const category = item.expectedCategory
      if (
        category === "MOD" ||
        category === "DATA_PACK" ||
        category === "RESOURCE_PACK" ||
        category === "SHADER_PACK"
      ) {
        const headerSlice = item.file.slice(0, 4)
        const headerBuffer = await headerSlice.arrayBuffer()
        const validation = validateGameFileHeader(new Uint8Array(headerBuffer), item.file.name, category)
        if (!validation.valid) {
          throw new Error(validation.error || `Formato de archivo inválido en "${item.file.name}".`)
        }
      }

      // 2. Incremental SHA-256
      const sha256 = await calculateFileSha256(item.file)

      // 3. Direct multipart upload
      await uploadFileToR2Multipart(item.file, {
        endpoint: target.endpoint,
        credentials: target.credentials,
        bucket: target.bucket,
        objectKey: item.objectKey,
        contentType: item.file.type || "application/octet-stream",
      })

      completedCount++
      onProgress?.({
        completed: completedCount,
        total: items.length,
        currentFilename: item.file.name,
      })

      results[idx] = {
        uploadToken: item.uploadToken,
        sha256,
        sizeBytes: item.file.size,
        name: item.name,
        logicalPath: item.logicalPath,
        category: item.expectedCategory,
        explicitPolicy: item.explicitPolicy,
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrencyLimit, items.length) },
    () => worker(),
  )
  await Promise.all(workers)

  return results
}
