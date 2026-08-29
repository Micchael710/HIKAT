import { describe, it, expect } from "vitest"
import { parseValidOAuthCallbackUrl } from "./url-utils.cjs"

describe("Electron OAuth Deep Link URL Validation Suite (Shard 8F)", () => {
  it("1. Accepts canonical valid OAuth callback URLs", () => {
    const valid1 = "hikat://auth/callback?code=abc12345&state=xyz98765"
    expect(parseValidOAuthCallbackUrl(valid1)).toBe(valid1)

    const validWithSlash = "hikat://auth/callback/?code=abc12345&state=xyz98765"
    expect(parseValidOAuthCallbackUrl(validWithSlash)).toBe(validWithSlash)

    const validWithTrim = "   hikat://auth/callback?code=abc12345&state=xyz98765   "
    expect(parseValidOAuthCallbackUrl(validWithTrim)).toBe("hikat://auth/callback?code=abc12345&state=xyz98765")
  })

  it("2. Strictly rejects invalid schemes / protocols", () => {
    expect(parseValidOAuthCallbackUrl("https://auth/callback?code=123&state=456")).toBeNull()
    expect(parseValidOAuthCallbackUrl("http://auth/callback?code=123&state=456")).toBeNull()
    expect(parseValidOAuthCallbackUrl("file:///callback?code=123")).toBeNull()
    expect(parseValidOAuthCallbackUrl("javascript:alert(1)")).toBeNull()
  })

  it("3. Strictly rejects invalid hosts", () => {
    expect(parseValidOAuthCallbackUrl("hikat://evil/callback?code=123&state=456")).toBeNull()
    expect(parseValidOAuthCallbackUrl("hikat://attacker.com/callback?code=123")).toBeNull()
    expect(parseValidOAuthCallbackUrl("hikat://auth.evil.com/callback?code=123")).toBeNull()
  })

  it("4. Strictly rejects invalid paths and sub-routes", () => {
    expect(parseValidOAuthCallbackUrl("hikat://auth/login?code=123")).toBeNull()
    expect(parseValidOAuthCallbackUrl("hikat://auth/callback/nested?code=123")).toBeNull()
    expect(parseValidOAuthCallbackUrl("hikat://auth/")).toBeNull()
    expect(parseValidOAuthCallbackUrl("hikat://auth")).toBeNull()
  })

  it("5. Strictly rejects prefix spoofing attacks like 'callback-evil'", () => {
    expect(parseValidOAuthCallbackUrl("hikat://auth/callback-evil?code=123&state=456")).toBeNull()
    expect(parseValidOAuthCallbackUrl("hikat://auth/callback_test?code=123")).toBeNull()
    expect(parseValidOAuthCallbackUrl("hikat://auth/callback.php?code=123")).toBeNull()
  })

  it("6. Handles empty, null, undefined, or malformed inputs without throwing", () => {
    expect(parseValidOAuthCallbackUrl("")).toBeNull()
    expect(parseValidOAuthCallbackUrl(null as any)).toBeNull()
    expect(parseValidOAuthCallbackUrl(undefined as any)).toBeNull()
    expect(parseValidOAuthCallbackUrl("not a url")).toBeNull()
    expect(parseValidOAuthCallbackUrl(12345 as any)).toBeNull()
  })

  it("7. Pending callback consume-once: first call returns URL and subsequent calls return null", () => {
    let pendingDeepLinkUrl: string | null = "hikat://auth/callback?code=abc12345&state=xyz98765"

    const consumeCallback = () => {
      const url = parseValidOAuthCallbackUrl(pendingDeepLinkUrl)
      pendingDeepLinkUrl = null
      return url
    }

    // First call consumes the URL
    expect(consumeCallback()).toBe("hikat://auth/callback?code=abc12345&state=xyz98765")
    // Second call returns null (consumed)
    expect(consumeCallback()).toBeNull()
    expect(pendingDeepLinkUrl).toBeNull()
  })

  it("8. Already-running delivery dispatches directly and leaves pending buffer empty (no replay)", () => {
    let pendingDeepLinkUrl: string | null = null
    const dispatchedEvents: string[] = []

    const mockMainWindow = {
      isDestroyed: () => false,
      webContents: {
        isLoading: () => false,
        send: (_channel: string, url: string) => {
          dispatchedEvents.push(url)
        },
      },
    }

    const handleDeepLink = (rawUrl: string) => {
      const validUrl = parseValidOAuthCallbackUrl(rawUrl)
      if (!validUrl) return

      if (
        mockMainWindow &&
        !mockMainWindow.isDestroyed() &&
        mockMainWindow.webContents &&
        !mockMainWindow.webContents.isLoading()
      ) {
        pendingDeepLinkUrl = null
        mockMainWindow.webContents.send("oauth:callback", validUrl)
      } else {
        pendingDeepLinkUrl = validUrl
      }
    }

    handleDeepLink("hikat://auth/callback?code=live123&state=live456")

    expect(dispatchedEvents).toHaveLength(1)
    expect(dispatchedEvents[0]).toBe("hikat://auth/callback?code=live123&state=live456")
    // Strict guarantee: pending buffer is NOT left with old callback
    expect(pendingDeepLinkUrl).toBeNull()
  })
})

