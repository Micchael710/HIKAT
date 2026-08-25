import { createYoga, createSchema } from "graphql-yoga";
import { typeDefs } from "@hikat/graphql";
import { HIKAT_VERSION } from "@hikat/shared";

export interface Env {
  // Bindings will be added in subsequent shards (D1, R2, etc.)
  ENVIRONMENT?: string;
}

export const yoga = createYoga<Env>({
  graphqlEndpoint: "/graphql",
  schema: createSchema({
    typeDefs,
    resolvers: {
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
});

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

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
      );
    }

    return yoga.fetch(request, env);
  },
};
