import { describe, it, expect } from "vitest"

import worker from "./index"

describe("HiKAT Auth Service Worker", () => {
  it("responds to /health endpoint with ok status", async () => {
    const request = new Request("http://localhost/health")

    const env = {}

    const ctx = {} as ExecutionContext

    const response = await worker.fetch(request, env, ctx)

    expect(response.status).toBe(200)

    const json = (await response.json()) as {
      status: string

      service: string

      version?: string
    }

    expect(json.status).toBe("ok")

    expect(json.service).toBe("hikat-auth")

    expect(json.version).toBeDefined()
  })

  it("returns 404 for unimplemented endpoints in shell phase", async () => {
    const request = new Request("http://localhost/oauth/google")

    const env = {}

    const ctx = {} as ExecutionContext

    const response = await worker.fetch(request, env, ctx)

    expect(response.status).toBe(404)
  })
})
