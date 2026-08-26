import { describe, it, expect } from "vitest"
import { getCorsHeaders, handleOptionsRequest } from "./cors"

describe("HiKAT Backend CORS Security", () => {
  const devEnv = { ENVIRONMENT: "development" }
  const prodEnv = { ENVIRONMENT: "production" }

  it("permits OPTIONS preflight from http://localhost:5174 in development", () => {
    const req = new Request("http://localhost:8787/graphql", {
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
    expect(res.headers.get("Vary")).toBe("Origin")
  })

  it("permits OPTIONS preflight from http://127.0.0.1:5174 in development", () => {
    const req = new Request("http://localhost:8787/graphql", {
      method: "OPTIONS",
      headers: {
        Origin: "http://127.0.0.1:5174",
        "Access-Control-Request-Method": "POST",
      },
    })

    const res = handleOptionsRequest(req, devEnv)
    expect(res.status).toBe(204)
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("http://127.0.0.1:5174")
  })

  it("rejects unauthorized arbitrary origin by omitting Access-Control-Allow-Origin", () => {
    const req = new Request("http://localhost:8787/graphql", {
      method: "OPTIONS",
      headers: {
        Origin: "https://unauthorized-domain.com",
      },
    })

    const res = handleOptionsRequest(req, devEnv)
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull()
  })

  it("does NOT permit localhost in production unless explicitly configured", () => {
    const req = new Request("https://api.hikat.org/graphql", {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:5174",
      },
    })

    const res = handleOptionsRequest(req, prodEnv)
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull()
  })

  it("permits official production origin https://admin.hikat.org in production", () => {
    const req = new Request("https://api.hikat.org/graphql", {
      method: "OPTIONS",
      headers: {
        Origin: "https://admin.hikat.org",
      },
    })

    const res = handleOptionsRequest(req, prodEnv)
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://admin.hikat.org")
    expect(res.headers.get("Access-Control-Allow-Credentials")).toBe("true")
  })
})
