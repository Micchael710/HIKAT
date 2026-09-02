import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  getGameEnvironmentCatalog,
  getLoaderVersions,
  validateGameEnvironment,
  clearGameEnvironmentCache,
} from "./gameEnvironmentService"

describe("GameEnvironmentService - Multi-Loader System Tests", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    clearGameEnvironmentCache()
  })

  describe("1. Catalog & Loaders", () => {
    it("returns supported mod loaders and version lists in catalog", async () => {
      const catalog = await getGameEnvironmentCatalog()
      expect(catalog.loaders).toEqual(["VANILLA", "NEOFORGE", "FORGE", "FABRIC", "QUILT"])
      expect(catalog.minecraftVersions).toBeInstanceOf(Array)
      expect(catalog.minecraftVersions.length).toBeGreaterThan(0)
      expect(catalog.minecraftVersions).toContain("1.21.1")
      expect(catalog.minecraftVersions).toContain("1.20.1")
    })

    it("returns empty versions array for VANILLA loader", async () => {
      const versions = await getLoaderVersions("1.21.1", "VANILLA")
      expect(versions).toEqual([])
    })

    it("resolves Fabric loader versions from API", async () => {
      const mockFabricVersions = [
        { loader: { version: "0.16.10", stable: true } },
        { loader: { version: "0.16.9", stable: true } },
        { loader: { version: "0.17.0-beta.1", stable: false } },
      ]
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(mockFabricVersions), { status: 200 }),
      )

      const versions = await getLoaderVersions("1.21.1", "FABRIC")
      expect(versions).toHaveLength(3)
      expect(versions[0]).toEqual({ version: "0.16.10", stable: true })
      expect(versions[2]).toEqual({ version: "0.17.0-beta.1", stable: false })
    })

    it("resolves Quilt loader versions from API", async () => {
      const mockQuiltVersions = [
        { loader: { version: "0.27.0", stable: true } },
        { loader: { version: "0.26.3", stable: true } },
      ]
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(mockQuiltVersions), { status: 200 }),
      )

      const versions = await getLoaderVersions("1.21.1", "QUILT")
      expect(versions).toHaveLength(2)
      expect(versions[0]).toEqual({ version: "0.27.0", stable: true })
    })
  })

  describe("2. Combination Validation Invariants", () => {
    it("accepts valid VANILLA environment without loader version", async () => {
      await expect(validateGameEnvironment("1.21.1", "VANILLA", null)).resolves.not.toThrow()
    })

    it("rejects VANILLA if loader version is mistakenly supplied", async () => {
      await expect(validateGameEnvironment("1.21.1", "VANILLA", "21.1.65")).rejects.toThrow(
        /VANILLA no tiene versión de mod loader/i,
      )
    })

    it("rejects non-vanilla mod loader with empty version", async () => {
      await expect(validateGameEnvironment("1.21.1", "NEOFORGE", "")).rejects.toThrow(
        /no puede estar vacía/i,
      )
    })

    it("rejects invalid Minecraft version", async () => {
      await expect(validateGameEnvironment("99.99.99", "VANILLA", null)).rejects.toThrow(
        /no es una versión oficial/i,
      )
    })

    it("fails closed when official Minecraft source is unreachable", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Network connection failed"))
      await expect(validateGameEnvironment("1.21.1", "VANILLA", null)).rejects.toThrow(
        /No se pudo verificar la versión de Minecraft con la fuente oficial/i,
      )
    })

    it("fails closed when official loader source is unreachable", async () => {
      // First fetch succeeds for Mojang manifest, second fetch fails for Fabric API
      const mockManifest = {
        versions: [{ id: "1.21.1", type: "release" }],
      }
      vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(new Response(JSON.stringify(mockManifest), { status: 200 }))
        .mockRejectedValueOnce(new Error("Fabric meta API timeout"))

      await expect(validateGameEnvironment("1.21.1", "FABRIC", "0.16.10")).rejects.toThrow(
        /No se pudo verificar la versión de FABRIC con la fuente oficial/i,
      )
    })
  })
})

