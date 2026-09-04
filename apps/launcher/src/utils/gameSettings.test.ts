import { describe, it, expect } from "vitest"
import { calculateAutomaticRam, formatModLoaderName } from "./gameSettings"

describe("Game Settings Utilities Suite", () => {
  describe("calculateAutomaticRam", () => {
    it("1. Calculates correct automatic RAM without admin recommendation", () => {
      expect(calculateAutomaticRam(4)).toBe(2)
      expect(calculateAutomaticRam(8)).toBe(4)
      expect(calculateAutomaticRam(12)).toBe(6)
      expect(calculateAutomaticRam(16)).toBe(8)
      expect(calculateAutomaticRam(32)).toBe(8)
      expect(calculateAutomaticRam(64)).toBe(8)
    })

    it("2. Respects optional admin recommendation within safeMax limits", () => {
      // 8 GB total -> safeMax is 4 GB
      expect(calculateAutomaticRam(8, 8)).toBe(4)

      // 12 GB total -> safeMax is 6 GB
      expect(calculateAutomaticRam(12, 8)).toBe(6)

      // 16 GB total -> safeMax is 8 GB
      expect(calculateAutomaticRam(16, 8)).toBe(8)

      // 32 GB total -> safeMax is 16 GB, rec 8 -> 8
      expect(calculateAutomaticRam(32, 8)).toBe(8)

      // 32 GB total -> safeMax is 16 GB, rec 12 -> 12
      expect(calculateAutomaticRam(32, 12)).toBe(12)

      // 32 GB total -> rec 24 exceeds safeMax 16 -> clamped to 16
      expect(calculateAutomaticRam(32, 24)).toBe(16)

      // 4 GB total -> safeMax is 2 GB, rec 1 -> minimum clamped to 2
      expect(calculateAutomaticRam(4, 1)).toBe(2)
    })
  })

  describe("formatModLoaderName", () => {
    it("formats various loader identifiers correctly", () => {
      expect(formatModLoaderName("NEOFORGE")).toBe("NeoForge")
      expect(formatModLoaderName("FORGE")).toBe("Forge")
      expect(formatModLoaderName("FABRIC")).toBe("Fabric")
      expect(formatModLoaderName("QUILT")).toBe("Quilt")
      expect(formatModLoaderName("VANILLA")).toBe("Vanilla")
      expect(formatModLoaderName("")).toBe("")
      expect(formatModLoaderName(undefined)).toBe("")
      expect(formatModLoaderName(null)).toBe("")
    })
  })
})
