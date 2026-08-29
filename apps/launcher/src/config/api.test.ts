import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import {
  getApiBaseUrl,
  resolveApiAssetUrl,
  DEFAULT_DEV_API_BASE_URL,
  DEFAULT_PROD_API_BASE_URL,
} from "./api"

describe("Launcher API Configuration & URL Resolution Authority", () => {
  const originalEnv = { ...import.meta.env }

  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    // Restore import.meta.env
    Object.assign(import.meta.env, originalEnv)
  })

  it("1. Renderer dev without override resolves to local development backend (http://127.0.0.1:8787)", () => {
    delete (import.meta.env as any).VITE_API_URL
    delete (import.meta.env as any).VITE_BACKEND_API_URL
    ;(import.meta.env as any).DEV = true
    ;(import.meta.env as any).MODE = "development"

    const base = getApiBaseUrl()
    expect(base).toBe(DEFAULT_DEV_API_BASE_URL)
    expect(base).toBe("http://127.0.0.1:8787")
  })

  it("2. Renderer with explicit VITE_API_URL override uses the provided override", () => {
    ;(import.meta.env as any).VITE_API_URL = "http://192.168.1.100:8787"

    const base = getApiBaseUrl()
    expect(base).toBe("http://192.168.1.100:8787")
  })

  it("3. Packaged production build without override resolves to production API base", () => {
    delete (import.meta.env as any).VITE_API_URL
    delete (import.meta.env as any).VITE_BACKEND_API_URL
    ;(import.meta.env as any).DEV = false
    ;(import.meta.env as any).MODE = "production"

    const base = getApiBaseUrl()
    expect(base).toBe(DEFAULT_PROD_API_BASE_URL)
    expect(base).toBe("https://api.apparatia.net/api/v1")
  })

  it("4. Relative asset URL is resolved against the authoritative backend base URL", () => {
    delete (import.meta.env as any).VITE_API_URL
    delete (import.meta.env as any).VITE_BACKEND_API_URL
    ;(import.meta.env as any).DEV = true
    ;(import.meta.env as any).MODE = "development"

    const resolved = resolveApiAssetUrl("/media/content/skin-texture-123")
    expect(resolved).toBe("http://127.0.0.1:8787/media/content/skin-texture-123")

    const resolvedNoSlash = resolveApiAssetUrl("media/content/skin-texture-123")
    expect(resolvedNoSlash).toBe("http://127.0.0.1:8787/media/content/skin-texture-123")
  })

  it("5. Absolute URLs (HTTP, HTTPS, data, blob) are strictly preserved without double-prefixing", () => {
    expect(resolveApiAssetUrl("https://cdn.example.com/texture.png")).toBe(
      "https://cdn.example.com/texture.png",
    )
    expect(resolveApiAssetUrl("http://cdn.example.com/texture.png")).toBe(
      "http://cdn.example.com/texture.png",
    )
    expect(resolveApiAssetUrl("data:image/png;base64,iVBORw0KGgo=")).toBe(
      "data:image/png;base64,iVBORw0KGgo=",
    )
    expect(resolveApiAssetUrl("blob:http://localhost:8443/uuid")).toBe(
      "blob:http://localhost:8443/uuid",
    )
  })

  it("6. Empty, null, or undefined URLs safely resolve to empty string", () => {
    expect(resolveApiAssetUrl("")).toBe("")
    expect(resolveApiAssetUrl(null)).toBe("")
    expect(resolveApiAssetUrl(undefined)).toBe("")
    expect(resolveApiAssetUrl("   ")).toBe("")
  })
})
