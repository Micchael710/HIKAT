import { describe, it, expect } from "vitest"

import {
  HIKAT_APP_NAME,
  HIKAT_VERSION,
  ALLOWED_ROLES,
  ALLOWED_AUTH_PROVIDERS,
} from "./index"

describe("@hikat/shared foundation", () => {
  it("exports valid core constants", () => {
    expect(HIKAT_APP_NAME).toBe("HiKAT")
    expect(HIKAT_VERSION).toBe("0.1.0")
  })

  it("exports valid roles and external providers", () => {
    expect(ALLOWED_ROLES).toEqual(["PLAYER", "ADMIN"])
    expect(ALLOWED_AUTH_PROVIDERS).toEqual(["GOOGLE", "DISCORD"])
  })
})
