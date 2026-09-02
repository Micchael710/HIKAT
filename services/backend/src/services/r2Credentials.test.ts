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

  it("1. Generates valid temporary credentials signed with HS256", async () => {
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

    // Verify JWT integrity and claims using parent secret
    const secretBytes = new TextEncoder().encode(mockEnv.R2_PARENT_SECRET_ACCESS_KEY)
    const { payload } = await jose.jwtVerify(credentials.sessionToken, secretBytes, {
      issuer: mockEnv.R2_PARENT_ACCESS_KEY_ID,
      subject: mockEnv.CLOUDFLARE_ACCOUNT_ID,
      audience: `https://${mockEnv.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    })

    expect(payload.bucket).toBe(mockEnv.R2_BUCKET_NAME)
    expect(payload.scope).toBe("object-read-write")
    expect(payload.objects).toEqual([objectKey])
    expect(payload.objectKey).toBe(objectKey)

    // Verify 6-hour expiration
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

    const secretBytes = new TextEncoder().encode(mockEnv.R2_PARENT_SECRET_ACCESS_KEY)
    const verifiedA = await jose.jwtVerify(credsA.sessionToken, secretBytes)
    const verifiedB = await jose.jwtVerify(credsB.sessionToken, secretBytes)

    expect(verifiedA.payload.objects).toEqual([objectKeyA])
    expect(verifiedB.payload.objects).toEqual([objectKeyB])
    expect(credsA.sessionToken).not.toBe(credsB.sessionToken)
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
