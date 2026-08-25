import { describe, it, expect } from "vitest"
import worker, { Env } from "./index"

interface HealthResponse {
  status: string
  service: string
  version?: string
}

interface GraphQLHealthResponse {
  data?: {
    health?: {
      status: string
      service: string
      timestamp: string
    }
    version?: string
  }
}

describe("HiKAT Backend Service Worker", () => {
  it("responds to /health endpoint", async () => {
    const request = new Request("http://localhost/health")
    const env: Env = {}
    const ctx = {} as ExecutionContext

    const response = await worker.fetch(request, env, ctx)
    expect(response.status).toBe(200)

    const json = (await response.json()) as HealthResponse
    expect(json.status).toBe("ok")
    expect(json.service).toBe("hikat-backend")
    expect(json.version).toBeDefined()
  })

  it("handles GraphQL queries on /graphql", async () => {
    const request = new Request("http://localhost/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: "{ health { status service timestamp } version }",
      }),
    })
    const env: Env = {}
    const ctx = {} as ExecutionContext

    const response = await worker.fetch(request, env, ctx)
    expect(response.status).toBe(200)

    const json = (await response.json()) as GraphQLHealthResponse
    expect(json.data?.health?.status).toBe("ok")
    expect(json.data?.health?.service).toBe("hikat-backend")
    expect(json.data?.health?.timestamp).toBeDefined()
    expect(json.data?.version).toBeDefined()
  })

  it("gracefully instantiates context with mock DB binding", async () => {
    const mockD1 = {} as D1Database
    const request = new Request("http://localhost/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: "{ version }",
      }),
    })
    const env: Env = { DB: mockD1 }
    const ctx = {} as ExecutionContext

    const response = await worker.fetch(request, env, ctx)
    expect(response.status).toBe(200)
    const json = (await response.json()) as GraphQLHealthResponse
    expect(json.data?.version).toBeDefined()
  })

  it("accepts typed ASSETS R2Bucket binding in Env without error", async () => {
    const mockR2 = {} as R2Bucket
    const mockD1 = {} as D1Database
    const request = new Request("http://localhost/health")
    const env: Env = { DB: mockD1, ASSETS: mockR2 }
    const ctx = {} as ExecutionContext

    const response = await worker.fetch(request, env, ctx)
    expect(response.status).toBe(200)
    const json = (await response.json()) as HealthResponse
    expect(json.status).toBe("ok")
  })
})
