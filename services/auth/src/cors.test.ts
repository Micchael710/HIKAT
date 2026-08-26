import { describe, it, expect } from "vitest"
import { getCorsHeaders, handleOptionsRequest } from "./cors"
import { MockEmailService } from "./services/email"
import { createDevKeyManager } from "./crypto/jwt"
import { handleRequest } from "./routes"
import { createDatabase } from "@hikat/database"
import { createTestD1 } from "@hikat/database/testUtils"

describe("HiKAT Auth Worker CORS Security", () => {
  const devEnv = { ENVIRONMENT: "development" }
  const prodEnv = { ENVIRONMENT: "production" }

  it("permits OPTIONS preflight from http://localhost:5174 in development", () => {
    const req = new Request("http://localhost:8788/auth/login", {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:5174",
        "Access-Control-Request-Method": "POST",
      },
    })

    const res = handleOptionsRequest(req, devEnv)
    expect(res.status).toBe(204)
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:5174")
    expect(res.headers.get("Access-Control-Allow-Credentials")).toBe("true")
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST")
    expect(res.headers.get("Vary")).toBe("Origin")
  })

  it("permits OPTIONS preflight from http://127.0.0.1:5174 in development", () => {
    const req = new Request("http://localhost:8788/auth/login", {
      method: "OPTIONS",
      headers: {
        Origin: "http://127.0.0.1:5174",
        "Access-Control-Request-Method": "POST",
      },
    })

    const res = handleOptionsRequest(req, devEnv)
    expect(res.status).toBe(204)
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("http://127.0.0.1:5174")
    expect(res.headers.get("Access-Control-Allow-Credentials")).toBe("true")
  })

  it("does NOT include Access-Control-Allow-Origin for unauthorized arbitrary origin", () => {
    const req = new Request("http://localhost:8788/auth/login", {
      method: "OPTIONS",
      headers: {
        Origin: "https://evil-site.com",
      },
    })

    const res = handleOptionsRequest(req, devEnv)
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull()
  })

  it("does NOT permit localhost origins in production unless explicitly configured", () => {
    const req = new Request("https://auth.hikat.org/auth/login", {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:5174",
      },
    })

    const res = handleOptionsRequest(req, prodEnv)
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull()

    // When explicitly configured in production
    const prodWithExplicit = {
      ENVIRONMENT: "production",
      CORS_ALLOW_ORIGIN: "https://custom-admin.example.com",
    }
    const reqExplicit = new Request("https://auth.hikat.org/auth/login", {
      method: "OPTIONS",
      headers: {
        Origin: "https://custom-admin.example.com",
      },
    })
    const resExplicit = handleOptionsRequest(reqExplicit, prodWithExplicit)
    expect(resExplicit.headers.get("Access-Control-Allow-Origin")).toBe("https://custom-admin.example.com")
  })

  it("permits official production origins in production (e.g. https://admin.hikat.org)", () => {
    const req = new Request("https://auth.hikat.org/auth/login", {
      method: "OPTIONS",
      headers: {
        Origin: "https://admin.hikat.org",
      },
    })

    const res = handleOptionsRequest(req, prodEnv)
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://admin.hikat.org")
    expect(res.headers.get("Access-Control-Allow-Credentials")).toBe("true")
  })

  it("preserves CORS headers on Auth error responses when origin is valid", async () => {
    const rawD1 = createTestD1()
    const db = createDatabase(rawD1)
    const keyManager = await createDevKeyManager()
    const emailService = new MockEmailService()

    // Request with missing password -> triggers 400 error response
    const req = new Request("http://localhost:8788/auth/login", {
      method: "POST",
      headers: {
        Origin: "http://localhost:5174",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email: "test@hikat.org" }),
    })

    const res = await handleRequest({
      request: req,
      env: devEnv,
      db,
      keyManager,
      emailService,
    })

    expect(res.status).toBe(400)
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:5174")
    expect(res.headers.get("Access-Control-Allow-Credentials")).toBe("true")
    expect(res.headers.get("Vary")).toBe("Origin")
  })
})
