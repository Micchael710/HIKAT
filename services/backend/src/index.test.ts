import { describe, it, expect } from "vitest"
import worker from "./index"

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
    }
    version?: string
  }
}

describe("HiKAT Backend Service Worker", () => {
  it("responds to /health endpoint", async () => {
    const request = new Request("http://localhost/health")
    const env = {}
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
        query: "{ health { status service } version }",
      }),
    })
    const env = {}
    const ctx = {} as ExecutionContext

    const response = await worker.fetch(request, env, ctx)
    expect(response.status).toBe(200)

    const json = (await response.json()) as GraphQLHealthResponse
    expect(json.data?.health?.status).toBe("ok")
    expect(json.data?.health?.service).toBe("hikat-backend")
    expect(json.data?.version).toBeDefined()
  })
})
