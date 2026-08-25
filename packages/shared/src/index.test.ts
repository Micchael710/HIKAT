import { describe, it, expect } from "vitest";
import { HIKAT_APP_NAME, HIKAT_VERSION, ServiceHealth } from "./index";

describe("@hikat/shared foundation", () => {
  it("exports application constants", () => {
    expect(HIKAT_APP_NAME).toBe("HiKAT");
    expect(HIKAT_VERSION).toBe("0.1.0");
  });

  it("allows constructing a valid ServiceHealth object", () => {
    const health: ServiceHealth = {
      status: "ok",
      service: "test-service",
      version: HIKAT_VERSION,
      timestamp: new Date().toISOString(),
    };
    expect(health.status).toBe("ok");
    expect(health.service).toBe("test-service");
  });
});
