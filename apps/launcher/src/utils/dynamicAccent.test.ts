// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest"
import {
  extractDominantAccent,
  getDominantAccentSync,
  DEFAULT_NEUTRAL_ACCENT,
} from "./dynamicAccent"

describe("Dynamic Accent Extraction Utility", () => {
  beforeEach(() => {
    // Reset cache if needed
  })

  it("1. Returns default neutral accent when given empty or invalid input", async () => {
    const accent = await extractDominantAccent("")
    expect(accent.hex).toBe(DEFAULT_NEUTRAL_ACCENT.hex)
    expect(accent.r).toBe(DEFAULT_NEUTRAL_ACCENT.r)
    expect(accent.g).toBe(DEFAULT_NEUTRAL_ACCENT.g)
    expect(accent.b).toBe(DEFAULT_NEUTRAL_ACCENT.b)
  })

  it("2. Returns custom fallback when provided", async () => {
    const accent = await extractDominantAccent(null, "#ef4444")
    expect(accent.hex).toBe("#ef4444")
    expect(accent.r).toBe(239)
  })

  it("3. Synchronous lookup returns fallback on initial cache miss", () => {
    const syncAccent = getDominantAccentSync("https://unknown.url/pic.png", "#10b981")
    expect(syncAccent.hex).toBe("#10b981")
  })
})
