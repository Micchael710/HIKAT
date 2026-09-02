import { describe, it, expect } from "vitest"
import * as jose from "jose"
import { generateR2TemporaryCredentials } from "./r2CredentialsService"
import type { Env } from "../types"

describe("R2 Temporary Credentials Local Generation Service", () => {
  const mockEnv: Env = {
    CLOUDFLARE_ACCOUNT_ID: "test-account-id-12345",
    R2_PARENT_ACCESS_KEY_ID: "test-parent-access-key-id",
    R2_PARENT_SECRET_ACCESS_KEY: "test-parent-secret-access-key-secret-bytes",
    R2_BUCKET_NAME: "test-hikat-bucket",
  }

  it("1. Generates valid temporary credentials matching official Cloudflare R2 specification", async () => {
    const objectKey = "content/media/example-object-key.png"
    const credentials = await generateR2TemporaryCredentials({
      env: mockEnv,
      objectKey,
    })

    expect(credentials).toBeDefined()
    expect(credentials.accessKeyId).toBe(mockEnv.R2_PARENT_ACCESS_KEY_ID)
    expect(credentials.secretAccessKey).toBeDefined()
    // Rule: Parent secret access key is NEVER leaked to the client
    expect(credentials.secretAccessKey).not.toBe(mockEnv.R2_PARENT_SECRET_ACCESS_KEY)
    expect(credentials.sessionToken).toBeDefined()

    // 1. Decode sessionToken from base64 and verify "jwt/" prefix
    const decodedSessionToken = atob(credentials.sessionToken)
    expect(decodedSessionToken.startsWith("jwt/")).toBe(true)

    const rawJwt = decodedSessionToken.slice("jwt/".length)

    // 2. Verify secretAccessKey is SHA-256 hexadecimal of the raw signed JWT
    const jwtBytes = new TextEncoder().encode(rawJwt)
    const digestBuffer = await crypto.subtle.digest("SHA-256", jwtBytes)
    const expectedSecret = Array.from(new Uint8Array(digestBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
    expect(credentials.secretAccessKey).toBe(expectedSecret)

    // 3. Verify JWT signature & claims using parent secret
    const secretBytes = new TextEncoder().encode(mockEnv.R2_PARENT_SECRET_ACCESS_KEY)
    const { payload } = await jose.jwtVerify(rawJwt, secretBytes, {
      issuer: mockEnv.R2_PARENT_ACCESS_KEY_ID,
      subject: mockEnv.CLOUDFLARE_ACCOUNT_ID,
      audience: `${mockEnv.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    })

    expect(payload.aud).toBe(`${mockEnv.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`)
    expect(payload.bucket).toBe(mockEnv.R2_BUCKET_NAME)
    expect(payload.scope).toBe("object-read-write")
    expect((payload.paths as any)?.objectPaths).toEqual([objectKey])
    expect((payload.paths as any)?.prefixPaths).toEqual([])

    // 4. Verify ~6-hour expiration (21600 seconds)
    const nowSec = Math.floor(Date.now() / 1000)
    expect(payload.exp).toBeDefined()
    expect(payload.exp!).toBeGreaterThanOrEqual(nowSec + 21500)
    expect(payload.exp!).toBeLessThanOrEqual(nowSec + 21700)
  })

  it("2. Scope is restricted strictly to the requested objectKey", async () => {
    const objectKeyA = "game-files/uuid-aaa.jar"
    const objectKeyB = "content/media/uuid-bbb.mp4"

    const credsA = await generateR2TemporaryCredentials({
      env: mockEnv,
      objectKey: objectKeyA,
    })
    const credsB = await generateR2TemporaryCredentials({
      env: mockEnv,
      objectKey: objectKeyB,
    })

    const rawJwtA = atob(credsA.sessionToken).slice("jwt/".length)
    const rawJwtB = atob(credsB.sessionToken).slice("jwt/".length)

    const secretBytes = new TextEncoder().encode(mockEnv.R2_PARENT_SECRET_ACCESS_KEY)
    const verifiedA = await jose.jwtVerify(rawJwtA, secretBytes)
    const verifiedB = await jose.jwtVerify(rawJwtB, secretBytes)

    expect((verifiedA.payload.paths as any)?.objectPaths).toEqual([objectKeyA])
    expect((verifiedB.payload.paths as any)?.objectPaths).toEqual([objectKeyB])
    expect(credsA.sessionToken).not.toBe(credsB.sessionToken)
    expect(credsA.secretAccessKey).not.toBe(credsB.secretAccessKey)
  })

  it("3. Fail-closed: throws INTERNAL_ERROR when any credential component is missing", async () => {
    const objectKey = "game-files/test.jar"

    // Missing CLOUDFLARE_ACCOUNT_ID
    await expect(
      generateR2TemporaryCredentials({
        env: {
          ...mockEnv,
          CLOUDFLARE_ACCOUNT_ID: undefined,
        },
        objectKey,
      }),
    ).rejects.toThrow("Configuración o credenciales temporales R2 no disponibles.")

    // Missing R2_PARENT_ACCESS_KEY_ID
    await expect(
      generateR2TemporaryCredentials({
        env: {
          ...mockEnv,
          R2_PARENT_ACCESS_KEY_ID: undefined,
        },
        objectKey,
      }),
    ).rejects.toThrow("Configuración o credenciales temporales R2 no disponibles.")

    // Missing R2_PARENT_SECRET_ACCESS_KEY
    await expect(
      generateR2TemporaryCredentials({
        env: {
          ...mockEnv,
          R2_PARENT_SECRET_ACCESS_KEY: undefined,
        },
        objectKey,
      }),
    ).rejects.toThrow("Configuración o credenciales temporales R2 no disponibles.")
  })
})
