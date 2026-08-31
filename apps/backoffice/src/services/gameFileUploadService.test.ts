import { describe, it, expect, vi } from "vitest"
import { calculateFileSha256, uploadGameFileDirect } from "./gameFileUploadService"

vi.mock("@aws-sdk/lib-storage", () => {
  return {
    Upload: vi.fn().mockImplementation(() => ({
      done: vi.fn().mockResolvedValue({}),
    })),
  }
})

describe("gameFileUploadService", () => {
  it("calculates incremental SHA-256 in chunks using hash-wasm", async () => {
    // Create a mock file
    const content = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x01, 0x02, 0x03, 0x04])
    const file = new File([content], "test.jar", { type: "application/java-archive" })

    const sha = await calculateFileSha256(file)
    expect(sha).toMatch(/^[a-f0-9]{64}$/)
  })

  it("validates header bytes for MOD (.jar) and rejects non-zip magic bytes", async () => {
    const invalidContent = new Uint8Array([0x00, 0x00, 0x00, 0x00])
    const file = new File([invalidContent], "invalid.jar", { type: "application/java-archive" })

    const ticket: any = {
      expectedCategory: "MOD",
      endpoint: "https://r2.test",
      bucket: "hikat-r2",
      objectKey: "game-files/1",
      credentials: { accessKeyId: "k", secretAccessKey: "s", sessionToken: "t" },
    }

    await expect(uploadGameFileDirect(file, ticket)).rejects.toThrow(
      "El archivo no es un archivo .jar o .zip válido.",
    )
  })

  it("allows GENERAL category without zip magic byte enforcement", async () => {
    const textContent = new Uint8Array([0x68, 0x65, 0x6c, 0x6c, 0x6f]) // "hello"
    const file = new File([textContent], "notes.txt", { type: "text/plain" })

    const ticket: any = {
      expectedCategory: "GENERAL",
      endpoint: "https://r2.test",
      bucket: "hikat-r2",
      objectKey: "game-files/2",
      credentials: { accessKeyId: "k", secretAccessKey: "s", sessionToken: "t" },
    }

    const result = await uploadGameFileDirect(file, ticket)
    expect(result.sizeBytes).toBe(5)
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/)
  })
})
