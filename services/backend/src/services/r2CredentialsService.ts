import * as jose from "jose"
import { createGraphQLError } from "@hikat/graphql"
import type { Env } from "../types"

export interface R2TemporaryCredentials {
  accessKeyId: string
  secretAccessKey: string
  sessionToken: string
}

export interface GenerateR2TemporaryCredentialsParams {
  env?: Env
  objectKey?: string
  prefixPath?: string
  ttlSeconds?: number
}

/**
 * Generates temporary R2 scoped credentials locally following Cloudflare's official specification:
 * - JWT HS256 signed with R2_PARENT_SECRET_ACCESS_KEY
 * - Claims: bucket, scope: "object-read-write", paths: { prefixPaths: [...], objectPaths: [...] }
 * - audience: host only (e.g. "<accountId>.r2.cloudflarestorage.com")
 * - secretAccessKey = SHA256 hex digest of the signed JWT
 * - sessionToken = base64("jwt/" + signedJwt)
 * - accessKeyId = R2_PARENT_ACCESS_KEY_ID
 */
export async function generateR2TemporaryCredentials(
  params: GenerateR2TemporaryCredentialsParams,
): Promise<R2TemporaryCredentials> {
  const accountId = params.env?.CLOUDFLARE_ACCOUNT_ID
  const parentAccessKeyId = params.env?.R2_PARENT_ACCESS_KEY_ID
  const parentSecretAccessKey = params.env?.R2_PARENT_SECRET_ACCESS_KEY
  const bucketName = params.env?.R2_BUCKET_NAME || "hikat-r2"
  const ttlSeconds = params.ttlSeconds ?? 21600 // 6 hours

  if (!accountId || !parentAccessKeyId || !parentSecretAccessKey) {
    throw createGraphQLError(
      "Configuración o credenciales temporales R2 no disponibles.",
      "INTERNAL_ERROR",
    )
  }

  if (!params.objectKey && !params.prefixPath) {
    throw createGraphQLError(
      "Se requiere al menos un objectKey o un prefixPath para generar credenciales R2 temporales.",
      "VALIDATION_ERROR",
    )
  }

  // Audience must be the host of the R2 endpoint without "https://"
  const audienceHost = `${accountId}.r2.cloudflarestorage.com`
  const secretBytes = new TextEncoder().encode(parentSecretAccessKey)

  const prefixPaths = params.prefixPath ? [params.prefixPath] : []
  const objectPaths = params.objectKey ? [params.objectKey] : []

  const signedJwt = await new jose.SignJWT({
    bucket: bucketName,
    scope: "object-read-write",
    paths: {
      prefixPaths,
      objectPaths,
    },
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(parentAccessKeyId)
    .setSubject(accountId)
    .setAudience(audienceHost)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .sign(secretBytes)

  // secretAccessKey = SHA-256 hexadecimal of the signed JWT
  const jwtBytes = new TextEncoder().encode(signedJwt)
  const digestBuffer = await crypto.subtle.digest("SHA-256", jwtBytes)
  const secretAccessKey = Array.from(new Uint8Array(digestBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")

  // sessionToken = base64("jwt/" + signedJwt)
  const sessionToken = btoa(`jwt/${signedJwt}`)

  return {
    accessKeyId: parentAccessKeyId,
    secretAccessKey,
    sessionToken,
  }
}
