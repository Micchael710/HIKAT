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

  // 3. Configure S3 client with temporary scoped R2 credentials
  const client = new S3Client({
    region: "auto",
    endpoint: ticket.endpoint,
    credentials: ticket.credentials,
  })

  // 4. Perform direct multipart upload to R2
  const upload = new Upload({
    client,
    params: {
      Bucket: ticket.bucket,
      Key: ticket.objectKey,
      Body: file,
      ContentLength: file.size,
      ContentType: file.type || "application/octet-stream",
    },
    leavePartsOnError: false,
  })

  await upload.done()

  return {
    sha256,
    sizeBytes: file.size,
  }
}
