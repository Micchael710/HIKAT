import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { createDatabase, schema } from "@hikat/database"
import { createTestD1 } from "@hikat/database/testUtils"
import { eq } from "drizzle-orm"
import type { Env } from "../../types"
import { ModrinthAdapter } from "./modrinthAdapter"
import { CurseForgeAdapter } from "./curseforgeAdapter"
import { ModProviderManager, getLogicalPathForContent } from "./modProviderManager"
import { installModPlan } from "./modInstallationService"
import { prepareGameDraft, getPublishedModpack, publishGameRelease } from "../game/releaseService"
import { addGameFile } from "../game/gameFileService"
import { validateGameFileBuffer } from "@hikat/shared"

// Mock global fetch for provider API calls and binary downloads
const mockFetch = vi.fn()
globalThis.fetch = mockFetch

const fixedLengthStreams =
  new WeakMap<object, number>()

class TestFixedLengthStream {
  readable: ReadableStream<Uint8Array>
  writable: WritableStream<Uint8Array>

  constructor(
    length: number | bigint,
  ) {
    const stream =
      new TransformStream<
        Uint8Array,
        Uint8Array
      >()

    this.readable =
      stream.readable

    this.writable =
      stream.writable

    fixedLengthStreams.set(
      this.readable,
      Number(length),
    )
  }
}

; (globalThis as any).FixedLengthStream =
  TestFixedLengthStream

function createTestR2() {
  const store =
    new Map<
      string,
      {
        body: Uint8Array
        metadata?: any
      }
    >()

  async function toUint8Array(
    value: any,
  ): Promise<Uint8Array> {
    if (value instanceof Uint8Array) {
      return value
    }

    if (value instanceof ArrayBuffer) {
      return new Uint8Array(value)
    }

    if (ArrayBuffer.isView(value)) {
      return new Uint8Array(
        value.buffer,
        value.byteOffset,
        value.byteLength,
      )
    }

    if (
      value &&
      typeof value.getReader ===
      "function"
    ) {
      const reader =
        value.getReader()

      const chunks: Uint8Array[] = []
      let total = 0

      while (true) {
        const result =
          await reader.read()

        if (result.done) {
          break
        }

        const chunk =
          result.value instanceof Uint8Array
            ? result.value
            : new Uint8Array(
              result.value,
            )

        chunks.push(chunk)
        total +=
          chunk.byteLength
      }

      const combined =
        new Uint8Array(total)

      let offset = 0

      for (const chunk of chunks) {
        combined.set(
          chunk,
          offset,
        )

        offset +=
          chunk.byteLength
      }

      return combined
    }

    if (typeof value === "string") {
      return new TextEncoder().encode(
        value,
      )
    }

    return new Uint8Array(0)
  }

  const bucket: any = {
    _store: store,

    get: vi.fn(
      async (
        key: string,
        options?: {
          range?: {
            offset?: number
            length?: number
          }
        },
      ) => {
        const item =
          store.get(key)

        if (!item) {
          return null
        }

        let body = item.body

        if (options?.range) {
          const offset =
            options.range.offset || 0

          const length =
            options.range.length ??
            body.byteLength

          body = body.slice(
            offset,
            offset + length,
          )
        }

        return {
          key,
          size: body.byteLength,

          body:
            new ReadableStream({
              start(controller) {
                controller.enqueue(body)
                controller.close()
              },
            }),

          arrayBuffer: async () =>
            body.buffer.slice(
              body.byteOffset,
              body.byteOffset +
              body.byteLength,
            ),

          customMetadata:
            item.metadata
              ?.customMetadata,
        }
      },
    ),

    put: vi.fn(
      async (
        key: string,
        value: any,
        options?: any,
      ) => {
        const body =
          await toUint8Array(value)

        if (
          value instanceof ReadableStream
        ) {
          const expectedLength =
            fixedLengthStreams.get(
              value,
            )

          if (
            expectedLength !== undefined &&
            body.byteLength !==
            expectedLength
          ) {
            throw new Error(
              `FixedLengthStream expected ${expectedLength} bytes but received ${body.byteLength}`,
            )
          }
        }

        store.set(key, {
          body,
          metadata: options,
        })

        return {
          key,
          size: body.byteLength,
        }
      },
    ),

    delete: vi.fn(
      async (
        keys: string | string[],
      ) => {
        const list =
          Array.isArray(keys)
            ? keys
            : [keys]

        for (const key of list) {
          store.delete(key)
        }
      },
    ),

    head: vi.fn(
      async (key: string) => {
        const item =
          store.get(key)

        if (!item) {
          return null
        }

        return {
          key,
          size:
            item.body.byteLength,
        }
      },
    ),

    createMultipartUpload:
      vi.fn(
        async (
          key: string,
          options?: any,
        ) => {
          const parts =
            new Map<
              number,
              Uint8Array
            >()

          let aborted = false

          return {
            key,
            uploadId:
              crypto.randomUUID(),

            uploadPart: vi.fn(
              async (
                partNumber: number,
                value: any,
              ) => {
                if (aborted) {
                  throw new Error(
                    "Multipart upload aborted",
                  )
                }
                if (
                  value instanceof ReadableStream
                ) {
                  const knownLength =
                    fixedLengthStreams.get(
                      value,
                    )

                  if (knownLength === undefined) {
                    throw new TypeError(
                      "Provided readable stream must have a known length",
                    )
                  }
                }

                const body =
                  await toUint8Array(
                    value,
                  )

                parts.set(
                  partNumber,
                  body,
                )

                return {
                  partNumber,
                  etag:
                    crypto.randomUUID(),
                }
              },
            ),

            complete: vi.fn(
              async (
                uploadedParts: Array<{
                  partNumber: number
                }>,
              ) => {
                if (aborted) {
                  throw new Error(
                    "Multipart upload aborted",
                  )
                }

                const ordered =
                  [...uploadedParts]
                    .sort(
                      (a, b) =>
                        a.partNumber -
                        b.partNumber,
                    )
                    .map(
                      (part) =>
                        parts.get(
                          part.partNumber,
                        ) ||
                        new Uint8Array(
                          0,
                        ),
                    )

                const total =
                  ordered.reduce(
                    (
                      sum,
                      part,
                    ) =>
                      sum +
                      part.byteLength,
                    0,
                  )

                const body =
                  new Uint8Array(
                    total,
                  )

                let offset = 0

                for (
                  const part of ordered
                ) {
                  body.set(
                    part,
                    offset,
                  )

                  offset +=
                    part.byteLength
                }

                store.set(key, {
                  body,
                  metadata: options,
                })

                return {
                  key,
                  size:
                    body.byteLength,
                }
              },
            ),

            abort: vi.fn(
              async () => {
                aborted = true
                parts.clear()
              },
            ),
          }
        },
      ),
  }

  return bucket
}

// Sample valid JAR / ZIP buffer with magic bytes PK\x03\x04
function createSampleJarBuffer(content: string = "dummy jar content"): Uint8Array {
  const enc = new TextEncoder().encode(content)
  const buf = new Uint8Array(4 + enc.length)
  buf[0] = 0x50 // P
  buf[1] = 0x4b // K
  buf[2] = 0x03
  buf[3] = 0x04
  buf.set(enc, 4)
  return buf
}

function createBinaryResponse(
  bytes: Uint8Array,
  status = 200,
  sizeBytes?: number,
) {
  const targetSize =
    sizeBytes && sizeBytes > bytes.byteLength
      ? sizeBytes
      : bytes.byteLength

  const copy = new Uint8Array(targetSize)
  copy.set(bytes, 0)

  return {
    ok:
      status >= 200 &&
      status < 300,

    status,

    headers:
      new Headers({
        "content-length":
          String(
            copy.byteLength,
          ),
      }),

    body:
      new ReadableStream<
        Uint8Array
      >({
        start(controller) {
          controller.enqueue(copy)
          controller.close()
        },
      }),

    arrayBuffer: async () =>
      copy.buffer.slice(
        copy.byteOffset,
        copy.byteOffset +
        copy.byteLength,
      ),
  }
}

describe("Shard 8B — Content Providers & Dependency Resolution Suite", () => {
  let testD1: ReturnType<typeof createTestD1>
  let db: ReturnType<typeof createDatabase>
  let env: Env
  let r2: ReturnType<typeof createTestR2>
  let manager: ModProviderManager
  const adminUserId = "admin-test-8b"

  beforeEach(async () => {
    testD1 = createTestD1()
    db = createDatabase(testD1)
    r2 = createTestR2()
    env = {
      ENVIRONMENT: "test",
      CURSEFORGE_API_KEY: "test-curseforge-api-key-12345",
      ASSETS: r2 as any,
      DB: testD1 as any,
    }
    manager = new ModProviderManager()

    const now = new Date().toISOString()
    await db.insert(schema.users).values({
      id: adminUserId,
      displayName: "Admin User",
      role: "ADMIN",
      createdAt: now,
      updatedAt: now,
    })

    mockFetch.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe("1. Modrinth Adapter Multi-Content, Multi-Type Projects & Hashes", () => {
    it("searches Modrinth with automatic Minecraft 1.21.1 and NeoForge filters for MOD", async () => {
      const adapter = new ModrinthAdapter()

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          hits: [
            {
              project_id: "LNytGWDc",
              slug: "create",
              title: "Create",
              description: "Aesthetic Technology",
              author: "simibubi",
              categories: ["technology", "neoforge"],
              downloads: 15000000,
              follows: 50000,
              icon_url: "https://cdn.modrinth.com/icon.png",
              latest_version: "6.0.6",
              project_type: "mod",
              client_side: "required",
              server_side: "required",
            },
          ],
          total_hits: 1,
        }),
      })

      const result = await adapter.searchMods(env, "create", "1.21.1", "NeoForge", 20, 0, "MOD")
      expect(result.items.length).toBe(1)
      expect(result.items[0]!.provider).toBe("MODRINTH")
      expect(result.items[0]!.projectId).toBe("LNytGWDc")
      expect(result.items[0]!.name).toBe("Create")
      expect(result.items[0]!.contentType).toBe("MOD")
      expect(result.items[0]!.environment).toBe("BOTH")

      const calledUrl = (mockFetch.mock.calls[0] as any)?.[0] as string
      expect(calledUrl).toContain("versions%3A1.21.1")
      expect(calledUrl).toContain("categories%3Aneoforge")
      expect(calledUrl).toContain("project_type%3Amod")
    })

    it("searches Modrinth for DATA_PACK using official facet all_project_types:datapack", async () => {
      const adapter = new ModrinthAdapter()

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          hits: [
            {
              project_id: "terralith-mr",
              slug: "terralith",
              title: "Terralith",
              description: "Overworld overhaul",
              author: "Stardust",
              categories: ["datapack", "worldgen"],
              all_project_types: ["datapack"],
              project_type: "mod",
              downloads: 500000,
              client_side: "unsupported",
              server_side: "required",
            },
          ],
          total_hits: 1,
        }),
      })

      const dpResult = await adapter.searchMods(env, "terralith", "1.21.1", "NeoForge", 20, 0, "DATA_PACK")
      expect(dpResult.items.length).toBe(1)
      expect(dpResult.items[0]!.contentType).toBe("DATA_PACK")
      expect(dpResult.items[0]!.environment).toBe("SERVER")

      const dpUrl = (mockFetch.mock.calls[0] as any)?.[0] as string
      expect(dpUrl).toContain("all_project_types%3Adatapack")
      expect(dpUrl).not.toContain("categories%3Adatapack")
      expect(dpUrl).not.toContain("project_type%3Adatapack")
    })

    it("handles multi-type project with all_project_types = ['mod', 'datapack'] cleanly per requested contentType", async () => {
      const adapter = new ModrinthAdapter()

      mockFetch.mockImplementation(async (url: string) => {
        const u = String(url)
        if (u.includes("/project/hybrid-proj/version")) {
          if (u.includes("loaders=%5B%22neoforge%22%5D")) {
            return {
              ok: true,
              status: 200,
              json: async () => [
                {
                  id: "ver-mod-jar",
                  name: "Hybrid Mod 1.0",
                  loaders: ["neoforge"],
                  game_versions: ["1.21.1"],
                  files: [{ filename: "hybrid-mod.jar", size: 5000, url: "https://cdn/mod.jar" }],
                  dependencies: [],
                },
              ],
            }
          }
          if (u.includes("loaders=%5B%22datapack%22%5D")) {
            return {
              ok: true,
              status: 200,
              json: async () => [
                {
                  id: "ver-dp-zip",
                  name: "Hybrid DataPack 1.0",
                  loaders: ["datapack"],
                  game_versions: ["1.21.1"],
                  files: [{ filename: "hybrid-dp.zip", size: 3000, url: "https://cdn/dp.zip" }],
                  dependencies: [],
                },
              ],
            }
          }
        }
        if (u.includes("/version/ver-mod-jar")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: "ver-mod-jar",
              project_id: "hybrid-proj",
              name: "Hybrid Mod 1.0",
              loaders: ["neoforge"],
              game_versions: ["1.21.1"],
              files: [{ filename: "hybrid-mod.jar", size: 5000, url: "https://cdn/mod.jar" }],
              dependencies: [],
            }),
          }
        }
        if (u.includes("/version/ver-dp-zip")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: "ver-dp-zip",
              project_id: "hybrid-proj",
              name: "Hybrid DataPack 1.0",
              loaders: ["datapack"],
              game_versions: ["1.21.1"],
              files: [{ filename: "hybrid-dp.zip", size: 3000, url: "https://cdn/dp.zip" }],
              dependencies: [],
            }),
          }
        }
        if (u.includes("/project/hybrid-proj")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: "hybrid-proj",
              title: "Hybrid Project",
              project_type: "mod",
              all_project_types: ["mod", "datapack"],
              categories: ["technology"],
            }),
          }
        }
        return { ok: false, status: 404 }
      })

      // Query as MOD
      const modProj = await adapter.getProject(env, "hybrid-proj", "MOD")
      expect(modProj?.contentType).toBe("MOD")
      const modVersions = await adapter.getCompatibleVersions(env, "hybrid-proj", "1.21.1", "NeoForge", "MOD")
      expect(modVersions.length).toBe(1)
      expect(modVersions[0]!.contentType).toBe("MOD")
      expect(modVersions[0]!.filename).toBe("hybrid-mod.jar")

      // Query as DATA_PACK
      const dpProj = await adapter.getProject(env, "hybrid-proj", "DATA_PACK")
      expect(dpProj?.contentType).toBe("DATA_PACK")
      const dpVersions = await adapter.getCompatibleVersions(env, "hybrid-proj", "1.21.1", "", "DATA_PACK")
      expect(dpVersions.length).toBe(1)
      expect(dpVersions[0]!.contentType).toBe("DATA_PACK")
      expect(dpVersions[0]!.filename).toBe("hybrid-dp.zip")

      // Manager integration: Requesting DATA_PACK in Game flow -> REJECT per Shard 08D
      await expect(
        manager.resolveInstallationPlan(
          env,
          db,
          { provider: "MODRINTH", projectId: "hybrid-proj", versionId: "ver-mod-jar", contentType: "DATA_PACK" },
        ),
      ).rejects.toThrow(/Los Data Packs se administran exclusivamente desde Servidor → Archivos/)

      // Manager integration: Requesting MOD with DATA_PACK versionId -> REJECT
      await expect(
        manager.resolveInstallationPlan(
          env,
          db,
          { provider: "MODRINTH", projectId: "hybrid-proj", versionId: "ver-dp-zip", contentType: "MOD" },
        ),
      ).rejects.toThrow(/no corresponde al tipo solicitado/)

      // Manager integration: Requesting MOD with MOD versionId -> ACCEPT
      const validModPlan = await manager.resolveInstallationPlan(
        env,
        db,
        { provider: "MODRINTH", projectId: "hybrid-proj", versionId: "ver-mod-jar", contentType: "MOD" },
      )
      expect(validModPlan.isValid).toBe(true)
      expect(validModPlan.items[0]!.contentType).toBe("MOD")
      expect(validModPlan.items[0]!.logicalPath).toBe("mods/hybrid-mod.jar")

      // Server integration: Requesting DATA_PACK with DATA_PACK versionId via resolveServerInstallationPlan -> ACCEPT
      const validDpPlan = await manager.resolveServerInstallationPlan(
        env,
        db,
        { provider: "MODRINTH", projectId: "hybrid-proj", versionId: "ver-dp-zip", contentType: "DATA_PACK" },
      )
      expect(validDpPlan.isValid).toBe(true)
      expect(validDpPlan.items[0]!.contentType).toBe("DATA_PACK")
      expect(validDpPlan.items[0]!.targetPath).toBe("world/datapacks/hybrid-dp.zip")
    })

    it("parses SHA-512 and SHA-1 hashes from Modrinth without inventing SHA-256", async () => {
      const adapter = new ModrinthAdapter()

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: "ver-sha512",
          project_id: "proj-1",
          name: "Version 1.0",
          version_number: "1.0.0",
          version_type: "release",
          game_versions: ["1.21.1"],
          loaders: ["neoforge"],
          files: [
            {
              filename: "mod.jar",
              size: 2048,
              url: "https://cdn.modrinth.com/mod.jar",
              hashes: {
                sha512: "cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e",
                sha1: "2fd4e1c67a2d28fced849ee1bb76e7391b93eb12",
              },
            },
          ],
          dependencies: [],
        }),
      })

      const version = await adapter.getVersion(env, "ver-sha512", "proj-1", "MOD")
      expect(version?.sha256).toBeNull()
      expect(version?.hashes?.sha512).toBe("cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e")
      expect(version?.hashes?.sha1).toBe("2fd4e1c67a2d28fced849ee1bb76e7391b93eb12")
    })
  })

  describe("2. CurseForge Adapter Multi-Content, Security & Hashes", () => {
    it("discovers CurseForge class IDs dynamically via /categories?classesOnly=true", async () => {
      const adapter = new CurseForgeAdapter()

      mockFetch.mockImplementation(async (url: string) => {
        const u = String(url)
        if (u.includes("/categories?gameId=432&classesOnly=true")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: [
                { id: 6, name: "Mods", slug: "mc-mods" },
                { id: 12, name: "Resource Packs", slug: "texture-packs" },
                { id: 6945, name: "Data Packs", slug: "data-packs" },
                { id: 6552, name: "Shaders", slug: "shaders" },
              ],
            }),
          }
        }
        if (u.includes("/mods/search")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: [{ id: 101, name: "Faithful", slug: "faithful", classId: 12 }],
              pagination: { totalCount: 1 },
            }),
          }
        }
        return { ok: false, status: 404 }
      })

      const classId = await adapter.resolveClassId(env, "RESOURCE_PACK")
      expect(classId).toBe(12)

      const result = await adapter.searchMods(env, "faithful", "1.21.1", "", 20, 0, "RESOURCE_PACK")
      expect(result.items.length).toBe(1)
      expect(result.items[0]!.projectId).toBe("101")
    })

    it("parses only algo 1 (SHA-1) and algo 2 (MD5) from CurseForge, rejecting algo 3 as SHA-256", async () => {
      const adapter = new CurseForgeAdapter()

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            id: 55555,
            fileName: "mod.jar",
            displayName: "Mod 1.0",
            downloadUrl: "https://cf.com/mod.jar",
            fileLength: 4000,
            fileDate: "2024-08-01T00:00:00Z",
            releaseType: 1,
            gameVersions: ["1.21.1", "NeoForge"],
            hashes: [
              { value: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2", algo: 1 },
              { value: "md5hash1234567890", algo: 2 },
              { value: "invalid_supposed_sha256", algo: 3 },
            ],
            dependencies: [],
          },
        }),
      })

      const version = await adapter.getVersion(env, "55555", "328085", "MOD")
      expect(version).toBeDefined()
      expect(version?.sha256).toBeNull()
      expect(version?.hashes?.sha1).toBe("a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2")
      expect(version?.hashes?.md5).toBe("md5hash1234567890")
    })

    it("fails closed on unknown CurseForge classId (does not return MOD or accept spoofing)", async () => {
      const adapter = new CurseForgeAdapter()

      mockFetch.mockImplementation(async (url: string) => {
        const u = String(url)
        if (u.includes("/mods/88888")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: {
                id: 88888,
                name: "Unknown Item",
                slug: "unknown-item",
                classId: 99999, // Unknown classId!
              },
            }),
          }
        }
        return { ok: false, status: 404 }
      })

      const supported = await adapter.getSupportedContentTypes(env, "88888")
      expect(supported).toEqual([])

      const project = await adapter.getProject(env, "88888", "MOD")
      expect(project).toBeNull()

      // Manager integration: Attempting to get project detail or resolve plan fails
      await expect(
        manager.getProjectDetail(env, db, "CURSEFORGE", "88888", "MOD"),
      ).rejects.toThrow()
    })

    it("flags conflict when a required dependency has an unknown CurseForge classId", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        const u = String(url)
        if (u.includes("/mods/328085/files")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: [
                {
                  id: 1111,
                  fileName: "root.jar",
                  gameVersions: ["1.21.1", "NeoForge"],
                  dependencies: [{ modId: 999999, relationType: 3 }], // Required dep with unknown modId
                },
              ],
            }),
          }
        }
        if (u.includes("/mods/328085")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ data: { id: 328085, name: "Root Mod", classId: 6 } }),
          }
        }
        if (u.includes("/mods/999999")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ data: { id: 999999, name: "Unknown Class Dep", classId: 88888 } }), // Unknown classId
          }
        }
        return { ok: false, status: 404 }
      })

      const plan = await manager.resolveInstallationPlan(
        env,
        db,
        { provider: "CURSEFORGE", projectId: "328085", versionId: "1111", contentType: "MOD", environmentOverride: "CLIENT" },
      )

      expect(plan.isValid).toBe(false)
      expect(plan.conflicts.length).toBe(1)
      expect(plan.conflicts[0]).toContain("tipo de contenido desconocido")
    })

    it("ensures CurseForge API key is NEVER sent to external binary CDN download URLs", async () => {
      mockFetch.mockImplementation(async (url: string, opts?: any) => {
        const u = String(url)
        if (u.includes("api.curseforge.com/v1/mods/328085/files/99999")) {
          // Metadata request: MUST have x-api-key
          expect(opts?.headers?.["x-api-key"]).toBe("test-curseforge-api-key-12345")
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: {
                id: 99999,
                fileName: "secure.jar",
                downloadUrl: "https://cdn.external-forge-cdn.net/files/secure.jar",
                gameVersions: ["1.21.1", "NeoForge"],
                hashes: [],
                dependencies: [],
              },
            }),
          }
        }
        if (u.includes("api.curseforge.com/v1/mods/328085/files")) {
          expect(opts?.headers?.["x-api-key"]).toBe("test-curseforge-api-key-12345")
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: [
                {
                  id: 99999,
                  fileName: "secure.jar",
                  downloadUrl: "https://cdn.external-forge-cdn.net/files/secure.jar",
                  gameVersions: ["1.21.1", "NeoForge"],
                  hashes: [],
                  dependencies: [],
                },
              ],
            }),
          }
        }
        if (u.includes("api.curseforge.com/v1/mods/328085")) {
          expect(opts?.headers?.["x-api-key"]).toBe("test-curseforge-api-key-12345")
          return {
            ok: true,
            status: 200,
            json: async () => ({ data: { id: 328085, name: "Secure Mod", classId: 6 } }),
          }
        }
        if (u.includes("https://cdn.external-forge-cdn.net/files/secure.jar")) {
          // Binary download request: MUST NOT contain x-api-key!
          expect(opts?.headers?.["x-api-key"]).toBeUndefined()
          return createBinaryResponse(
            createSampleJarBuffer(
              "secure binary",
            ),
          )
        }
        return { ok: false, status: 404 }
      })

      const result = await installModPlan(
        db,
        env,
        { provider: "CURSEFORGE", projectId: "328085", versionId: "99999", environmentOverride: "CLIENT" },
        adminUserId,
      )

      expect(result.length).toBe(1)
      expect(result[0]!.name).toBe("secure.jar")
      expect(r2.createMultipartUpload).toHaveBeenCalled()
      expect(r2.put).not.toHaveBeenCalled()
      expect(r2._store.size).toBe(1)
    })
  })

  describe("3. Strict Fail-Closed Compatibility & Dependency Rules", () => {
    it("rejects contentType spoofing when project does not match requested content type", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        const u = String(url)
        if (u.includes("/project/mod-create")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: "mod-create",
              slug: "create",
              title: "Create",
              project_type: "mod",
              categories: ["technology"],
            }),
          }
        }
        return { ok: false, status: 404 }
      })

      await expect(
        manager.getProjectDetail(env, db, "MODRINTH", "mod-create", "DATA_PACK"),
      ).rejects.toThrow(/no es compatible con el tipo solicitado|no corresponde al tipo solicitado/)
    })

    it("rejects root version if it does not support the draft's Minecraft version", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        const u = String(url)
        if (u.includes("/project/mod-x/version")) {
          return { ok: true, status: 200, json: async () => [] } // None compatible
        }
        if (u.includes("/version/ver-incompat-mc")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: "ver-incompat-mc",
              project_id: "mod-x",
              name: "Old Mod",
              version_number: "0.1.0",
              version_type: "release",
              game_versions: ["1.20.1"],
              loaders: ["neoforge"],
              files: [{ filename: "old.jar", size: 1000, url: "https://cdn/old.jar" }],
              dependencies: [],
            }),
          }
        }
        if (u.includes("/project/mod-x")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ id: "mod-x", title: "Old Mod", project_type: "mod", categories: [] }),
          }
        }
        return { ok: false, status: 404 }
      })

      await expect(
        manager.resolveInstallationPlan(
          env,
          db,
          { provider: "MODRINTH", projectId: "mod-x", versionId: "ver-incompat-mc" },
        ),
      ).rejects.toThrow(/no es compatible con Minecraft 1.21.1/)
    })

    it("fails closed when loaders is empty (loaders=[]) or unknown for contentType=MOD", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        const u = String(url)
        if (u.includes("/project/mod-no-loader/version")) {
          return { ok: true, status: 200, json: async () => [] }
        }
        if (u.includes("/version/ver-no-loaders")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: "ver-no-loaders",
              project_id: "mod-no-loader",
              name: "No Loader Mod",
              game_versions: ["1.21.1"],
              loaders: [],
              files: [{ filename: "mod.jar", size: 1000, url: "https://cdn/mod.jar" }],
              dependencies: [],
            }),
          }
        }
        if (u.includes("/project/mod-no-loader")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ id: "mod-no-loader", title: "No Loader Mod", project_type: "mod", categories: [] }),
          }
        }
        return { ok: false, status: 404 }
      })

      await expect(
        manager.resolveInstallationPlan(
          env,
          db,
          { provider: "MODRINTH", projectId: "mod-no-loader", versionId: "ver-no-loaders" },
        ),
      ).rejects.toThrow(/no es compatible con el loader NeoForge/)
    })

    it("fails closed when loader is Fabric for contentType=MOD", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        const u = String(url)
        if (u.includes("/project/mod-fabric/version")) {
          return { ok: true, status: 200, json: async () => [] }
        }
        if (u.includes("/version/ver-fabric-only")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: "ver-fabric-only",
              project_id: "mod-fabric",
              name: "Fabric Mod",
              game_versions: ["1.21.1"],
              loaders: ["fabric"],
              files: [{ filename: "mod.jar", size: 1000, url: "https://cdn/mod.jar" }],
              dependencies: [],
            }),
          }
        }
        if (u.includes("/project/mod-fabric")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ id: "mod-fabric", title: "Fabric Mod", project_type: "mod", categories: [] }),
          }
        }
        return { ok: false, status: 404 }
      })

      await expect(
        manager.resolveInstallationPlan(
          env,
          db,
          { provider: "MODRINTH", projectId: "mod-fabric", versionId: "ver-fabric-only" },
        ),
      ).rejects.toThrow(/no es compatible con el loader NeoForge/)
    })

    it("resolves project with 0 dependencies cleanly into a single valid item", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        const u = String(url)
        if (u.includes("/project/zero-dep-proj/version")) {
          return {
            ok: true,
            status: 200,
            json: async () => [
              {
                id: "ver-zero-dep",
                name: "Solo Mod",
                version_number: "1.0.0",
                game_versions: ["1.21.1"],
                loaders: ["neoforge"],
                files: [{ filename: "solo.jar", size: 1000, url: "https://cdn/solo.jar" }],
                dependencies: [],
              },
            ],
          }
        }
        if (u.includes("/project/zero-dep-proj")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ id: "zero-dep-proj", title: "Solo Mod", project_type: "mod", categories: [] }),
          }
        }
        return { ok: false, status: 404 }
      })

      const plan = await manager.resolveInstallationPlan(
        env,
        db,
        { provider: "MODRINTH", projectId: "zero-dep-proj", versionId: "ver-zero-dep" },
      )

      expect(plan.isValid).toBe(true)
      expect(plan.items.length).toBe(1)
      expect(plan.optionalDependencies.length).toBe(0)
    })

    it("treats OPTIONAL dependencies as non-auto-installed", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        const u = String(url)
        if (u.includes("/project/opt-root-proj/version")) {
          return {
            ok: true,
            status: 200,
            json: async () => [
              {
                id: "ver-opt-root",
                name: "Opt Root",
                version_number: "1.0.0",
                game_versions: ["1.21.1"],
                loaders: ["neoforge"],
                files: [{ filename: "opt-root.jar", size: 1000, url: "https://cdn/opt-root.jar" }],
                dependencies: [{ project_id: "opt-dep", dependency_type: "optional" }],
              },
            ],
          }
        }
        if (u.includes("/project/opt-root-proj")) {
          return { ok: true, status: 200, json: async () => ({ id: "opt-root-proj", title: "Opt Root", project_type: "mod", categories: [] }) }
        }
        if (u.includes("/project/opt-dep")) {
          return { ok: true, status: 200, json: async () => ({ id: "opt-dep", title: "Opt Dep", project_type: "mod", categories: [] }) }
        }
        return { ok: false, status: 404 }
      })

      const plan = await manager.resolveInstallationPlan(
        env,
        db,
        { provider: "MODRINTH", projectId: "opt-root-proj", versionId: "ver-opt-root" },
      )

      expect(plan.isValid).toBe(true)
      expect(plan.items.length).toBe(1)
      expect(plan.optionalDependencies.length).toBe(1)
      expect(plan.optionalDependencies[0]!.projectId).toBe("opt-dep")
    })

    it("flags INCOMPATIBLE dependency as a conflict when the incompatible mod is installed in DRAFT", async () => {
      const draft = await prepareGameDraft(db, adminUserId)
      await db.insert(schema.gameReleaseFiles).values({
        id: crypto.randomUUID(),
        releaseId: draft.id,
        name: "bad-mod.jar",
        logicalPath: "mods/bad-mod.jar",
        category: "MOD",
        sha256: "sha256badmod",
        sizeBytes: 1000,
        isDirectory: 0,
        sourceProvider: "MODRINTH",
        sourceProjectId: "bad-mod",
        sourceVersionId: "ver-bad-1",
        createdAt: new Date().toISOString(),
      })

      mockFetch.mockImplementation(async (url: string) => {
        const u = String(url)
        if (u.includes("/project/incomp-root-proj/version")) {
          return {
            ok: true,
            status: 200,
            json: async () => [
              {
                id: "ver-incomp-root",
                name: "Incomp Root",
                version_number: "1.0.0",
                game_versions: ["1.21.1"],
                loaders: ["neoforge"],
                files: [{ filename: "incomp-root.jar", size: 1000, url: "https://cdn/incomp-root.jar" }],
                dependencies: [{ project_id: "bad-mod", dependency_type: "incompatible" }],
              },
            ],
          }
        }
        if (u.includes("/project/incomp-root-proj")) {
          return { ok: true, status: 200, json: async () => ({ id: "incomp-root-proj", title: "Incomp Root", project_type: "mod", categories: [] }) }
        }
        return { ok: false, status: 404 }
      })

      const plan = await manager.resolveInstallationPlan(
        env,
        db,
        { provider: "MODRINTH", projectId: "incomp-root-proj", versionId: "ver-incomp-root" },
      )

      expect(plan.isValid).toBe(false)
      expect(plan.conflicts.length).toBe(1)
      expect(plan.conflicts[0]).toContain("declara incompatibilidad")
    })

    it("enforces pinned dependencies and flags conflict if pinned version is incompatible without fallback", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        const u = String(url)
        if (u.includes("/project/root-proj/version")) {
          return {
            ok: true,
            status: 200,
            json: async () => [
              {
                id: "ver-root",
                name: "Root 1.0",
                version_number: "1.0.0",
                game_versions: ["1.21.1"],
                loaders: ["neoforge"],
                files: [{ filename: "root.jar", size: 1000, url: "https://cdn/root.jar" }],
                dependencies: [{ version_id: "ver-pinned-incompat", dependency_type: "required" }],
              },
            ],
          }
        }
        if (u.includes("/project/dep-proj/version")) {
          return {
            ok: true,
            status: 200,
            json: async () => [],
          }
        }
        if (u.includes("/version/ver-pinned-incompat")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: "ver-pinned-incompat",
              project_id: "dep-proj",
              name: "Dep Old",
              version_number: "0.5.0",
              version_type: "release",
              game_versions: ["1.19.2"],
              loaders: ["neoforge"],
              files: [{ filename: "dep-old.jar", size: 500, url: "https://cdn/dep-old.jar" }],
              dependencies: [],
            }),
          }
        }
        if (u.includes("/project/root-proj")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ id: "root-proj", title: "Root Project", project_type: "mod", categories: [] }),
          }
        }
        if (u.includes("/project/dep-proj")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ id: "dep-proj", title: "Dep Project", project_type: "mod", categories: [] }),
          }
        }
        return { ok: false, status: 404 }
      })

      const plan = await manager.resolveInstallationPlan(
        env,
        db,
        { provider: "MODRINTH", projectId: "root-proj", versionId: "ver-root" },
      )

      expect(plan.isValid).toBe(false)
      expect(plan.conflicts.length).toBeGreaterThan(0)
      expect(plan.conflicts[0]).toContain("versión requerida")
    })

    it("resolves transitive dependencies, handles deduplication and skips cycles cleanly", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        const u = String(url)
        if (u.includes("/project/proj-a/version")) {
          return {
            ok: true,
            status: 200,
            json: async () => [
              {
                id: "ver-a",
                name: "A",
                game_versions: ["1.21.1"],
                loaders: ["neoforge"],
                files: [{ filename: "a.jar", size: 100, url: "https://cdn/a.jar" }],
                dependencies: [
                  { project_id: "proj-b", dependency_type: "required" },
                  { project_id: "proj-c", dependency_type: "required" },
                ],
              },
            ],
          }
        }
        if (u.includes("/project/proj-b/version")) {
          return {
            ok: true,
            status: 200,
            json: async () => [
              {
                id: "ver-b",
                name: "B",
                game_versions: ["1.21.1"],
                loaders: ["neoforge"],
                files: [{ filename: "b.jar", size: 100, url: "https://cdn/b.jar" }],
                dependencies: [{ project_id: "proj-a", dependency_type: "required" }],
              },
            ],
          }
        }
        if (u.includes("/project/proj-c/version")) {
          return {
            ok: true,
            status: 200,
            json: async () => [
              {
                id: "ver-c",
                name: "C",
                game_versions: ["1.21.1"],
                loaders: ["neoforge"],
                files: [{ filename: "c.jar", size: 100, url: "https://cdn/c.jar" }],
                dependencies: [],
              },
            ],
          }
        }
        if (u.includes("/project/proj-")) {
          const projId = u.split("/project/")[1]?.split("/")[0]?.split("?")[0] || "proj"
          return {
            ok: true,
            status: 200,
            json: async () => ({ id: projId, title: projId, project_type: "mod", categories: [] }),
          }
        }
        return { ok: false, status: 404 }
      })

      const plan = await manager.resolveInstallationPlan(
        env,
        db,
        { provider: "MODRINTH", projectId: "proj-a", versionId: "ver-a" },
      )

      expect(plan.isValid).toBe(true)
      expect(plan.items.length).toBe(3)
    })

    it("distinguishes ALREADY_INSTALLED and UPDATE accurately", async () => {
      const draft = await prepareGameDraft(db, adminUserId)

      // Insert pre-installed version 1.0 of test mod
      await db.insert(schema.gameReleaseFiles).values({
        id: "installed-file-id",
        releaseId: draft.id,
        name: "mod-1.0.jar",
        logicalPath: "mods/mod.jar",
        category: "MOD",
        sha256: "sha256-mod1",
        sizeBytes: 1000,
        sourceProvider: "MODRINTH",
        sourceProjectId: "test-mod-id",
        sourceVersionId: "ver-1.0",
        createdAt: new Date().toISOString(),
      })

      mockFetch.mockImplementation(async (url: string) => {
        const u = String(url)
        if (u.includes("/project/test-mod-id/version")) {
          return {
            ok: true,
            status: 200,
            json: async () => [
              {
                id: "ver-1.0",
                name: "Mod 1.0",
                game_versions: ["1.21.1"],
                loaders: ["neoforge"],
                files: [{ filename: "mod.jar", size: 1000, url: "https://cdn/mod.jar" }],
                dependencies: [],
              },
              {
                id: "ver-2.0",
                name: "Mod 2.0",
                game_versions: ["1.21.1"],
                loaders: ["neoforge"],
                files: [{ filename: "mod.jar", size: 1200, url: "https://cdn/mod.jar" }],
                dependencies: [],
              },
            ],
          }
        }
        if (u.includes("/project/test-mod-id")) {
          return { ok: true, status: 200, json: async () => ({ id: "test-mod-id", title: "Test Mod", project_type: "mod", categories: [] }) }
        }
        return { ok: false, status: 404 }
      })

      // Plan for ver-1.0 -> ALREADY_INSTALLED
      const planSame = await manager.resolveInstallationPlan(
        env,
        db,
        { provider: "MODRINTH", projectId: "test-mod-id", versionId: "ver-1.0" },
      )
      expect(planSame.items[0]!.action).toBe("ALREADY_INSTALLED")

      // Plan for ver-2.0 -> UPDATE
      const planNew = await manager.resolveInstallationPlan(
        env,
        db,
        { provider: "MODRINTH", projectId: "test-mod-id", versionId: "ver-2.0" },
      )
      expect(planNew.items[0]!.action).toBe("UPDATE")
      expect(planNew.items[0]!.installedFileId).toBe("installed-file-id")
    })
  })

  describe("4. Target Paths, Policies & Multi-Category Installations", () => {
    it("computes proper logical paths per content type", () => {
      expect(getLogicalPathForContent("MOD", "create.jar")).toBe("mods/create.jar")
      expect(getLogicalPathForContent("RESOURCE_PACK", "faithful.zip")).toBe("resourcepacks/faithful.zip")
      expect(getLogicalPathForContent("DATA_PACK", "terralith.zip")).toBe("datapacks/terralith.zip")
      expect(getLogicalPathForContent("SHADER", "complementary.zip")).toBe("shaderpacks/complementary.zip")
    })

    it("validates game file buffer magic bytes for DATA_PACK as strict ZIP", () => {
      const validZip = createSampleJarBuffer("data pack json content")
      const invalidZip = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04])

      expect(validateGameFileBuffer(validZip, "datapack.zip", "DATA_PACK").valid).toBe(true)
      expect(validateGameFileBuffer(invalidZip, "datapack.zip", "DATA_PACK").valid).toBe(false)
      expect(validateGameFileBuffer(validZip, "datapack.jar", "DATA_PACK").valid).toBe(false)
    })

    it("installs real root MOD + required dependency into mods/", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        const u = String(url)
        if (u.includes("/project/proj-root-mod/version")) {
          return {
            ok: true,
            status: 200,
            json: async () => [
              {
                id: "ver-root-mod",
                name: "Root Mod",
                game_versions: ["1.21.1"],
                loaders: ["neoforge"],
                files: [{ filename: "root.jar", size: 1000, url: "https://cdn/root.jar" }],
                dependencies: [{ project_id: "proj-dep-mod", dependency_type: "required" }],
              },
            ],
          }
        }
        if (u.includes("/version/ver-root-mod")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: "ver-root-mod",
              project_id: "proj-root-mod",
              name: "Root Mod",
              game_versions: ["1.21.1"],
              loaders: ["neoforge"],
              files: [{ filename: "root.jar", size: 1000, url: "https://cdn/root.jar" }],
              dependencies: [{ project_id: "proj-dep-mod", dependency_type: "required" }],
            }),
          }
        }
        if (u.includes("/version/ver-dep-mod")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: "ver-dep-mod",
              project_id: "proj-dep-mod",
              name: "Dep Mod",
              game_versions: ["1.21.1"],
              loaders: ["neoforge"],
              files: [{ filename: "dep.jar", size: 500, url: "https://cdn/dep.jar" }],
              dependencies: [],
            }),
          }
        }
        if (u.includes("/project/proj-root-mod")) {
          return { ok: true, status: 200, json: async () => ({ id: "proj-root-mod", title: "Root Mod", project_type: "mod", categories: [] }) }
        }
        if (u.includes("/project/proj-dep-mod/version")) {
          return {
            ok: true,
            status: 200,
            json: async () => [
              {
                id: "ver-dep-mod",
                name: "Dep Mod",
                game_versions: ["1.21.1"],
                loaders: ["neoforge"],
                files: [{ filename: "dep.jar", size: 500, url: "https://cdn/dep.jar" }],
                dependencies: [],
              },
            ],
          }
        }
        if (u.includes("/project/proj-dep-mod")) {
          return { ok: true, status: 200, json: async () => ({ id: "proj-dep-mod", title: "Dep Mod", project_type: "mod", categories: [] }) }
        }
        if (u.includes("root.jar") || u.includes("dep.jar")) {
          return createBinaryResponse(
            createSampleJarBuffer("jar content"),
            200,
            u.includes("root.jar") ? 1000 : 500,
          )
        }
        return { ok: false, status: 404 }
      })

      const files = await installModPlan(
        db,
        env,
        { provider: "MODRINTH", projectId: "proj-root-mod", versionId: "ver-root-mod", contentType: "MOD" },
        adminUserId,
      )

      expect(files.length).toBe(2)
      expect(files.some((f) => f.logicalPath === "mods/root.jar")).toBe(true)
      expect(files.some((f) => f.logicalPath === "mods/dep.jar")).toBe(true)
    })

    it("installs Resource Pack, Data Pack, and Shader individually into their respective directories and policies", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        const u = String(url)
        if (u.includes("/project/rp-proj/version")) {
          return {
            ok: true,
            status: 200,
            json: async () => [
              {
                id: "ver-rp",
                name: "Faithful",
                game_versions: ["1.21.1"],
                loaders: [],
                files: [{ filename: "faithful.zip", size: 5000, url: "https://cdn/faithful.zip" }],
                dependencies: [],
              },
            ],
          }
        }
        if (u.includes("/version/ver-rp")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: "ver-rp",
              project_id: "rp-proj",
              name: "Faithful",
              game_versions: ["1.21.1"],
              loaders: [],
              files: [{ filename: "faithful.zip", size: 5000, url: "https://cdn/faithful.zip" }],
              dependencies: [],
            }),
          }
        }
        if (u.includes("/project/dp-proj/version")) {
          return {
            ok: true,
            status: 200,
            json: async () => [
              {
                id: "ver-dp",
                name: "Terralith",
                game_versions: ["1.21.1"],
                loaders: ["datapack"],
                files: [{ filename: "terralith.zip", size: 4000, url: "https://cdn/terralith.zip" }],
                dependencies: [],
              },
            ],
          }
        }
        if (u.includes("/version/ver-dp")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: "ver-dp",
              project_id: "dp-proj",
              name: "Terralith",
              game_versions: ["1.21.1"],
              loaders: ["datapack"],
              files: [{ filename: "terralith.zip", size: 4000, url: "https://cdn/terralith.zip" }],
              dependencies: [],
            }),
          }
        }
        if (u.includes("/project/shader-proj/version")) {
          return {
            ok: true,
            status: 200,
            json: async () => [
              {
                id: "ver-shader",
                name: "Complementary",
                game_versions: ["1.21.1"],
                loaders: [],
                files: [{ filename: "complementary.zip", size: 6000, url: "https://cdn/shader.zip" }],
                dependencies: [],
              },
            ],
          }
        }
        if (u.includes("/version/ver-shader")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: "ver-shader",
              project_id: "shader-proj",
              name: "Complementary",
              game_versions: ["1.21.1"],
              loaders: [],
              files: [{ filename: "complementary.zip", size: 6000, url: "https://cdn/shader.zip" }],
              dependencies: [],
            }),
          }
        }
        if (u.includes("/project/rp-proj")) return { ok: true, status: 200, json: async () => ({ id: "rp-proj", title: "Faithful", project_type: "resourcepack", categories: [] }) }
        if (u.includes("/project/dp-proj")) return { ok: true, status: 200, json: async () => ({ id: "dp-proj", title: "Terralith", all_project_types: ["datapack"], categories: [] }) }
        if (u.includes("/project/shader-proj")) return { ok: true, status: 200, json: async () => ({ id: "shader-proj", title: "Complementary", project_type: "shader", categories: [] }) }

        if (u.includes(".zip")) {
          const expectedSize =
            u.includes("faithful.zip")
              ? 5000
              : u.includes("terralith.zip")
                ? 4000
                : 6000

          return createBinaryResponse(
            createSampleJarBuffer("zip content"),
            200,
            expectedSize,
          )
        }
        return { ok: false, status: 404 }
      })

      // 1. Install Resource Pack
      const rpFiles = await installModPlan(
        db,
        env,
        { provider: "MODRINTH", projectId: "rp-proj", versionId: "ver-rp", contentType: "RESOURCE_PACK" },
        adminUserId,
      )
      const rp = rpFiles.find((f) => f.logicalPath === "resourcepacks/faithful.zip")
      expect(rp).toBeDefined()
      expect(rp?.category).toBe("RESOURCE_PACK")
      expect(rp?.policy).toBe("MODIFICABLE")

      // 2. Data Pack installation in Game flow throws Shard 08D error
      await expect(
        installModPlan(
          db,
          env,
          { provider: "MODRINTH", projectId: "dp-proj", versionId: "ver-dp", contentType: "DATA_PACK" },
          adminUserId,
        ),
      ).rejects.toThrow(/Los Data Packs se administran exclusivamente desde Servidor → Archivos/)

      // 3. Install Shader
      const shaderFiles = await installModPlan(
        db,
        env,
        { provider: "MODRINTH", projectId: "shader-proj", versionId: "ver-shader", contentType: "SHADER" },
        adminUserId,
      )
      const sh = shaderFiles.find((f) => f.logicalPath === "shaderpacks/complementary.zip")
      expect(sh).toBeDefined()
      expect(sh?.category).toBe("SHADER_PACK")
      expect(sh?.policy).toBe("MODIFICABLE")
    })

    it("excludes DATA_PACK files from publishedModpack.clientFiles", async () => {
      const draft = await prepareGameDraft(db, adminUserId)

      await r2.put("game-files/mod", new Uint8Array(1000))
      await r2.put("game-files/dp", new Uint8Array(5000))

      await db.insert(schema.gameReleaseFiles).values({
        id: "mod-file-1",
        releaseId: draft.id,
        name: "jei.jar",
        logicalPath: "mods/jei.jar",
        category: "MOD",
        sha256: "sha256-mod",
        sizeBytes: 1000,
        policy: "NO_MODIFICABLE",
        objectKey: "game-files/mod",
        createdAt: new Date().toISOString(),
      })

      await db.insert(schema.gameReleaseFiles).values({
        id: "datapack-file-1",
        releaseId: draft.id,
        name: "server_data.zip",
        logicalPath: "datapacks/server_data.zip",
        category: "DATA_PACK",
        sha256: "sha256-dp",
        sizeBytes: 5000,
        policy: "NO_MODIFICABLE",
        objectKey: "game-files/dp",
        createdAt: new Date().toISOString(),
      })

      await publishGameRelease(db, env, { version: "1.0.0", notes: "Release with datapack" }, adminUserId)

      const publishedManifest = await getPublishedModpack(db, env)
      expect(publishedManifest).toBeDefined()
      expect(publishedManifest?.clientFiles.length).toBe(1)
      expect(publishedManifest?.clientFiles[0]!.path).toBe("mods/jei.jar")
      expect(publishedManifest?.clientFiles.some((f) => f.path.startsWith("datapacks/"))).toBe(false)
    })
  })

  describe("5. Hash Fallback Verification (MD5) & D1 Rollback", () => {
    it("successfully installs when provider supplies valid MD5 checksum (calculated independently)", async () => {
      // Buffer with content "Hello HiKAT MD5 Test Binary"
      // Precomputed independent MD5: 813b93947fd25d4d3744bca32172edc3
      const knownValidBuffer = createSampleJarBuffer("Hello HiKAT MD5 Test Binary")
      const expectedMd5 = "813b93947fd25d4d3744bca32172edc3"

      mockFetch.mockImplementation(async (url: string) => {
        const u = String(url)
        if (u.includes("api.curseforge.com/v1/mods/328085/files/7777")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: {
                id: 7777,
                fileName: "md5valid.jar",
                downloadUrl: "https://cdn/md5valid.jar",
                gameVersions: ["1.21.1", "NeoForge"],
                hashes: [{ algo: 2, value: expectedMd5 }],
                dependencies: [],
              },
            }),
          }
        }
        if (u.includes("api.curseforge.com/v1/mods/328085/files")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: [
                {
                  id: 7777,
                  fileName: "md5valid.jar",
                  downloadUrl: "https://cdn/md5valid.jar",
                  gameVersions: ["1.21.1", "NeoForge"],
                  hashes: [{ algo: 2, value: expectedMd5 }],
                  dependencies: [],
                },
              ],
            }),
          }
        }
        if (u.includes("api.curseforge.com/v1/mods/328085")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ data: { id: 328085, name: "MD5 Valid Mod", classId: 6 } }),
          }
        }
        if (u.includes("https://cdn/md5valid.jar")) {
          return createBinaryResponse(
            knownValidBuffer,
          )
        }
        return { ok: false, status: 404 }
      })

      const installed = await installModPlan(
        db,
        env,
        { provider: "CURSEFORGE", projectId: "328085", versionId: "7777", environmentOverride: "CLIENT" },
        adminUserId,
      )

      expect(installed.length).toBe(1)
      expect(installed[0]!.name).toBe("md5valid.jar")
      expect(installed[0]!.logicalPath).toBe("mods/md5valid.jar")
      expect(installed[0]!.sha256).toBeDefined()
    })

    it("verifies MD5 checksum correctly when only MD5 is provided, and rejects on mismatch", async () => {
      const validBuffer = createSampleJarBuffer("test content for md5")
      mockFetch.mockImplementation(async (url: string) => {
        const u = String(url)
        if (u.includes("api.curseforge.com/v1/mods/328085/files/5555")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: {
                id: 5555,
                fileName: "cfmd5.jar",
                downloadUrl: "https://cdn/cfmd5.jar",
                gameVersions: ["1.21.1", "NeoForge"],
                hashes: [{ algo: 2, value: "00000000000000000000000000000000" }], // Wrong MD5
                dependencies: [],
              },
            }),
          }
        }
        if (u.includes("api.curseforge.com/v1/mods/328085/files")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: [
                {
                  id: 5555,
                  fileName: "cfmd5.jar",
                  downloadUrl: "https://cdn/cfmd5.jar",
                  gameVersions: ["1.21.1", "NeoForge"],
                  hashes: [{ algo: 2, value: "00000000000000000000000000000000" }],
                  dependencies: [],
                },
              ],
            }),
          }
        }
        if (u.includes("api.curseforge.com/v1/mods/328085")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ data: { id: 328085, name: "MD5 CF", classId: 6 } }),
          }
        }
        if (u.includes("https://cdn/cfmd5.jar")) {
          return createBinaryResponse(
            validBuffer,
          )
        }
        return { ok: false, status: 404 }
      })

      // Should fail with MD5 integrity error
      await expect(
        installModPlan(
          db,
          env,
          { provider: "CURSEFORGE", projectId: "328085", versionId: "5555", environmentOverride: "CLIENT" },
          adminUserId,
        ),
      ).rejects.toThrow(/hash MD5 descargado/)
    })

    it("executes a REAL SQLite batch rollback when a statement inside the D1 batch fails", async () => {
      const draft = await prepareGameDraft(db, adminUserId)

      const preExistingId = "pre-existing-file"
      await db.insert(schema.gameReleaseFiles).values({
        id: preExistingId,
        releaseId: draft.id,
        name: "existing.jar",
        logicalPath: "mods/existing.jar",
        category: "MOD",
        sha256: "sha256-original",
        sizeBytes: 1000,
        policy: "NO_MODIFICABLE",
        objectKey: "game-files/original",
        createdAt: new Date().toISOString(),
      })

      // Add a UNIQUE constraint in SQLite on sha256 to cause statement 2 to fail inside the real batch
      testD1.exec("CREATE UNIQUE INDEX test_unique_sha256 ON game_release_files(sha256);")

      mockFetch.mockImplementation(async (url: string) => {
        const u = String(url)
        if (u.includes("/project/batch-root/version")) {
          return {
            ok: true,
            status: 200,
            json: async () => [
              {
                id: "ver-batch-root",
                name: "Batch Root",
                game_versions: ["1.21.1"],
                loaders: ["neoforge"],
                files: [{ filename: "root.jar", size: 100, url: "https://cdn/root.jar" }],
                dependencies: [{ project_id: "batch-dep", dependency_type: "required" }],
              },
            ],
          }
        }
        if (u.includes("/version/ver-batch-root")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: "ver-batch-root",
              project_id: "batch-root",
              name: "Batch Root",
              version_number: "1.0",
              game_versions: ["1.21.1"],
              loaders: ["neoforge"],
              files: [{ filename: "root.jar", size: 100, url: "https://cdn/root.jar" }],
              dependencies: [{ project_id: "batch-dep", dependency_type: "required" }],
            }),
          }
        }
        if (u.includes("/version/ver-batch-dep")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: "ver-batch-dep",
              project_id: "batch-dep",
              name: "Batch Dep",
              version_number: "1.0",
              game_versions: ["1.21.1"],
              loaders: ["neoforge"],
              files: [{ filename: "dep.jar", size: 100, url: "https://cdn/dep.jar" }],
              dependencies: [],
            }),
          }
        }
        if (u.includes("/project/batch-root")) {
          return { ok: true, status: 200, json: async () => ({ id: "batch-root", title: "Batch Root", project_type: "mod", categories: [] }) }
        }
        if (u.includes("/project/batch-dep/version")) {
          return {
            ok: true,
            status: 200,
            json: async () => [{ id: "ver-batch-dep", name: "Batch Dep", version_number: "1.0", game_versions: ["1.21.1"], loaders: ["neoforge"], files: [{ filename: "dep.jar", size: 100, url: "https://cdn/dep.jar" }], dependencies: [] }],
          }
        }
        if (u.includes("/project/batch-dep")) {
          return { ok: true, status: 200, json: async () => ({ id: "batch-dep", title: "Batch Dep", project_type: "mod", categories: [] }) }
        }
        if (u.includes("root.jar") || u.includes("dep.jar")) {
          return createBinaryResponse(
            createSampleJarBuffer("identical binary"),
            200,
            100,
          )
        }
        return { ok: false, status: 404 }
      })

      // Attempt install: Statement 1 (root) succeeds, Statement 2 (dep) has identical binary -> UNIQUE constraint fails!
      await expect(
        installModPlan(
          db,
          env,
          { provider: "MODRINTH", projectId: "batch-root", versionId: "ver-batch-root" },
          adminUserId,
        ),
      ).rejects.toThrow()

      // VERIFY REAL D1 ROLLBACK: No new rows inserted into D1
      const filesAfter = await db.select().from(schema.gameReleaseFiles).all()
      expect(filesAfter.length).toBe(1)
      expect(filesAfter[0]!.id).toBe(preExistingId)
      expect(filesAfter[0]!.logicalPath).toBe("mods/existing.jar")

      // VERIFY R2 COMPENSATION: newly uploaded keys were deleted
      expect(r2._store.size).toBe(0)
    })

    it("clears provider metadata when a provider file is replaced via addGameFile or updateGameFile", async () => {
      const draft = await prepareGameDraft(db, adminUserId)

      const fileId = "provider-mod-file"
      await db.insert(schema.gameReleaseFiles).values({
        id: fileId,
        releaseId: draft.id,
        name: "testmod.jar",
        logicalPath: "mods/testmod.jar",
        category: "MOD",
        sha256: "sha256-mod",
        sizeBytes: 3000,
        objectKey: "game-files/testmod",
        sourceProvider: "MODRINTH",
        sourceProjectId: "test-proj",
        sourceVersionId: "ver-test",
        sourceEnvironment: "BOTH",
        createdAt: new Date().toISOString(),
      })

      const tokenHash = "token-hash-123"
      await db.insert(schema.gameFileUploadTokens).values({
        id: crypto.randomUUID(),
        tokenHash,
        category: "MOD",
        originalFilename: "testmod.jar",
        expectedSizeBytes: 4000,
        uploadedSizeBytes: 4000,
        objectKey: "game-files/new-manual",
        sha256: "sha256-new-manual",
        createdBy: adminUserId,
        usedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        createdAt: new Date().toISOString(),
      })

      await addGameFile(
        db,
        {
          name: "testmod.jar",
          logicalPath: "mods/testmod.jar",
          tokenHash,
        },
        adminUserId,
        env,
      )

      const updated = await db.select().from(schema.gameReleaseFiles).where(eq(schema.gameReleaseFiles.id, fileId)).get()
      expect(updated?.sourceProvider).toBeNull()
      expect(updated?.sourceProjectId).toBeNull()
      expect(updated?.sourceVersionId).toBeNull()
      expect(updated?.sourceEnvironment).toBeNull()
    })
  })

  describe("6. Pagination & Combinations", () => {
    it("handles ALL search pagination deterministically without gaps or duplicate items", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        const u = String(url)
        if (u.includes("modrinth.com")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              hits: [
                { project_id: "M0", title: "Mod M0", project_type: "mod", categories: [] },
                { project_id: "M1", title: "Mod M1", project_type: "mod", categories: [] },
                { project_id: "M2", title: "Mod M2", project_type: "mod", categories: [] },
              ],
              total_hits: 3,
            }),
          }
        }
        if (u.includes("curseforge.com")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: [
                { id: 100, name: "Mod C0", slug: "c0", classId: 6 },
                { id: 101, name: "Mod C1", slug: "c1", classId: 6 },
                { id: 102, name: "Mod C2", slug: "c2", classId: 6 },
              ],
              pagination: { totalCount: 3 },
            }),
          }
        }
        return { ok: false, status: 404 }
      })

      // Page 1: limit 2, offset 0 -> M0, C0
      const page1 = await manager.searchMods(env, db, "", null, 2, 0, "MOD")
      expect(page1.items.length).toBe(2)
      expect(page1.items[0]!.projectId).toBe("M0")
      expect(page1.items[1]!.projectId).toBe("100")

      // Page 2: limit 2, offset 2 -> M1, C1
      const page2 = await manager.searchMods(env, db, "", null, 2, 2, "MOD")
      expect(page2.items.length).toBe(2)
      expect(page2.items[0]!.projectId).toBe("M1")
      expect(page2.items[1]!.projectId).toBe("101")

      // Page 3: limit 2, offset 4 -> M2, C2
      const page3 = await manager.searchMods(env, db, "", null, 2, 4, "MOD")
      expect(page3.items.length).toBe(2)
      expect(page3.items[0]!.projectId).toBe("M2")
      expect(page3.items[1]!.projectId).toBe("102")
    })

    it("survives partial provider failure gracefully in ALL search", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        const u = String(url)
        if (u.includes("modrinth.com")) {
          return { ok: false, status: 500 }
        }
        if (u.includes("curseforge.com")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: [{ id: 200, name: "Curse Mod", slug: "curse-mod", classId: 6 }],
              pagination: { totalCount: 1 },
            }),
          }
        }
        return { ok: false, status: 404 }
      })

      const res = await manager.searchMods(env, db, "", null, 20, 0, "MOD")
      expect(res.items.length).toBe(1)
      expect(res.items[0]!.provider).toBe("CURSEFORGE")
      expect(res.providersStatus.find((p) => p.provider === "MODRINTH")?.available).toBe(false)
      expect(res.providersStatus.find((p) => p.provider === "CURSEFORGE")?.available).toBe(true)
    })
  })

  describe("7. Cross-Content Dependency Resolution & Multi-Type Ambiguity", () => {
    it("resolves MOD -> MOD dependency cleanly into mods/", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        const u = String(url)
        if (u.includes("/project/m-root/version")) {
          return {
            ok: true,
            status: 200,
            json: async () => [
              {
                id: "ver-m-root",
                name: "Mod Root",
                game_versions: ["1.21.1"],
                loaders: ["neoforge"],
                files: [{ filename: "m-root.jar", size: 1000, url: "https://cdn/m-root.jar" }],
                dependencies: [{ project_id: "m-dep", dependency_type: "required" }],
              },
            ],
          }
        }
        if (u.includes("/project/m-dep/version")) {
          return {
            ok: true,
            status: 200,
            json: async () => [
              {
                id: "ver-m-dep",
                name: "Mod Dep",
                game_versions: ["1.21.1"],
                loaders: ["neoforge"],
                files: [{ filename: "m-dep.jar", size: 500, url: "https://cdn/m-dep.jar" }],
                dependencies: [],
              },
            ],
          }
        }
        if (u.includes("/project/m-root")) {
          return { ok: true, status: 200, json: async () => ({ id: "m-root", title: "Mod Root", project_type: "mod", categories: [] }) }
        }
        if (u.includes("/project/m-dep")) {
          return { ok: true, status: 200, json: async () => ({ id: "m-dep", title: "Mod Dep", project_type: "mod", categories: [] }) }
        }
        return { ok: false, status: 404 }
      })

      const plan = await manager.resolveInstallationPlan(
        env,
        db,
        { provider: "MODRINTH", projectId: "m-root", versionId: "ver-m-root", contentType: "MOD" },
      )

      expect(plan.isValid).toBe(true)
      expect(plan.items.length).toBe(2)
      expect(plan.items[0]!.logicalPath).toBe("mods/m-root.jar")
      expect(plan.items[0]!.contentType).toBe("MOD")
      expect(plan.items[1]!.logicalPath).toBe("mods/m-dep.jar")
      expect(plan.items[1]!.contentType).toBe("MOD")
    })

    it("resolves DATA_PACK -> DATA_PACK dependency cleanly into datapacks/", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        const u = String(url)
        if (u.includes("/project/dp-parent/version")) {
          return {
            ok: true,
            status: 200,
            json: async () => [
              {
                id: "ver-dp-parent",
                name: "DP Parent",
                game_versions: ["1.21.1"],
                loaders: ["datapack"],
                files: [{ filename: "dp-parent.zip", size: 2000, url: "https://cdn/dp-parent.zip" }],
                dependencies: [{ project_id: "dp-child", dependency_type: "required" }],
              },
            ],
          }
        }
        if (u.includes("/project/dp-child/version")) {
          return {
            ok: true,
            status: 200,
            json: async () => [
              {
                id: "ver-dp-child",
                name: "DP Child",
                game_versions: ["1.21.1"],
                loaders: ["datapack"],
                files: [{ filename: "dp-child.zip", size: 1500, url: "https://cdn/dp-child.zip" }],
                dependencies: [],
              },
            ],
          }
        }
        if (u.includes("/project/dp-parent")) {
          return { ok: true, status: 200, json: async () => ({ id: "dp-parent", title: "DP Parent", all_project_types: ["datapack"], categories: ["datapack"] }) }
        }
        if (u.includes("/project/dp-child")) {
          return { ok: true, status: 200, json: async () => ({ id: "dp-child", title: "DP Child", all_project_types: ["datapack"], categories: ["datapack"] }) }
        }
        return { ok: false, status: 404 }
      })

      const plan = await manager.resolveServerInstallationPlan(
        env,
        db,
        { provider: "MODRINTH", projectId: "dp-parent", versionId: "ver-dp-parent", contentType: "DATA_PACK" },
      )

      expect(plan.isValid).toBe(true)
      expect(plan.items.length).toBe(2)
      expect(plan.items[0]!.targetPath).toBe("world/datapacks/dp-parent.zip")
      expect(plan.items[0]!.contentType).toBe("DATA_PACK")
      expect(plan.items[1]!.targetPath).toBe("world/datapacks/dp-child.zip")
      expect(plan.items[1]!.contentType).toBe("DATA_PACK")
    })

    it("resolves DATA_PACK -> MOD dependency into respective directories (datapacks/ and mods/)", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        const u = String(url)
        if (u.includes("/project/dp-with-mod-dep/version")) {
          return {
            ok: true,
            status: 200,
            json: async () => [
              {
                id: "ver-dp-root",
                name: "DP With Mod Dep",
                game_versions: ["1.21.1"],
                loaders: ["datapack"],
                files: [{ filename: "dp-root.zip", size: 2000, url: "https://cdn/dp-root.zip" }],
                dependencies: [{ project_id: "mod-cloth", dependency_type: "required" }],
              },
            ],
          }
        }
        if (u.includes("/project/mod-cloth/version")) {
          return {
            ok: true,
            status: 200,
            json: async () => [
              {
                id: "ver-mod-cloth",
                name: "Cloth Config",
                game_versions: ["1.21.1"],
                loaders: ["neoforge"],
                files: [{ filename: "cloth.jar", size: 3000, url: "https://cdn/cloth.jar" }],
                dependencies: [],
              },
            ],
          }
        }
        if (u.includes("/project/dp-with-mod-dep")) {
          return { ok: true, status: 200, json: async () => ({ id: "dp-with-mod-dep", title: "DP With Mod Dep", all_project_types: ["datapack"], categories: ["datapack"] }) }
        }
        if (u.includes("/project/mod-cloth")) {
          return { ok: true, status: 200, json: async () => ({ id: "mod-cloth", title: "Cloth Config", project_type: "mod", client_side: "unsupported", server_side: "required", categories: ["technology"] }) }
        }
        return { ok: false, status: 404 }
      })

      const plan = await manager.resolveServerInstallationPlan(
        env,
        db,
        { provider: "MODRINTH", projectId: "dp-with-mod-dep", versionId: "ver-dp-root", contentType: "DATA_PACK" },
      )

      expect(plan.isValid).toBe(true)
      expect(plan.items.length).toBe(2)
      expect(plan.items[0]!.targetPath).toBe("world/datapacks/dp-root.zip")
      expect(plan.items[0]!.contentType).toBe("DATA_PACK")
      expect(plan.items[1]!.targetPath).toBe("mods/cloth.jar")
      expect(plan.items[1]!.contentType).toBe("MOD")
    })

    it("resolves SHADER -> MOD dependency into shaderpacks/ and mods/", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        const u = String(url)
        if (u.includes("/project/sh-parent/version")) {
          return {
            ok: true,
            status: 200,
            json: async () => [
              {
                id: "ver-sh-parent",
                name: "Complementary Shaders",
                game_versions: ["1.21.1"],
                loaders: [],
                files: [{ filename: "complementary.zip", size: 5000, url: "https://cdn/comp.zip" }],
                dependencies: [{ project_id: "mod-iris", dependency_type: "required" }],
              },
            ],
          }
        }
        if (u.includes("/project/mod-iris/version")) {
          return {
            ok: true,
            status: 200,
            json: async () => [
              {
                id: "ver-mod-iris",
                name: "Iris Shaders Mod",
                game_versions: ["1.21.1"],
                loaders: ["neoforge"],
                files: [{ filename: "iris.jar", size: 4000, url: "https://cdn/iris.jar" }],
                dependencies: [],
              },
            ],
          }
        }
        if (u.includes("/project/sh-parent")) {
          return { ok: true, status: 200, json: async () => ({ id: "sh-parent", title: "Complementary", project_type: "shader", categories: [] }) }
        }
        if (u.includes("/project/mod-iris")) {
          return { ok: true, status: 200, json: async () => ({ id: "mod-iris", title: "Iris", project_type: "mod", categories: [] }) }
        }
        return { ok: false, status: 404 }
      })

      const plan = await manager.resolveInstallationPlan(
        env,
        db,
        { provider: "MODRINTH", projectId: "sh-parent", versionId: "ver-sh-parent", contentType: "SHADER" },
      )

      expect(plan.isValid).toBe(true)
      expect(plan.items.length).toBe(2)
      expect(plan.items[0]!.logicalPath).toBe("shaderpacks/complementary.zip")
      expect(plan.items[0]!.contentType).toBe("SHADER")
      expect(plan.items[1]!.logicalPath).toBe("mods/iris.jar")
      expect(plan.items[1]!.contentType).toBe("MOD")
    })

    it("flags conflict when a Game Release MOD depends on a DATA_PACK per Shard 08D rules", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        const u = String(url)
        if (u.includes("/project/root-with-pinned/version")) {
          return {
            ok: true,
            status: 200,
            json: async () => [
              {
                id: "ver-root-pin",
                name: "Root With Pin",
                game_versions: ["1.21.1"],
                loaders: ["neoforge"],
                files: [{ filename: "root-pin.jar", size: 1000, url: "https://cdn/root.jar" }],
                dependencies: [{ project_id: "hybrid-dep", version_id: "ver-pinned-dp", dependency_type: "required" }],
              },
            ],
          }
        }
        if (u.includes("/version/ver-pinned-dp")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: "ver-pinned-dp",
              project_id: "hybrid-dep",
              name: "Hybrid DP",
              game_versions: ["1.21.1"],
              loaders: ["datapack"],
              files: [{ filename: "hybrid.zip", size: 800, url: "https://cdn/hybrid.zip" }],
              dependencies: [],
            }),
          }
        }
        if (u.includes("/project/hybrid-dep/version")) {
          return {
            ok: true,
            status: 200,
            json: async () => [
              {
                id: "ver-pinned-dp",
                name: "Hybrid DP",
                game_versions: ["1.21.1"],
                loaders: ["datapack"],
                files: [{ filename: "hybrid.zip", size: 800, url: "https://cdn/hybrid.zip" }],
                dependencies: [],
              },
            ],
          }
        }
        if (u.includes("/project/root-with-pinned")) {
          return { ok: true, status: 200, json: async () => ({ id: "root-with-pinned", title: "Root Pin", project_type: "mod", categories: [] }) }
        }
        if (u.includes("/project/hybrid-dep")) {
          return { ok: true, status: 200, json: async () => ({ id: "hybrid-dep", title: "Hybrid Dep", project_type: "mod", all_project_types: ["mod", "datapack"], categories: [] }) }
        }
        return { ok: false, status: 404 }
      })

      const plan = await manager.resolveInstallationPlan(
        env,
        db,
        { provider: "MODRINTH", projectId: "root-with-pinned", versionId: "ver-root-pin", contentType: "MOD" },
      )

      expect(plan.isValid).toBe(false)
      expect(plan.conflicts.some((c) => c.includes("Data Pack") && c.includes("Servidor → Archivos"))).toBe(true)
    })

    it("flags conflict for ambiguous multi-type dependency without silently guessing MOD", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        const u = String(url)
        if (u.includes("/project/root-with-ambig/version")) {
          return {
            ok: true,
            status: 200,
            json: async () => [
              {
                id: "ver-root-ambig",
                name: "Root With Ambig",
                game_versions: ["1.21.1"],
                loaders: ["neoforge"],
                files: [{ filename: "root-ambig.jar", size: 1000, url: "https://cdn/root.jar" }],
                dependencies: [{ project_id: "hybrid-dep-ambig", dependency_type: "required" }],
              },
            ],
          }
        }
        if (u.includes("/project/root-with-ambig")) {
          return { ok: true, status: 200, json: async () => ({ id: "root-with-ambig", title: "Root Ambig", project_type: "mod", categories: [] }) }
        }
        if (u.includes("/project/hybrid-dep-ambig")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: "hybrid-dep-ambig",
              title: "Hybrid Ambiguous",
              project_type: "mod",
              all_project_types: ["mod", "datapack"],
              categories: ["datapack"],
            }),
          }
        }
        return { ok: false, status: 404 }
      })

      const plan = await manager.resolveInstallationPlan(
        env,
        db,
        { provider: "MODRINTH", projectId: "root-with-ambig", versionId: "ver-root-ambig", contentType: "MOD" },
      )

      expect(plan.isValid).toBe(false)
      expect(plan.conflicts.length).toBe(1)
      expect(plan.conflicts[0]).toContain("es multi-tipo y ambigua")
    })

    it("resolves pinned RESOURCE_PACK with loader minecraft into resourcepacks/", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        const u = String(url)
        if (u.includes("/project/root-with-rp/version")) {
          return {
            ok: true,
            status: 200,
            json: async () => [
              {
                id: "ver-root-rp",
                name: "Root With RP Dep",
                game_versions: ["1.21.1"],
                loaders: ["neoforge"],
                files: [{ filename: "root-rp.jar", size: 1000, url: "https://cdn/root-rp.jar" }],
                dependencies: [{ project_id: "rp-dep", version_id: "ver-pinned-rp", dependency_type: "required" }],
              },
            ],
          }
        }
        if (u.includes("/version/ver-pinned-rp")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: "ver-pinned-rp",
              project_id: "rp-dep",
              name: "Faithful RP",
              game_versions: ["1.21.1"],
              loaders: ["minecraft"],
              files: [{ filename: "faithful.zip", size: 3000, url: "https://cdn/faithful.zip" }],
              dependencies: [],
            }),
          }
        }
        if (u.includes("/project/rp-dep/version")) {
          return {
            ok: true,
            status: 200,
            json: async () => [
              {
                id: "ver-pinned-rp",
                name: "Faithful RP",
                game_versions: ["1.21.1"],
                loaders: ["minecraft"],
                files: [{ filename: "faithful.zip", size: 3000, url: "https://cdn/faithful.zip" }],
                dependencies: [],
              },
            ],
          }
        }
        if (u.includes("/project/root-with-rp")) {
          return { ok: true, status: 200, json: async () => ({ id: "root-with-rp", title: "Root RP", project_type: "mod", categories: [] }) }
        }
        if (u.includes("/project/rp-dep")) {
          return { ok: true, status: 200, json: async () => ({ id: "rp-dep", title: "Faithful RP", project_type: "resourcepack", categories: [] }) }
        }
        return { ok: false, status: 404 }
      })

      const plan = await manager.resolveInstallationPlan(
        env,
        db,
        { provider: "MODRINTH", projectId: "root-with-rp", versionId: "ver-root-rp", contentType: "MOD" },
      )

      expect(plan.isValid).toBe(true)
      expect(plan.items.length).toBe(2)
      expect(plan.items[0]!.logicalPath).toBe("mods/root-rp.jar")
      expect(plan.items[0]!.contentType).toBe("MOD")
      expect(plan.items[1]!.logicalPath).toBe("resourcepacks/faithful.zip")
      expect(plan.items[1]!.contentType).toBe("RESOURCE_PACK")
    })

    it("resolves pinned SHADER into shaderpacks/", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        const u = String(url)
        if (u.includes("/project/root-with-sh/version")) {
          return {
            ok: true,
            status: 200,
            json: async () => [
              {
                id: "ver-root-sh",
                name: "Root With Shader Dep",
                game_versions: ["1.21.1"],
                loaders: ["neoforge"],
                files: [{ filename: "root-sh.jar", size: 1000, url: "https://cdn/root-sh.jar" }],
                dependencies: [{ project_id: "sh-dep", version_id: "ver-pinned-sh", dependency_type: "required" }],
              },
            ],
          }
        }
        if (u.includes("/version/ver-pinned-sh")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: "ver-pinned-sh",
              project_id: "sh-dep",
              name: "Complementary Shader",
              game_versions: ["1.21.1"],
              loaders: [],
              files: [{ filename: "complementary.zip", size: 5000, url: "https://cdn/comp.zip" }],
              dependencies: [],
            }),
          }
        }
        if (u.includes("/project/sh-dep/version")) {
          return {
            ok: true,
            status: 200,
            json: async () => [
              {
                id: "ver-pinned-sh",
                name: "Complementary Shader",
                game_versions: ["1.21.1"],
                loaders: [],
                files: [{ filename: "complementary.zip", size: 5000, url: "https://cdn/comp.zip" }],
                dependencies: [],
              },
            ],
          }
        }
        if (u.includes("/project/root-with-sh")) {
          return { ok: true, status: 200, json: async () => ({ id: "root-with-sh", title: "Root Shader", project_type: "mod", categories: [] }) }
        }
        if (u.includes("/project/sh-dep")) {
          return { ok: true, status: 200, json: async () => ({ id: "sh-dep", title: "Complementary", project_type: "shader", categories: [] }) }
        }
        return { ok: false, status: 404 }
      })

      const plan = await manager.resolveInstallationPlan(
        env,
        db,
        { provider: "MODRINTH", projectId: "root-with-sh", versionId: "ver-root-sh", contentType: "MOD" },
      )

      expect(plan.isValid).toBe(true)
      expect(plan.items.length).toBe(2)
      expect(plan.items[0]!.logicalPath).toBe("mods/root-sh.jar")
      expect(plan.items[0]!.contentType).toBe("MOD")
      expect(plan.items[1]!.logicalPath).toBe("shaderpacks/complementary.zip")
      expect(plan.items[1]!.contentType).toBe("SHADER")
    })

    it("flags conflict for pinned dependency of indeterminable type without guessing MOD", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        const u = String(url)
        if (u.includes("/project/root-with-indet/version")) {
          return {
            ok: true,
            status: 200,
            json: async () => [
              {
                id: "ver-root-indet",
                name: "Root Indet",
                game_versions: ["1.21.1"],
                loaders: ["neoforge"],
                files: [{ filename: "root-indet.jar", size: 1000, url: "https://cdn/root.jar" }],
                dependencies: [{ project_id: "unknown-dep", version_id: "ver-pinned-unknown", dependency_type: "required" }],
              },
            ],
          }
        }
        if (u.includes("/version/ver-pinned-unknown")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: "ver-pinned-unknown",
              project_id: "unknown-dep",
              name: "Unknown Ver",
              game_versions: ["1.21.1"],
              loaders: [],
              files: [{ filename: "unknown.bin", size: 100, url: "https://cdn/unknown.bin" }],
              dependencies: [],
            }),
          }
        }
        if (u.includes("/project/root-with-indet")) {
          return { ok: true, status: 200, json: async () => ({ id: "root-with-indet", title: "Root Indet", project_type: "mod", categories: [] }) }
        }
        if (u.includes("/project/unknown-dep")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: "unknown-dep",
              title: "Unknown Dep",
              project_type: "unknown_weird_type",
              categories: [],
            }),
          }
        }
        return { ok: false, status: 404 }
      })

      const plan = await manager.resolveInstallationPlan(
        env,
        db,
        { provider: "MODRINTH", projectId: "root-with-indet", versionId: "ver-root-indet", contentType: "MOD" },
      )

      expect(plan.isValid).toBe(false)
      expect(plan.conflicts.length).toBe(1)
      expect(plan.conflicts[0]).toContain("no se pudo determinar el tipo de contenido")
    })
  })

  describe("8. Modrinth Authoritative Version-Level Type Metadata (Without all_project_types & Scoped to Game Version)", () => {
    const adapter = new ModrinthAdapter()

    it("1. determines DATA_PACK when project_type is mod but versions only have datapack loaders (no all_project_types)", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        const u = String(url)
        if (u.includes("/project/dp-only-mod/version")) {
          return {
            ok: true,
            status: 200,
            json: async () => [
              { id: "v1", loaders: ["datapack"], game_versions: ["1.21.1"] },
            ],
          }
        }
        if (u.includes("/project/dp-only-mod")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ id: "dp-only-mod", title: "DP Only Mod", project_type: "mod" }),
          }
        }
        return { ok: false, status: 404 }
      })

      const types = await adapter.getSupportedContentTypes(env, "dp-only-mod", "1.21.1")
      expect(types).toEqual(["DATA_PACK"])
    })

    it("2. detects [MOD, DATA_PACK] on project_type: mod with NeoForge + Data Pack versions for 1.21.1, generating ambiguity conflict for unpinned dep", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        const u = String(url)
        if (u.includes("/project/root-parent/version")) {
          return {
            ok: true,
            status: 200,
            json: async () => [
              {
                id: "v-root",
                loaders: ["neoforge"],
                game_versions: ["1.21.1"],
                files: [{ filename: "root.jar", size: 100, url: "https://cdn/r.jar" }],
                dependencies: [{ project_id: "hybrid-proj", dependency_type: "required" }],
              },
            ],
          }
        }
        if (u.includes("/project/root-parent")) {
          return { ok: true, status: 200, json: async () => ({ id: "root-parent", project_type: "mod" }) }
        }
        if (u.includes("/project/hybrid-proj/version")) {
          expect(u).toContain("game_versions=")
          return {
            ok: true,
            status: 200,
            json: async () => [
              { id: "v-mod", loaders: ["neoforge"], game_versions: ["1.21.1"] },
              { id: "v-dp", loaders: ["datapack"], game_versions: ["1.21.1"] },
            ],
          }
        }
        if (u.includes("/project/hybrid-proj")) {
          return { ok: true, status: 200, json: async () => ({ id: "hybrid-proj", title: "Hybrid Project", project_type: "mod" }) }
        }
        return { ok: false, status: 404 }
      })

      const supported = await adapter.getSupportedContentTypes(env, "hybrid-proj", "1.21.1")
      expect(supported).toContain("MOD")
      expect(supported).toContain("DATA_PACK")

      const plan = await manager.resolveInstallationPlan(env, db, {
        provider: "MODRINTH",
        projectId: "root-parent",
        versionId: "v-root",
        contentType: "MOD",
      })
      expect(plan.isValid).toBe(false)
      expect(plan.conflicts[0]).toContain("es multi-tipo y ambigua")
    })

    it("3. determines RESOURCE_PACK for resourcepack project without all_project_types and loader minecraft", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        const u = String(url)
        if (u.includes("/project/faithful-rp/version")) {
          return {
            ok: true,
            status: 200,
            json: async () => [
              { id: "v1", loaders: ["minecraft"], game_versions: ["1.21.1"] },
            ],
          }
        }
        if (u.includes("/project/faithful-rp")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ id: "faithful-rp", title: "Faithful RP", project_type: "resourcepack" }),
          }
        }
        return { ok: false, status: 404 }
      })

      const types = await adapter.getSupportedContentTypes(env, "faithful-rp", "1.21.1")
      expect(types).toEqual(["RESOURCE_PACK"])
    })

    it("4. determines SHADER for shader project without all_project_types", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        const u = String(url)
        if (u.includes("/project/bsl-shader/version")) {
          return {
            ok: true,
            status: 200,
            json: async () => [
              { id: "v1", loaders: [], game_versions: ["1.21.1"] },
            ],
          }
        }
        if (u.includes("/project/bsl-shader")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ id: "bsl-shader", title: "BSL Shader", project_type: "shader" }),
          }
        }
        return { ok: false, status: 404 }
      })

      const types = await adapter.getSupportedContentTypes(env, "bsl-shader", "1.21.1")
      expect(types).toEqual(["SHADER"])
    })

    it("5. determines MOD for normal NeoForge mod project", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        const u = String(url)
        if (u.includes("/project/jei-mod/version")) {
          return {
            ok: true,
            status: 200,
            json: async () => [
              { id: "v1", loaders: ["neoforge"], game_versions: ["1.21.1"] },
            ],
          }
        }
        if (u.includes("/project/jei-mod")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ id: "jei-mod", title: "JEI Mod", project_type: "mod" }),
          }
        }
        return { ok: false, status: 404 }
      })

      const types = await adapter.getSupportedContentTypes(env, "jei-mod", "1.21.1")
      expect(types).toEqual(["MOD"])
    })

    it("6. scopes versions to 1.21.1 avoiding false ambiguity from historic 1.20.1 DATA_PACK (resolving MOD)", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        const u = String(url)
        if (u.includes("/project/historic-dp-mod/version")) {
          // Verify request includes game_versions filter for 1.21.1
          expect(u).toContain(encodeURIComponent(JSON.stringify(["1.21.1"])))
          // The API returns only 1.21.1 NeoForge version
          return {
            ok: true,
            status: 200,
            json: async () => [
              { id: "v-1211", loaders: ["neoforge"], game_versions: ["1.21.1"] },
            ],
          }
        }
        if (u.includes("/project/historic-dp-mod")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ id: "historic-dp-mod", title: "Historic DP Mod", project_type: "mod" }),
          }
        }
        return { ok: false, status: 404 }
      })

      const types = await adapter.getSupportedContentTypes(env, "historic-dp-mod", "1.21.1")
      expect(types).toEqual(["MOD"])
    })

    it("7. scopes versions to 1.21.1 avoiding false ambiguity from historic 1.20.1 MOD (resolving DATA_PACK)", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        const u = String(url)
        if (u.includes("/project/historic-mod-dp/version")) {
          expect(u).toContain(encodeURIComponent(JSON.stringify(["1.21.1"])))
          // The API returns only 1.21.1 Data Pack version
          return {
            ok: true,
            status: 200,
            json: async () => [
              { id: "v-1211-dp", loaders: ["datapack"], game_versions: ["1.21.1"] },
            ],
          }
        }
        if (u.includes("/project/historic-mod-dp")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ id: "historic-mod-dp", title: "Historic Mod DP", project_type: "mod" }),
          }
        }
        return { ok: false, status: 404 }
      })

      const types = await adapter.getSupportedContentTypes(env, "historic-mod-dp", "1.21.1")
      expect(types).toEqual(["DATA_PACK"])
    })

    it("8. returns empty array when project has no versions compatible with 1.21.1", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        const u = String(url)
        if (u.includes("/project/incompatible-proj/version")) {
          return {
            ok: true,
            status: 200,
            json: async () => [], // No versions for 1.21.1!
          }
        }
        if (u.includes("/project/incompatible-proj")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ id: "incompatible-proj", title: "Incompatible Proj", project_type: "mod" }),
          }
        }
        return { ok: false, status: 404 }
      })

      const types = await adapter.getSupportedContentTypes(env, "incompatible-proj", "1.21.1")
      expect(types).toEqual([])
    })
  })

  describe("9. Final Integral Closure Hardening Tests", () => {
    describe("9.1 INCOMPATIBLE Restriction Evaluation", () => {
      it("does not conflict when declared INCOMPATIBLE target is neither in DRAFT nor in Plan", async () => {
        mockFetch.mockImplementation(async (url: string) => {
          const u = String(url)
          if (u.includes("/project/sodium/version")) {
            return {
              ok: true,
              status: 200,
              json: async () => [
                {
                  id: "ver-sodium-1",
                  project_id: "sodium",
                  name: "Sodium 1.0",
                  version_number: "1.0.0",
                  game_versions: ["1.21.1"],
                  loaders: ["neoforge"],
                  dependencies: [
                    {
                      project_id: "optifine",
                      dependency_type: "incompatible",
                    },
                  ],
                  files: [{ primary: true, filename: "sodium-1.0.jar", size: 1000, url: "https://cdn/sodium.jar" }],
                },
              ],
            }
          }
          if (u.includes("/project/sodium")) {
            return {
              ok: true,
              status: 200,
              json: async () => ({ id: "sodium", title: "Sodium", project_type: "mod" }),
            }
          }
          return { ok: false, status: 404 }
        })

        const plan = await manager.resolveInstallationPlan(env, db, {
          provider: "MODRINTH",
          projectId: "sodium",
          versionId: "ver-sodium-1",
          contentType: "MOD",
        })

        expect(plan.isValid).toBe(true)
        expect(plan.conflicts.length).toBe(0)
        expect(plan.items.length).toBe(1)
        expect(plan.items[0]!.projectName).toBe("Sodium")
      })

      it("conflicts when declared INCOMPATIBLE target is already present in DRAFT", async () => {
        // Seed an existing draft with optifine installed
        const draft = await prepareGameDraft(db, adminUserId)
        await db.insert(schema.gameReleaseFiles).values({
          id: crypto.randomUUID(),
          releaseId: draft.id,
          name: "optifine.jar",
          logicalPath: "mods/optifine.jar",
          category: "MOD",
          sha256: "sha256optifine",
          sizeBytes: 2000,
          isDirectory: 0,
          sourceProvider: "MODRINTH",
          sourceProjectId: "optifine",
          sourceVersionId: "ver-optifine-1",
          createdAt: new Date().toISOString(),
        })

        mockFetch.mockImplementation(async (url: string) => {
          const u = String(url)
          if (u.includes("/project/sodium/version")) {
            return {
              ok: true,
              status: 200,
              json: async () => [
                {
                  id: "ver-sodium-1",
                  project_id: "sodium",
                  name: "Sodium 1.0",
                  version_number: "1.0.0",
                  game_versions: ["1.21.1"],
                  loaders: ["neoforge"],
                  dependencies: [
                    {
                      project_id: "optifine",
                      dependency_type: "incompatible",
                    },
                  ],
                  files: [{ primary: true, filename: "sodium-1.0.jar", size: 1000, url: "https://cdn/sodium.jar" }],
                },
              ],
            }
          }
          if (u.includes("/project/sodium")) {
            return {
              ok: true,
              status: 200,
              json: async () => ({ id: "sodium", title: "Sodium", project_type: "mod" }),
            }
          }
          return { ok: false, status: 404 }
        })

        const plan = await manager.resolveInstallationPlan(env, db, {
          provider: "MODRINTH",
          projectId: "sodium",
          versionId: "ver-sodium-1",
          contentType: "MOD",
        })

        expect(plan.isValid).toBe(false)
        expect(plan.conflicts.length).toBe(1)
        expect(plan.conflicts[0]).toContain('declara incompatibilidad con "optifine.jar"')
      })

      it("conflicts when declared INCOMPATIBLE target is to be installed in the same Plan", async () => {
        mockFetch.mockImplementation(async (url: string) => {
          const u = String(url)
          if (u.includes("/project/mod-a/version")) {
            return {
              ok: true,
              status: 200,
              json: async () => [
                {
                  id: "ver-a-1",
                  project_id: "mod-a",
                  name: "Mod A",
                  version_number: "1.0.0",
                  game_versions: ["1.21.1"],
                  loaders: ["neoforge"],
                  dependencies: [
                    { project_id: "mod-b", dependency_type: "required" },
                    { project_id: "mod-b", dependency_type: "incompatible" },
                  ],
                  files: [{ primary: true, filename: "mod-a.jar", size: 1000, url: "https://cdn/mod-a.jar" }],
                },
              ],
            }
          }
          if (u.includes("/project/mod-b/version")) {
            return {
              ok: true,
              status: 200,
              json: async () => [
                {
                  id: "ver-b-1",
                  project_id: "mod-b",
                  name: "Mod B",
                  version_number: "1.0.0",
                  game_versions: ["1.21.1"],
                  loaders: ["neoforge"],
                  dependencies: [],
                  files: [{ primary: true, filename: "mod-b.jar", size: 1000, url: "https://cdn/mod-b.jar" }],
                },
              ],
            }
          }
          if (u.includes("/project/mod-a")) {
            return {
              ok: true,
              status: 200,
              json: async () => ({ id: "mod-a", title: "Mod A", project_type: "mod" }),
            }
          }
          if (u.includes("/project/mod-b")) {
            return {
              ok: true,
              status: 200,
              json: async () => ({ id: "mod-b", title: "Mod B", project_type: "mod" }),
            }
          }
          return { ok: false, status: 404 }
        })

        const plan = await manager.resolveInstallationPlan(env, db, {
          provider: "MODRINTH",
          projectId: "mod-a",
          versionId: "ver-a-1",
          contentType: "MOD",
        })

        expect(plan.isValid).toBe(false)
        expect(plan.conflicts.length).toBe(1)
        expect(plan.conflicts[0]).toContain('declara incompatibilidad con "Mod B"')
      })

      it("does not conflict when INCOMPATIBLE is pinned to a version different from what is installed", async () => {
        // Seed draft with version 2.0.0 of helper-lib
        const draft = await prepareGameDraft(db, adminUserId)
        await db.insert(schema.gameReleaseFiles).values({
          id: crypto.randomUUID(),
          releaseId: draft.id,
          name: "helper-2.0.jar",
          logicalPath: "mods/helper-2.0.jar",
          category: "MOD",
          sha256: "sha256helper2",
          sizeBytes: 2000,
          isDirectory: 0,
          sourceProvider: "MODRINTH",
          sourceProjectId: "helper-lib",
          sourceVersionId: "ver-helper-200",
          createdAt: new Date().toISOString(),
        })

        mockFetch.mockImplementation(async (url: string) => {
          const u = String(url)
          if (u.includes("/project/mod-c/version")) {
            return {
              ok: true,
              status: 200,
              json: async () => [
                {
                  id: "ver-c-1",
                  project_id: "mod-c",
                  name: "Mod C",
                  version_number: "1.0.0",
                  game_versions: ["1.21.1"],
                  loaders: ["neoforge"],
                  dependencies: [
                    // Only incompatible with buggy old version 1.0.0 (ver-helper-100)
                    {
                      project_id: "helper-lib",
                      version_id: "ver-helper-100",
                      dependency_type: "incompatible",
                    },
                  ],
                  files: [{ primary: true, filename: "mod-c.jar", size: 1000, url: "https://cdn/mod-c.jar" }],
                },
              ],
            }
          }
          if (u.includes("/project/mod-c")) {
            return {
              ok: true,
              status: 200,
              json: async () => ({ id: "mod-c", title: "Mod C", project_type: "mod" }),
            }
          }
          return { ok: false, status: 404 }
        })

        const plan = await manager.resolveInstallationPlan(env, db, {
          provider: "MODRINTH",
          projectId: "mod-c",
          versionId: "ver-c-1",
          contentType: "MOD",
        })

        // Because installed version is ver-helper-200, not the pinned incompatible ver-helper-100, there is NO conflict
        expect(plan.isValid).toBe(true)
        expect(plan.conflicts.length).toBe(0)
      })
    })

    describe("9.2 Modrinth Strict getCompatibleVersions ContentType Filtering", () => {
      it("filters out MOD versions when requesting RESOURCE_PACK", async () => {
        const adapter = new ModrinthAdapter()
        mockFetch.mockImplementation(async (url: string) => {
          const u = String(url)
          if (u.includes("/project/hybrid-proj/version")) {
            return {
              ok: true,
              status: 200,
              json: async () => [
                {
                  id: "ver-mod",
                  name: "Mod Version",
                  version_number: "1.0.0",
                  game_versions: ["1.21.1"],
                  loaders: ["neoforge"],
                  files: [{ primary: true, filename: "hybrid.jar", size: 1000 }],
                },
                {
                  id: "ver-rp",
                  name: "RP Version",
                  version_number: "1.0.0-rp",
                  game_versions: ["1.21.1"],
                  loaders: ["minecraft"],
                  files: [{ primary: true, filename: "hybrid.zip", size: 500 }],
                },
              ],
            }
          }
          return { ok: false, status: 404 }
        })

        const versions = await adapter.getCompatibleVersions(
          env,
          "hybrid-proj",
          "1.21.1",
          "",
          "RESOURCE_PACK",
        )

        expect(versions.length).toBe(1)
        expect(versions[0]!.id).toBe("ver-rp")
        expect(versions[0]!.contentType).toBe("RESOURCE_PACK")
      })

      it("filters out RESOURCE_PACK versions when requesting MOD", async () => {
        const adapter = new ModrinthAdapter()
        mockFetch.mockImplementation(async (url: string) => {
          const u = String(url)
          if (u.includes("/project/hybrid-proj/version")) {
            return {
              ok: true,
              status: 200,
              json: async () => [
                {
                  id: "ver-mod",
                  name: "Mod Version",
                  version_number: "1.0.0",
                  game_versions: ["1.21.1"],
                  loaders: ["neoforge"],
                  files: [{ primary: true, filename: "hybrid.jar", size: 1000 }],
                },
                {
                  id: "ver-rp",
                  name: "RP Version",
                  version_number: "1.0.0-rp",
                  game_versions: ["1.21.1"],
                  loaders: ["minecraft"],
                  files: [{ primary: true, filename: "hybrid.zip", size: 500 }],
                },
              ],
            }
          }
          return { ok: false, status: 404 }
        })

        const versions = await adapter.getCompatibleVersions(
          env,
          "hybrid-proj",
          "1.21.1",
          "NeoForge",
          "MOD",
        )

        expect(versions.length).toBe(1)
        expect(versions[0]!.id).toBe("ver-mod")
        expect(versions[0]!.contentType).toBe("MOD")
      })
    })

    describe("9.3 R2 Multipart Streaming & Compensation Safety", () => {
      it("ensures already-uploaded R2 objects are cleaned up when a later provider download fails", async () => {
        const validJar = createSampleJarBuffer("Mod Success")
        const compensationR2 = createTestR2()

        const customEnv = {
          ...env,
          ASSETS: compensationR2 as any,
        }

        mockFetch.mockImplementation(async (url: string) => {
          const u = String(url)
          if (u.includes("/version/ver-succ")) {
            return {
              ok: true,
              status: 200,
              json: async () => ({
                id: "ver-succ",
                project_id: "mod-succ",
                name: "Mod Success",
                version_number: "1.0",
                version_type: "release",
                game_versions: ["1.21.1"],
                loaders: ["neoforge"],
                dependencies: [
                  {
                    project_id: "mod-fail",
                    dependency_type: "required",
                  },
                ],
                files: [
                  {
                    primary: true,
                    filename: "mod-success.jar",
                    size: validJar.byteLength,
                    url: "https://cdn/mod-success.jar",
                  },
                ],
              }),
            }
          }

          if (u.includes("/version/ver-fail")) {
            return {
              ok: true,
              status: 200,
              json: async () => ({
                id: "ver-fail",
                project_id: "mod-fail",
                name: "Mod Fail",
                version_number: "1.0",
                version_type: "release",
                game_versions: ["1.21.1"],
                loaders: ["neoforge"],
                dependencies: [],
                files: [
                  {
                    primary: true,
                    filename: "mod-fail.jar",
                    size: 1000,
                    url: "https://cdn/mod-fail.jar",
                  },
                ],
              }),
            }
          }
          if (u.includes("/project/mod-succ/version")) {
            return {
              ok: true,
              status: 200,
              json: async () => [
                {
                  id: "ver-succ",
                  project_id: "mod-succ",
                  name: "Mod Success",
                  version_number: "1.0",
                  game_versions: ["1.21.1"],
                  loaders: ["neoforge"],
                  dependencies: [{ project_id: "mod-fail", dependency_type: "required" }],
                  files: [{ primary: true, filename: "mod-success.jar", size: validJar.byteLength, url: "https://cdn/mod-success.jar" }],
                },
              ],
            }
          }
          if (u.includes("/project/mod-fail/version")) {
            return {
              ok: true,
              status: 200,
              json: async () => [
                {
                  id: "ver-fail",
                  project_id: "mod-fail",
                  name: "Mod Fail",
                  version_number: "1.0",
                  game_versions: ["1.21.1"],
                  loaders: ["neoforge"],
                  dependencies: [],
                  files: [{ primary: true, filename: "mod-fail.jar", size: 1000, url: "https://cdn/mod-fail.jar" }],
                },
              ],
            }
          }
          if (u.includes("/project/mod-succ")) {
            return {
              ok: true,
              status: 200,
              json: async () => ({ id: "mod-succ", title: "Mod Success", project_type: "mod" }),
            }
          }
          if (u.includes("/project/mod-fail")) {
            return {
              ok: true,
              status: 200,
              json: async () => ({ id: "mod-fail", title: "Mod Fail", project_type: "mod" }),
            }
          }
          if (u.includes("cdn/mod-success.jar")) {
            return createBinaryResponse(
              validJar,
            )
          }
          if (u.includes("cdn/mod-fail.jar")) {
            return {
              ok: false,
              status: 500,
            }
          }
          return { ok: false, status: 404 }
        })

        await expect(
          installModPlan(
            db,
            customEnv,
            {
              provider: "MODRINTH",
              projectId: "mod-succ",
              versionId: "ver-succ",
              contentType: "MOD",
            },
            adminUserId,
          ),
        ).rejects.toThrow()

        // The first provider file was uploaded, then the later download failed.
        // Compensation must remove every newly created R2 object.
        expect(compensationR2.createMultipartUpload).toHaveBeenCalled()
        expect(compensationR2._store.size).toBe(0)

        // No D1 records written
        const filesInDb = await db.select().from(schema.gameReleaseFiles).all()
        expect(filesInDb.filter((f: any) => f.sourceProjectId === "mod-succ").length).toBe(0)
      })
    })

    describe("9.4 Deep Pagination for ALL Provider Search", () => {
      it("queries multiple chunks when limit + offset exceeds single page capacity", async () => {
        let modrinthCalls = 0
        mockFetch.mockImplementation(async (url: string) => {
          const u = String(url)
          if (u.includes("api.modrinth.com/v2/search")) {
            modrinthCalls++
            const parsedUrl = new URL(u)
            const offset = Number(parsedUrl.searchParams.get("offset") || "0")
            const limit = Number(parsedUrl.searchParams.get("limit") || "10")

            const hits = Array.from({ length: limit }, (_, i) => ({
              project_id: `modrinth-item-${offset + i}`,
              title: `Modrinth Item ${offset + i}`,
              description: "Desc",
              author: "Author",
              downloads: 100,
              categories: ["technology"],
              project_type: "mod",
              client_side: "required",
              server_side: "required",
            }))

            return {
              ok: true,
              status: 200,
              json: async () => ({
                hits,
                total_hits: 250,
                offset,
                limit,
              }),
            }
          }
          return { ok: false, status: 404 }
        })

        // Request offset 120, limit 30 -> needs up to 150 items from Modrinth
        const res = await manager.searchMods(
          env,
          db,
          "tech",
          null,
          30,
          120,
          "MOD",
        )

        expect(res.items.length).toBe(30)
        expect(res.totalCount).toBeGreaterThanOrEqual(250)
        // Verified chunked queries were dispatched to fulfill the 150 items needed
        expect(modrinthCalls).toBeGreaterThanOrEqual(2)
      })
    })

    describe("9.5 DATA_PACK Manual Upload in GameFileService", () => {
      it("assigns datapacks/ logical path and NO_MODIFICABLE policy when category is DATA_PACK and logicalPath is null", async () => {
        const validZip = createSampleJarBuffer("PK\x03\x04Datapack Contents")
        const res = await addGameFile(
          db,
          {
            name: "custom_datapack.zip",
            category: "DATA_PACK",
            logicalPath: null,
            tokenHash: "token-hash-123",
          },
          adminUserId,
          env,
          {
            sha256: "sha256dp",
            sizeBytes: 1024,
            objectKey: "game-files/dp1",
            originalFilename: "custom_datapack.zip",
          },
        )

        expect(res.logicalPath).toBe("datapacks/custom_datapack.zip")
        expect(res.category).toBe("DATA_PACK")
        expect(res.effectivePolicy).toBe("NO_MODIFICABLE")
      })
    })
  })

  describe("10. Final Closure Hardening — Three Blocker Fixes", () => {
    describe("10.1 Content Type Authority for Root / Detail Modrinth", () => {
      it("/project without all_project_types, primary mod, with compatible 1.21.1 Data Pack version -> getProjectDetail succeeds for DATA_PACK", async () => {
        mockFetch.mockImplementation(async (url: string) => {
          const u = String(url)
          if (u.includes("/project/real-dp/version")) {
            return {
              ok: true,
              status: 200,
              json: async () => [
                {
                  id: "ver-dp-1",
                  project_id: "real-dp",
                  name: "Real DP 1.0",
                  version_number: "1.0.0",
                  game_versions: ["1.21.1"],
                  loaders: ["datapack"],
                  files: [{ primary: true, filename: "real-dp.zip", size: 1200, url: "https://cdn/real-dp.zip" }],
                  dependencies: [],
                },
              ],
            }
          }
          if (u.includes("/project/real-dp")) {
            return {
              ok: true,
              status: 200,
              json: async () => ({
                id: "real-dp",
                slug: "real-dp",
                title: "Real Data Pack",
                description: "A worldgen datapack",
                project_type: "mod", // primary type in Modrinth is mod!
                categories: ["worldgen"],
                // NO all_project_types
              }),
            }
          }
          return { ok: false, status: 404 }
        })

        const detail = await manager.getProjectDetail(
          env,
          db,
          "MODRINTH",
          "real-dp",
          "DATA_PACK",
        )

        expect(detail.projectId).toBe("real-dp")
        expect(detail.contentType).toBe("DATA_PACK")
        expect(detail.compatibleVersions.length).toBe(1)
        expect(detail.compatibleVersions[0]!.id).toBe("ver-dp-1")
      })

      it("/project without all_project_types, primary mod, with compatible 1.21.1 Data Pack version -> resolveInstallationPlan succeeds for DATA_PACK", async () => {
        mockFetch.mockImplementation(async (url: string) => {
          const u = String(url)
          if (u.includes("/project/real-dp/version")) {
            return {
              ok: true,
              status: 200,
              json: async () => [
                {
                  id: "ver-dp-1",
                  project_id: "real-dp",
                  name: "Real DP 1.0",
                  version_number: "1.0.0",
                  game_versions: ["1.21.1"],
                  loaders: ["datapack"],
                  files: [{ primary: true, filename: "real-dp.zip", size: 1200, url: "https://cdn/real-dp.zip" }],
                  dependencies: [],
                },
              ],
            }
          }
          if (u.includes("/project/real-dp")) {
            return {
              ok: true,
              status: 200,
              json: async () => ({
                id: "real-dp",
                slug: "real-dp",
                title: "Real Data Pack",
                description: "A worldgen datapack",
                project_type: "mod",
                categories: ["worldgen"],
              }),
            }
          }
          return { ok: false, status: 404 }
        })

        const plan = await manager.resolveServerInstallationPlan(env, db, {
          provider: "MODRINTH",
          projectId: "real-dp",
          versionId: "ver-dp-1",
          contentType: "DATA_PACK",
        })

        expect(plan.isValid).toBe(true)
        expect(plan.items.length).toBe(1)
        expect(plan.items[0]!.contentType).toBe("DATA_PACK")
        expect(plan.items[0]!.targetPath).toBe("world/datapacks/real-dp.zip")
      })

      it("rejects when requesting DATA_PACK but available versions for current Minecraft version are only MOD", async () => {
        mockFetch.mockImplementation(async (url: string) => {
          const u = String(url)
          if (u.includes("/project/only-mod/version")) {
            return {
              ok: true,
              status: 200,
              json: async () => [
                {
                  id: "ver-mod-1",
                  project_id: "only-mod",
                  name: "Only Mod 1.0",
                  version_number: "1.0.0",
                  game_versions: ["1.21.1"],
                  loaders: ["neoforge"],
                  files: [{ primary: true, filename: "only-mod.jar", size: 5000, url: "https://cdn/only-mod.jar" }],
                  dependencies: [],
                },
              ],
            }
          }
          if (u.includes("/project/only-mod")) {
            return {
              ok: true,
              status: 200,
              json: async () => ({
                id: "only-mod",
                slug: "only-mod",
                title: "Only Mod",
                description: "Only Mod Project",
                project_type: "mod",
                categories: ["technology"],
              }),
            }
          }
          return { ok: false, status: 404 }
        })

        await expect(
          manager.getProjectDetail(env, db, "MODRINTH", "only-mod", "DATA_PACK"),
        ).rejects.toThrow(/no es compatible con el tipo solicitado \(DATA_PACK\)/)

        await expect(
          manager.resolveServerInstallationPlan(env, db, {
            provider: "MODRINTH",
            projectId: "only-mod",
            versionId: "ver-mod-1",
            contentType: "DATA_PACK",
          }),
        ).rejects.toThrow(/no es compatible con el tipo solicitado \(DATA_PACK\)/)
      })

      it("hybrid MOD + DATA_PACK project resolves and segregates versions for both types", async () => {
        mockFetch.mockImplementation(async (url: string) => {
          const u = String(url)
          if (u.includes("/project/hybrid/version")) {
            return {
              ok: true,
              status: 200,
              json: async () => [
                {
                  id: "ver-mod",
                  project_id: "hybrid",
                  name: "Hybrid Mod",
                  version_number: "1.0-mod",
                  game_versions: ["1.21.1"],
                  loaders: ["neoforge"],
                  files: [{ primary: true, filename: "hybrid.jar", size: 5000, url: "https://cdn/hybrid.jar" }],
                  dependencies: [],
                },
                {
                  id: "ver-dp",
                  project_id: "hybrid",
                  name: "Hybrid DP",
                  version_number: "1.0-dp",
                  game_versions: ["1.21.1"],
                  loaders: ["datapack"],
                  files: [{ primary: true, filename: "hybrid.zip", size: 1000, url: "https://cdn/hybrid.zip" }],
                  dependencies: [],
                },
              ],
            }
          }
          if (u.includes("/project/hybrid")) {
            return {
              ok: true,
              status: 200,
              json: async () => ({
                id: "hybrid",
                slug: "hybrid",
                title: "Hybrid Project",
                description: "Hybrid Mod and Datapack",
                project_type: "mod",
                categories: ["worldgen"],
              }),
            }
          }
          return { ok: false, status: 404 }
        })

        // Request as MOD
        const modDetail = await manager.getProjectDetail(env, db, "MODRINTH", "hybrid", "MOD")
        expect(modDetail.contentType).toBe("MOD")
        expect(modDetail.compatibleVersions.length).toBe(1)
        expect(modDetail.compatibleVersions[0]!.id).toBe("ver-mod")

        // Request as DATA_PACK
        const dpDetail = await manager.getProjectDetail(env, db, "MODRINTH", "hybrid", "DATA_PACK")
        expect(dpDetail.contentType).toBe("DATA_PACK")
        expect(dpDetail.compatibleVersions.length).toBe(1)
        expect(dpDetail.compatibleVersions[0]!.id).toBe("ver-dp")
      })
    })

    describe("10.2 INCOMPATIBLE with versionId without projectId", () => {
      it("versionId-only incompatible + exact version installed in draft -> conflict", async () => {
        const draft = await prepareGameDraft(db, adminUserId)
        await db.insert(schema.gameReleaseFiles).values({
          id: crypto.randomUUID(),
          releaseId: draft.id,
          name: "incompat-target.jar",
          logicalPath: "mods/incompat-target.jar",
          category: "MOD",
          sha256: "sha256target",
          sizeBytes: 2000,
          isDirectory: 0,
          sourceProvider: "MODRINTH",
          sourceProjectId: "target-proj-123",
          sourceVersionId: "ver-target-bad",
          createdAt: new Date().toISOString(),
        })

        mockFetch.mockImplementation(async (url: string) => {
          const u = String(url)
          if (u.includes("/project/root-with-incompat/version")) {
            return {
              ok: true,
              status: 200,
              json: async () => [
                {
                  id: "ver-root-1",
                  project_id: "root-with-incompat",
                  name: "Root 1.0",
                  version_number: "1.0.0",
                  game_versions: ["1.21.1"],
                  loaders: ["neoforge"],
                  dependencies: [
                    // INCOMPATIBLE with only version_id provided (project_id null)
                    {
                      project_id: null,
                      version_id: "ver-target-bad",
                      dependency_type: "incompatible",
                    },
                  ],
                  files: [{ primary: true, filename: "root.jar", size: 1000, url: "https://cdn/root.jar" }],
                },
              ],
            }
          }
          if (u.includes("/version/ver-target-bad")) {
            return {
              ok: true,
              status: 200,
              json: async () => ({
                id: "ver-target-bad",
                project_id: "target-proj-123",
                name: "Target Bad 1.0",
                version_number: "1.0.0",
                game_versions: ["1.21.1"],
                loaders: ["neoforge"],
                files: [{ primary: true, filename: "incompat-target.jar", size: 2000, url: "https://cdn/incompat-target.jar" }],
              }),
            }
          }
          if (u.includes("/project/root-with-incompat")) {
            return {
              ok: true,
              status: 200,
              json: async () => ({ id: "root-with-incompat", title: "Root With Incompat", project_type: "mod" }),
            }
          }
          return { ok: false, status: 404 }
        })

        const plan = await manager.resolveInstallationPlan(env, db, {
          provider: "MODRINTH",
          projectId: "root-with-incompat",
          versionId: "ver-root-1",
          contentType: "MOD",
        })

        expect(plan.isValid).toBe(false)
        expect(plan.conflicts.length).toBe(1)
        expect(plan.conflicts[0]).toContain('declara incompatibilidad con la versión instalada de "incompat-target.jar"')
      })

      it("versionId-only incompatible + different version installed in draft -> valid (no conflict)", async () => {
        const draft = await prepareGameDraft(db, adminUserId)
        // Install a DIFFERENT version (ver-target-good) in draft
        await db.insert(schema.gameReleaseFiles).values({
          id: crypto.randomUUID(),
          releaseId: draft.id,
          name: "incompat-target.jar",
          logicalPath: "mods/incompat-target.jar",
          category: "MOD",
          sha256: "sha256targetgood",
          sizeBytes: 2000,
          isDirectory: 0,
          sourceProvider: "MODRINTH",
          sourceProjectId: "target-proj-123",
          sourceVersionId: "ver-target-good",
          createdAt: new Date().toISOString(),
        })

        mockFetch.mockImplementation(async (url: string) => {
          const u = String(url)
          if (u.includes("/project/root-with-incompat/version")) {
            return {
              ok: true,
              status: 200,
              json: async () => [
                {
                  id: "ver-root-1",
                  project_id: "root-with-incompat",
                  name: "Root 1.0",
                  version_number: "1.0.0",
                  game_versions: ["1.21.1"],
                  loaders: ["neoforge"],
                  dependencies: [
                    {
                      project_id: null,
                      version_id: "ver-target-bad",
                      dependency_type: "incompatible",
                    },
                  ],
                  files: [{ primary: true, filename: "root.jar", size: 1000, url: "https://cdn/root.jar" }],
                },
              ],
            }
          }
          if (u.includes("/version/ver-target-bad")) {
            return {
              ok: true,
              status: 200,
              json: async () => ({
                id: "ver-target-bad",
                project_id: "target-proj-123",
                name: "Target Bad 1.0",
                version_number: "1.0.0",
                game_versions: ["1.21.1"],
                loaders: ["neoforge"],
                files: [{ primary: true, filename: "incompat-target.jar", size: 2000, url: "https://cdn/incompat-target.jar" }],
              }),
            }
          }
          if (u.includes("/project/root-with-incompat")) {
            return {
              ok: true,
              status: 200,
              json: async () => ({ id: "root-with-incompat", title: "Root With Incompat", project_type: "mod" }),
            }
          }
          return { ok: false, status: 404 }
        })

        const plan = await manager.resolveInstallationPlan(env, db, {
          provider: "MODRINTH",
          projectId: "root-with-incompat",
          versionId: "ver-root-1",
          contentType: "MOD",
        })

        expect(plan.isValid).toBe(true)
        expect(plan.conflicts.length).toBe(0)
      })

      it("versionId-only incompatible + exact version included by another branch of plan -> conflict", async () => {
        mockFetch.mockImplementation(async (url: string) => {
          const u = String(url)
          if (u.includes("/project/root-branch-a/version")) {
            return {
              ok: true,
              status: 200,
              json: async () => [
                {
                  id: "ver-root-a",
                  project_id: "root-branch-a",
                  name: "Root A",
                  version_number: "1.0.0",
                  game_versions: ["1.21.1"],
                  loaders: ["neoforge"],
                  dependencies: [
                    { project_id: "shared-dep", dependency_type: "required" },
                    // Incompatible with the exact version of shared-dep that will be resolved
                    { project_id: null, version_id: "ver-shared-bad", dependency_type: "incompatible" },
                  ],
                  files: [{ primary: true, filename: "root-a.jar", size: 1000, url: "https://cdn/root-a.jar" }],
                },
              ],
            }
          }
          if (u.includes("/project/shared-dep/version")) {
            return {
              ok: true,
              status: 200,
              json: async () => [
                {
                  id: "ver-shared-bad",
                  project_id: "shared-dep",
                  name: "Shared Dep",
                  version_number: "1.0.0",
                  game_versions: ["1.21.1"],
                  loaders: ["neoforge"],
                  dependencies: [],
                  files: [{ primary: true, filename: "shared.jar", size: 1000, url: "https://cdn/shared.jar" }],
                },
              ],
            }
          }
          if (u.includes("/version/ver-shared-bad")) {
            return {
              ok: true,
              status: 200,
              json: async () => ({
                id: "ver-shared-bad",
                project_id: "shared-dep",
                name: "Shared Dep",
                version_number: "1.0.0",
                game_versions: ["1.21.1"],
                loaders: ["neoforge"],
                files: [{ primary: true, filename: "shared.jar", size: 1000, url: "https://cdn/shared.jar" }],
              }),
            }
          }
          if (u.includes("/project/root-branch-a")) {
            return { ok: true, status: 200, json: async () => ({ id: "root-branch-a", title: "Root Branch A", project_type: "mod" }) }
          }
          if (u.includes("/project/shared-dep")) {
            return { ok: true, status: 200, json: async () => ({ id: "shared-dep", title: "Shared Dep", project_type: "mod" }) }
          }
          return { ok: false, status: 404 }
        })

        const plan = await manager.resolveInstallationPlan(env, db, {
          provider: "MODRINTH",
          projectId: "root-branch-a",
          versionId: "ver-root-a",
          contentType: "MOD",
        })

        expect(plan.isValid).toBe(false)
        expect(plan.conflicts.length).toBe(1)
        expect(plan.conflicts[0]).toContain('declara incompatibilidad con la versión seleccionada de "Shared Dep"')
      })

      it("same projectId in a different provider -> NO conflict", async () => {
        const draft = await prepareGameDraft(db, adminUserId)
        // Install in DRAFT from CURSEFORGE with sourceProjectId "shared-id-123"
        await db.insert(schema.gameReleaseFiles).values({
          id: crypto.randomUUID(),
          releaseId: draft.id,
          name: "cf-mod.jar",
          logicalPath: "mods/cf-mod.jar",
          category: "MOD",
          sha256: "sha256cf",
          sizeBytes: 2000,
          isDirectory: 0,
          sourceProvider: "CURSEFORGE",
          sourceProjectId: "shared-id-123",
          sourceFileId: "99999",
          createdAt: new Date().toISOString(),
        })

        // Modrinth root mod declares incompatibility with Modrinth project "shared-id-123"
        mockFetch.mockImplementation(async (url: string) => {
          const u = String(url)
          if (u.includes("/project/mr-root/version")) {
            return {
              ok: true,
              status: 200,
              json: async () => [
                {
                  id: "ver-mr-root",
                  project_id: "mr-root",
                  name: "MR Root",
                  version_number: "1.0.0",
                  game_versions: ["1.21.1"],
                  loaders: ["neoforge"],
                  dependencies: [
                    { project_id: "shared-id-123", dependency_type: "incompatible" },
                  ],
                  files: [{ primary: true, filename: "mr-root.jar", size: 1000, url: "https://cdn/mr-root.jar" }],
                },
              ],
            }
          }
          if (u.includes("/project/mr-root")) {
            return { ok: true, status: 200, json: async () => ({ id: "mr-root", title: "MR Root", project_type: "mod" }) }
          }
          return { ok: false, status: 404 }
        })

        const plan = await manager.resolveInstallationPlan(env, db, {
          provider: "MODRINTH",
          projectId: "mr-root",
          versionId: "ver-mr-root",
          contentType: "MOD",
        })

        // No conflict because the installed file is CURSEFORGE, whereas the incompatibility is MODRINTH
        expect(plan.isValid).toBe(true)
        expect(plan.conflicts.length).toBe(0)
      })
    })

    describe("10.3 MOD Compatible Strictly Means NeoForge", () => {
      it("accepts version with NeoForge loader", async () => {
        const adapter = new ModrinthAdapter()
        mockFetch.mockImplementation(async (url: string) => {
          const u = String(url)
          if (u.includes("/project/test-loader/version")) {
            return {
              ok: true,
              status: 200,
              json: async () => [
                {
                  id: "ver-neo",
                  project_id: "test-loader",
                  name: "Neo Version",
                  version_number: "1.0",
                  game_versions: ["1.21.1"],
                  loaders: ["neoforge"],
                  files: [{ primary: true, filename: "neo.jar", size: 1000, url: "https://cdn/neo.jar" }],
                  dependencies: [],
                },
              ],
            }
          }
          return { ok: false, status: 404 }
        })

        const versions = await adapter.getCompatibleVersions(
          env,
          "test-loader",
          "1.21.1",
          "NeoForge",
          "MOD",
        )

        expect(versions.length).toBe(1)
        expect(versions[0]!.id).toBe("ver-neo")
      })

      it("filters out version if API returns Fabric even if request was NeoForge", async () => {
        const adapter = new ModrinthAdapter()
        mockFetch.mockImplementation(async (url: string) => {
          const u = String(url)
          if (u.includes("/project/test-loader/version")) {
            return {
              ok: true,
              status: 200,
              json: async () => [
                {
                  id: "ver-fabric",
                  project_id: "test-loader",
                  name: "Fabric Version",
                  version_number: "1.0",
                  game_versions: ["1.21.1"],
                  loaders: ["fabric"],
                  files: [{ primary: true, filename: "fabric.jar", size: 1000, url: "https://cdn/fabric.jar" }],
                  dependencies: [],
                },
              ],
            }
          }
          return { ok: false, status: 404 }
        })

        const versions = await adapter.getCompatibleVersions(
          env,
          "test-loader",
          "1.21.1",
          "NeoForge",
          "MOD",
        )

        expect(versions.length).toBe(0)
      })

      it("filters out Forge-only version", async () => {
        const adapter = new ModrinthAdapter()
        mockFetch.mockImplementation(async (url: string) => {
          const u = String(url)
          if (u.includes("/project/test-loader/version")) {
            return {
              ok: true,
              status: 200,
              json: async () => [
                {
                  id: "ver-forge",
                  project_id: "test-loader",
                  name: "Forge Version",
                  version_number: "1.0",
                  game_versions: ["1.21.1"],
                  loaders: ["forge"],
                  files: [{ primary: true, filename: "forge.jar", size: 1000, url: "https://cdn/forge.jar" }],
                  dependencies: [],
                },
              ],
            }
          }
          return { ok: false, status: 404 }
        })

        const versions = await adapter.getCompatibleVersions(
          env,
          "test-loader",
          "1.21.1",
          "NeoForge",
          "MOD",
        )

        expect(versions.length).toBe(0)
      })

      it("filters out version with empty loaders", async () => {
        const adapter = new ModrinthAdapter()
        mockFetch.mockImplementation(async (url: string) => {
          const u = String(url)
          if (u.includes("/project/test-loader/version")) {
            return {
              ok: true,
              status: 200,
              json: async () => [
                {
                  id: "ver-empty",
                  project_id: "test-loader",
                  name: "Empty Loaders Version",
                  version_number: "1.0",
                  game_versions: ["1.21.1"],
                  loaders: [],
                  files: [{ primary: true, filename: "empty.jar", size: 1000, url: "https://cdn/empty.jar" }],
                  dependencies: [],
                },
              ],
            }
          }
          return { ok: false, status: 404 }
        })

        const versions = await adapter.getCompatibleVersions(
          env,
          "test-loader",
          "1.21.1",
          "NeoForge",
          "MOD",
        )

        expect(versions.length).toBe(0)
      })

      it("accepts version with NeoForge + another loader (multi-loader)", async () => {
        const adapter = new ModrinthAdapter()
        mockFetch.mockImplementation(async (url: string) => {
          const u = String(url)
          if (u.includes("/project/test-loader/version")) {
            return {
              ok: true,
              status: 200,
              json: async () => [
                {
                  id: "ver-multi",
                  project_id: "test-loader",
                  name: "Multi Loader Version",
                  version_number: "1.0",
                  game_versions: ["1.21.1"],
                  loaders: ["neoforge", "fabric", "forge"],
                  files: [{ primary: true, filename: "multi.jar", size: 1000, url: "https://cdn/multi.jar" }],
                  dependencies: [],
                },
              ],
            }
          }
          return { ok: false, status: 404 }
        })

        const versions = await adapter.getCompatibleVersions(
          env,
          "test-loader",
          "1.21.1",
          "NeoForge",
          "MOD",
        )

        expect(versions.length).toBe(1)
        expect(versions[0]!.id).toBe("ver-multi")
      })
    })
  })

  describe("13. CurseForge Environment Selection, Fail-Closed Rules & Dependency Inheritance", () => {
    it("resolveInstallationPlan fails closed with conflict when CurseForge MOD has unknown environment and no override is provided", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        const u = String(url)
        if (u.includes("api.curseforge.com/v1/mods/555555/files")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: [
                {
                  id: 10001,
                  fileName: "cf-unknown.jar",
                  downloadUrl: "https://cdn/cf-unknown.jar",
                  gameVersions: ["1.21.1", "NeoForge"],
                  hashes: [{ algo: 1, value: "abcdef1234567890abcdef1234567890abcdef12" }],
                  dependencies: [],
                },
              ],
            }),
          }
        }
        if (u.includes("api.curseforge.com/v1/mods/555555")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ data: { id: 555555, name: "CF Unknown Mod", classId: 6 } }),
          }
        }
        return { ok: false, status: 404 }
      })

      const plan = await manager.resolveInstallationPlan(
        env,
        db,
        { provider: "CURSEFORGE", projectId: "555555", versionId: "10001", contentType: "MOD" },
      )

      expect(plan.isValid).toBe(false)
      expect(plan.conflicts.some((c) => c.includes("Se requiere especificar el entorno de ejecución"))).toBe(true)
    })

    it("resolveInstallationPlan applies CLIENT environmentOverride to root and inherits it to unknown CurseForge dependencies", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        const u = String(url)
        if (u.includes("api.curseforge.com/v1/mods/555555/files")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: [
                {
                  id: 10001,
                  fileName: "cf-root.jar",
                  downloadUrl: "https://cdn/cf-root.jar",
                  gameVersions: ["1.21.1", "NeoForge"],
                  hashes: [{ algo: 1, value: "abcdef1234567890abcdef1234567890abcdef12" }],
                  dependencies: [{ modId: 666666, relationType: 3 }], // Required dep
                },
              ],
            }),
          }
        }
        if (u.includes("api.curseforge.com/v1/mods/555555")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ data: { id: 555555, name: "CF Root Mod", classId: 6 } }),
          }
        }
        if (u.includes("api.curseforge.com/v1/mods/666666/files")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: [
                {
                  id: 20001,
                  fileName: "cf-dep.jar",
                  downloadUrl: "https://cdn/cf-dep.jar",
                  gameVersions: ["1.21.1", "NeoForge"],
                  hashes: [{ algo: 1, value: "1234567890abcdef1234567890abcdef12345678" }],
                  dependencies: [],
                },
              ],
            }),
          }
        }
        if (u.includes("api.curseforge.com/v1/mods/666666")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ data: { id: 666666, name: "CF Dep Mod", classId: 6 } }),
          }
        }
        return { ok: false, status: 404 }
      })

      const plan = await manager.resolveInstallationPlan(
        env,
        db,
        {
          provider: "CURSEFORGE",
          projectId: "555555",
          versionId: "10001",
          contentType: "MOD",
          environmentOverride: "CLIENT",
        },
      )

      expect(plan.isValid).toBe(true)
      expect(plan.conflicts).toHaveLength(0)
      expect(plan.items).toHaveLength(2)

      const rootItem = plan.items.find((i) => i.projectId === "555555")
      const depItem = plan.items.find((i) => i.projectId === "666666")

      expect(rootItem?.environment).toBe("CLIENT")
      expect(depItem?.environment).toBe("CLIENT")
    })

    it("resolveInstallationPlan applies BOTH environmentOverride to root and inherits it to unknown CurseForge dependencies", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        const u = String(url)
        if (u.includes("api.curseforge.com/v1/mods/777777/files")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: [
                {
                  id: 30001,
                  fileName: "cf-both-root.jar",
                  downloadUrl: "https://cdn/cf-both-root.jar",
                  gameVersions: ["1.21.1", "NeoForge"],
                  hashes: [{ algo: 1, value: "abcdef1234567890abcdef1234567890abcdef12" }],
                  dependencies: [{ modId: 888888, relationType: 3 }],
                },
              ],
            }),
          }
        }
        if (u.includes("api.curseforge.com/v1/mods/777777")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ data: { id: 777777, name: "CF Both Root", classId: 6 } }),
          }
        }
        if (u.includes("api.curseforge.com/v1/mods/888888/files")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: [
                {
                  id: 40001,
                  fileName: "cf-both-dep.jar",
                  downloadUrl: "https://cdn/cf-both-dep.jar",
                  gameVersions: ["1.21.1", "NeoForge"],
                  hashes: [{ algo: 1, value: "1234567890abcdef1234567890abcdef12345678" }],
                  dependencies: [],
                },
              ],
            }),
          }
        }
        if (u.includes("api.curseforge.com/v1/mods/888888")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ data: { id: 888888, name: "CF Both Dep", classId: 6 } }),
          }
        }
        return { ok: false, status: 404 }
      })

      const plan = await manager.resolveInstallationPlan(
        env,
        db,
        {
          provider: "CURSEFORGE",
          projectId: "777777",
          versionId: "30001",
          contentType: "MOD",
          environmentOverride: "BOTH",
        },
      )

      expect(plan.isValid).toBe(true)
      expect(plan.conflicts).toHaveLength(0)
      expect(plan.items).toHaveLength(2)

      const rootItem = plan.items.find((i) => i.projectId === "777777")
      const depItem = plan.items.find((i) => i.projectId === "888888")

      expect(rootItem?.environment).toBe("BOTH")
      expect(depItem?.environment).toBe("BOTH")
    })

    it("resolveInstallationPlan rejects SERVER environmentOverride with validation error", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        const u = String(url)
        if (u.includes("api.curseforge.com/v1/mods/555555/files")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: [
                {
                  id: 10001,
                  fileName: "cf-unknown.jar",
                  downloadUrl: "https://cdn/cf-unknown.jar",
                  gameVersions: ["1.21.1", "NeoForge"],
                  hashes: [{ algo: 1, value: "abcdef1234567890abcdef1234567890abcdef12" }],
                  dependencies: [],
                },
              ],
            }),
          }
        }
        if (u.includes("api.curseforge.com/v1/mods/555555")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ data: { id: 555555, name: "CF Unknown Mod", classId: 6 } }),
          }
        }
        return { ok: false, status: 404 }
      })

      await expect(
        manager.resolveInstallationPlan(
          env,
          db,
          {
            provider: "CURSEFORGE",
            projectId: "555555",
            versionId: "10001",
            contentType: "MOD",
            environmentOverride: "SERVER",
          },
        ),
      ).rejects.toThrow(/mods exclusivos de servidor/)
    })

    it("resolveServerInstallationPlan with environmentOverride BOTH flags requiresGameUpdate = true", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        const u = String(url)
        if (u.includes("api.curseforge.com/v1/mods/555555")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ data: { id: 555555, name: "CF Unknown Mod", classId: 6 } }),
          }
        }
        return { ok: false, status: 404 }
      })

      const plan = await manager.resolveServerInstallationPlan(
        env,
        db,
        {
          provider: "CURSEFORGE",
          projectId: "555555",
          versionId: "10001",
          contentType: "MOD",
          environmentOverride: "BOTH",
        },
      )

      expect(plan.isValid).toBe(false)
      expect(plan.requiresGameUpdate).toBe(true)
      expect(plan.gameUpdateReason).toContain("Juego → Actualizaciones")
    })

    it("resolveServerInstallationPlan with environmentOverride SERVER sets environment to SERVER and inherits to dependencies", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        const u = String(url)
        if (u.includes("api.curseforge.com/v1/mods/555555/files")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: [
                {
                  id: 10001,
                  fileName: "cf-server-root.jar",
                  downloadUrl: "https://cdn/cf-server-root.jar",
                  gameVersions: ["1.21.1", "NeoForge"],
                  hashes: [{ algo: 1, value: "abcdef1234567890abcdef1234567890abcdef12" }],
                  dependencies: [{ modId: 666666, relationType: 3 }],
                },
              ],
            }),
          }
        }
        if (u.includes("api.curseforge.com/v1/mods/555555")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ data: { id: 555555, name: "CF Server Root", classId: 6 } }),
          }
        }
        if (u.includes("api.curseforge.com/v1/mods/666666/files")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: [
                {
                  id: 20001,
                  fileName: "cf-server-dep.jar",
                  downloadUrl: "https://cdn/cf-server-dep.jar",
                  gameVersions: ["1.21.1", "NeoForge"],
                  hashes: [{ algo: 1, value: "1234567890abcdef1234567890abcdef12345678" }],
                  dependencies: [],
                },
              ],
            }),
          }
        }
        if (u.includes("api.curseforge.com/v1/mods/666666")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ data: { id: 666666, name: "CF Server Dep", classId: 6 } }),
          }
        }
        return { ok: false, status: 404 }
      })

      const plan = await manager.resolveServerInstallationPlan(
        env,
        db,
        {
          provider: "CURSEFORGE",
          projectId: "555555",
          versionId: "10001",
          contentType: "MOD",
          environmentOverride: "SERVER",
        },
      )

      expect(plan.isValid).toBe(true)
      expect(plan.conflicts).toHaveLength(0)
      expect(plan.requiresGameUpdate).toBe(false)
      expect(plan.items).toHaveLength(2)

      const rootItem = plan.items.find((i) => i.projectId === "555555")
      const depItem = plan.items.find((i) => i.projectId === "666666")

      expect(rootItem?.environment).toBe("SERVER")
      expect(depItem?.environment).toBe("SERVER")
    })
  })
})
