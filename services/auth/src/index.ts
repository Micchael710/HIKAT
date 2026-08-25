import { HIKAT_VERSION } from "@hikat/shared";

export interface Env {
  // Bindings will be added in authentication shard (OAuth secrets, JWT keys, etc.)
  ENVIRONMENT?: string;
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health" || url.pathname === "/") {
      return new Response(
        JSON.stringify({
          status: "ok",
          service: "hikat-auth",
          version: HIKAT_VERSION,
          timestamp: new Date().toISOString(),
        }),
        {
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    return new Response(
      JSON.stringify({
        error: "Not Found",
        message:
          "HiKAT Auth Worker shell active. Authentication endpoints will be implemented in subsequent phase.",
      }),
      {
        status: 404,
        headers: { "Content-Type": "application/json" },
      },
    );
  },
};
