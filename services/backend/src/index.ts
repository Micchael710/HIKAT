import { createYoga, createSchema } from "graphql-yoga"
import { typeDefs, DateTimeScalar } from "@hikat/graphql"
import { HIKAT_VERSION } from "@hikat/shared"
import { createDatabase, Database } from "@hikat/database"

export interface Env {
  ENVIRONMENT?: string
  DB?: D1Database
  ASSETS?: R2Bucket
}

export interface GraphQLContext {
  env: Env
  db?: Database
}

export const yoga = createYoga<GraphQLContext>({
  graphqlEndpoint: "/graphql",
  schema: createSchema({
    typeDefs,
    resolvers: {
      DateTime: DateTimeScalar,
      Query: {
        health: () => ({
          status: "ok",
          service: "hikat-backend",
          version: HIKAT_VERSION,
          timestamp: new Date().toISOString(),
        }),
        version: () => HIKAT_VERSION,
      },
    },
  }),
})

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url)

    // Minimal REST health check fallback
    if (url.pathname === "/health") {
      return new Response(
        JSON.stringify({
          status: "ok",
          service: "hikat-backend",
          version: HIKAT_VERSION,
          timestamp: new Date().toISOString(),
        }),
        {
          headers: { "Content-Type": "application/json" },
        },
      )
    }

    const db = env.DB ? createDatabase(env.DB) : undefined

    return yoga.fetch(request, { env, db })
  },
}
