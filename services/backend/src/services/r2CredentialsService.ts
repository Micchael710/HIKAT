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
  objectKey: string
  ttlSeconds?: number
}

/**
 * Generates temporary R2 scoped credentials locally using parent S3 credentials and JWT HS256.
 * Restricted strictly to the requested objectKey with object-read-write scope and 6-hour TTL.
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

  const endpointHost = `https://${accountId}.r2.cloudflarestorage.com`
  const secretBytes = new TextEncoder().encode(parentSecretAccessKey)

  const sessionToken = await new jose.SignJWT({
    bucket: bucketName,
    scope: "object-read-write",
    permission: "object-read-write",
    objects: [params.objectKey],
    objectKey: params.objectKey,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(parentAccessKeyId)
    .setSubject(accountId)
    .setAudience(endpointHost)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .sign(secretBytes)

  return {
    accessKeyId: parentAccessKeyId,
    secretAccessKey: "temporary-access-key",
    sessionToken,
  }
}
