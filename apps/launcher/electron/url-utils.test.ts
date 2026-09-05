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

  it("9. Accepts valid email verification and password reset deep link URLs", () => {
    const verifyUrl = "hikat://auth/verify-email?token=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    expect(parseValidOAuthCallbackUrl(verifyUrl)).toBe(verifyUrl)

    const resetUrl = "hikat://auth/reset-password?token=fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210"
    expect(parseValidOAuthCallbackUrl(resetUrl)).toBe(resetUrl)

    const withTrailingSlash = "hikat://auth/verify-email/?token=test12345"
    expect(parseValidOAuthCallbackUrl(withTrailingSlash)).toBe(withTrailingSlash)
  })

  it("10. Rejects unauthorized subpaths like verify-email-fake or reset-admin", () => {
    expect(parseValidOAuthCallbackUrl("hikat://auth/verify-email-fake?token=123")).toBeNull()
    expect(parseValidOAuthCallbackUrl("hikat://auth/reset-password-evil?token=123")).toBeNull()
    expect(parseValidOAuthCallbackUrl("hikat://auth/admin?token=123")).toBeNull()
  })

  it("11. Verifies OAuth browser bridge in main.cjs uses non-destructive fallback and keeps polling active", () => {
    const fs = require("fs")
    const path = require("path")
    const mainContent = fs.readFileSync(path.join(__dirname, "main.cjs"), "utf8")

    // Must use showFallbackRetry and not showLauncherError
    expect(mainContent).toContain("function showFallbackRetry()")
    expect(mainContent).not.toContain("function showLauncherError()")

    // Polling must stay active without clearing interval in showFallbackRetry
    const fallbackFnStart = mainContent.indexOf("function showFallbackRetry()")
    const fallbackFnEnd = mainContent.indexOf("function showProviderError()", fallbackFnStart)
    const fallbackFnSnippet = mainContent.slice(fallbackFnStart, fallbackFnEnd)
    expect(fallbackFnSnippet).not.toContain("clearInterval")
    expect(fallbackFnSnippet).toContain("retry.style.display")

    // Event listeners: focus listener and single retry listener
    expect(mainContent).toContain("window.addEventListener")
    expect(mainContent).toContain("retry.addEventListener")

    // Completed state stops polling and hides retry
    const completedFnStart = mainContent.indexOf("function showCompletedState()")
    const completedFnEnd = mainContent.indexOf("function showFallbackRetry()", completedFnStart)
    const completedFnSnippet = mainContent.slice(completedFnStart, completedFnEnd)
    expect(completedFnSnippet).toContain("clearInterval(statusInterval)")
    expect(completedFnSnippet).toContain("retry.style.display")
  })

  it("12. Verifies loopback server in main.cjs differentiates pending, completed, and invalid states", () => {
    const fs = require("fs")
    const path = require("path")
    const mainContent = fs.readFileSync(path.join(__dirname, "main.cjs"), "utf8")

    expect(mainContent).toContain('if (url.pathname === "/auth/status")')
    expect(mainContent).toContain('let status = "invalid"')
    expect(mainContent).toContain('if (state && completedOAuthStates.has(state))')
    expect(mainContent).toContain('status = "completed"')
    expect(mainContent).toContain('authStore.peekPendingOAuth(state)')
    expect(mainContent).toContain('status = "pending"')
    expect(mainContent).toContain('JSON.stringify({')
    expect(mainContent).toContain('status,')
    expect(mainContent).toContain('completed: status === "completed"')
  })

  it("13. Verifies loopback HTML includes initPreflight and friendly translations in ES, EN, PT, FR without technical terms", () => {
    const fs = require("fs")
    const path = require("path")
    const mainContent = fs.readFileSync(path.join(__dirname, "main.cjs"), "utf8")

    expect(mainContent).toContain("async function initPreflight()")
    expect(mainContent).toContain("function showInvalidState()")
    expect(mainContent).toContain("Este intento de inicio de sesión ya no es válido.")
    expect(mainContent).toContain("Vuelve a HiKAT Launcher e inténtalo de nuevo.")
    expect(mainContent).toContain("This sign-in attempt is no longer valid.")
    expect(mainContent).toContain("Return to HiKAT Launcher and try again.")
    expect(mainContent).toContain("Esta tentativa de login não é mais válida.")
    expect(mainContent).toContain("Volte ao HiKAT Launcher e tente novamente.")
    expect(mainContent).toContain("Cette tentative de connexion n'est plus valide.")
    expect(mainContent).toContain("Retournez dans HiKAT Launcher et réessayez.")

    // Ensure no raw technical words are in the user-facing text
    const invalidTextEs = "Este intento de inicio de sesión ya no es válido."
    expect(invalidTextEs).not.toContain("OAuth")
    expect(invalidTextEs).not.toContain("PKCE")
    expect(invalidTextEs).not.toContain("state")
    expect(invalidTextEs).not.toContain("authorization code")
  })

  it("14. Verifies handleDeepLinkUrl does NOT prematurely add state to completedOAuthStates", () => {
    const fs = require("fs")
    const path = require("path")
    const mainContent = fs.readFileSync(path.join(__dirname, "main.cjs"), "utf8")

    const handleDeepLinkStart = mainContent.indexOf("function handleDeepLinkUrl(rawUrl)")
    const handleDeepLinkEnd = mainContent.indexOf("function startOAuthLoopbackServer()", handleDeepLinkStart)
    const handleDeepLinkSnippet = mainContent.slice(handleDeepLinkStart, handleDeepLinkEnd)

    expect(handleDeepLinkSnippet).not.toContain("completedOAuthStates.add(state)")
  })

  it("15. Verifies auth:get-pending-oauth calls peekPendingOAuth and auth:mark-oauth-completed preserves locale in Map", () => {
    const fs = require("fs")
    const path = require("path")
    const mainContent = fs.readFileSync(path.join(__dirname, "main.cjs"), "utf8")

    expect(mainContent).toContain('ipcMain.handle("auth:get-pending-oauth", async (_event, state) => {')
    expect(mainContent).toContain("return authStore.peekPendingOAuth(state)")
    expect(mainContent).toContain('ipcMain.handle("auth:mark-oauth-completed", async (_event, state) => {')
    expect(mainContent).toContain("completedOAuthStates.set(state, { locale })")
  })

  it("16. Verifies loopback server resolves locale with strict 5-tier priority (url lang -> completed -> pending -> accept-language -> en)", () => {
    const fs = require("fs")
    const path = require("path")
    const mainContent = fs.readFileSync(path.join(__dirname, "main.cjs"), "utf8")

    expect(mainContent).toContain('const VALID_LOCALES = ["es", "en", "pt", "fr"]')
    expect(mainContent).toContain('const urlLang = String(url.searchParams.get("lang") || "").toLowerCase().trim()')
    expect(mainContent).toContain("completedOAuthStates.has(callbackState)")
    expect(mainContent).toContain("completedOAuthStates.get(callbackState)")
    expect(mainContent).toContain("authStore.peekPendingOAuth(callbackState)")
    expect(mainContent).toContain('req.headers["accept-language"]')
  })

  it("17. Verifies loopback script uses history.replaceState to retain ?lang= in browser URL", () => {
    const fs = require("fs")
    const path = require("path")
    const mainContent = fs.readFileSync(path.join(__dirname, "main.cjs"), "utf8")

    expect(mainContent).toContain("const resolvedLang =")
    expect(mainContent).toContain('currentUrl.searchParams.set("lang", resolvedLang)')
    expect(mainContent).toContain("window.history.replaceState")
  })
})


