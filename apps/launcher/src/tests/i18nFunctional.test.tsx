import { describe, it, expect } from "vitest"
import { getTranslation, LanguageCode } from "../context/LanguageContext"
import { mapAuthErrorToKey } from "../utils/authErrorMapper"
import { AuthErrorCode } from "@hikat/shared"

describe("i18n Functional Resolution & Error Mapping Suite (ES, EN, PT, FR)", () => {
  const languages: LanguageCode[] = ["es", "en", "pt", "fr"]

  describe("1. mapAuthErrorToKey Mapping Tests", () => {
    it("maps USERNAME_ALREADY_EXISTS to profile.usernameTakenError", () => {
      expect(mapAuthErrorToKey(AuthErrorCode.USERNAME_ALREADY_EXISTS)).toBe("profile.usernameTakenError")
      expect(mapAuthErrorToKey("USERNAME_ALREADY_EXISTS")).toBe("profile.usernameTakenError")
    })

    it("maps INVALID_USERNAME to profile.usernameInvalidError", () => {
      expect(mapAuthErrorToKey(AuthErrorCode.INVALID_USERNAME)).toBe("profile.usernameInvalidError")
      expect(mapAuthErrorToKey("INVALID_USERNAME")).toBe("profile.usernameInvalidError")
    })

    it("maps INVALID_CREDENTIALS to auth.loginFailed", () => {
      expect(mapAuthErrorToKey(AuthErrorCode.INVALID_CREDENTIALS)).toBe("auth.loginFailed")
      expect(mapAuthErrorToKey("INVALID_CREDENTIALS")).toBe("auth.loginFailed")
    })

    it("maps EMAIL_NOT_VERIFIED to auth.emailNotVerifiedError", () => {
      expect(mapAuthErrorToKey(AuthErrorCode.EMAIL_NOT_VERIFIED)).toBe("auth.emailNotVerifiedError")
      expect(mapAuthErrorToKey("EMAIL_NOT_VERIFIED")).toBe("auth.emailNotVerifiedError")
    })

    it("maps USER_ALREADY_EXISTS to auth.emailConflictError", () => {
      expect(mapAuthErrorToKey(AuthErrorCode.USER_ALREADY_EXISTS)).toBe("auth.emailConflictError")
      expect(mapAuthErrorToKey("USER_ALREADY_EXISTS")).toBe("auth.emailConflictError")
    })

    it("maps OAuth/PKCE/State errors to auth.invalidOAuthAttempt", () => {
      expect(mapAuthErrorToKey(AuthErrorCode.INVALID_PKCE)).toBe("auth.invalidOAuthAttempt")
      expect(mapAuthErrorToKey(AuthErrorCode.INVALID_STATE)).toBe("auth.invalidOAuthAttempt")
      expect(mapAuthErrorToKey("OAUTH_CALLBACK_ERROR")).toBe("auth.invalidOAuthAttempt")
    })

    it("maps unknown or null errors to provided fallback", () => {
      expect(mapAuthErrorToKey(null, "auth.genericAuthError")).toBe("auth.genericAuthError")
      expect(mapAuthErrorToKey(undefined, "auth.loginFailed")).toBe("auth.loginFailed")
      expect(mapAuthErrorToKey("SOME_UNEXPECTED_ERROR", "auth.genericAuthError")).toBe("auth.genericAuthError")
    })
  })

  describe("2. Localized Error Message Resolution across ES, EN, PT, FR", () => {
    const criticalErrorKeys = [
      "profile.usernameTakenError",
      "profile.usernameInvalidError",
      "auth.loginFailed",
      "auth.emailNotVerifiedError",
      "auth.emailConflictError",
      "auth.invalidOAuthAttempt",
      "auth.genericAuthError",
      "auth.oauthInitError",
      "skins.skinDeleteError",
      "skins.capeDeleteError",
      "skins.invalidSkinDimensions",
      "skins.invalidCapeDimensions",
      "skins.invalidSkinType",
      "skins.invalidCapeType",
      "playButton.syncError",
      "playButton.verifyError",
      "playButton.uninstallError",
    ]

    it("renders valid localized text (no raw error codes or exception names) in all 4 locales", () => {
      for (const lang of languages) {
        for (const key of criticalErrorKeys) {
          const text = getTranslation(lang, key)
          expect(text, `Expected valid translation for '${key}' in '${lang}'`).toBeTruthy()
          expect(text).not.toBe(key)
          expect(text).not.toContain("USERNAME_ALREADY_EXISTS")
          expect(text).not.toContain("INVALID_USERNAME")
          expect(text).not.toContain("Error:")
          expect(text).not.toContain("Exception")
        }
      }
    })
  })

  describe("3. UI Chrome, Titlebar & Controls Localization across ES, EN, PT, FR", () => {
    const uiChromeKeys = [
      "titlebar.minimize",
      "titlebar.maximize",
      "titlebar.restore",
      "titlebar.close",
      "news.videoBadge",
      "skins.badgePersonal",
      "skins.customSkinName",
      "skins.customCapeName",
      "skins.noSkin",
      "skins.noCape",
      "skins.controls.changePose",
      "skins.controls.changeAnimation",
      "skins.controls.toggleRotate",
      "skins.controls.resetCamera",
      "skins.animations.idle",
      "skins.animations.walk",
      "skins.animations.run",
      "skins.animations.pose",
    ]

    it("renders non-empty localized strings for all UI controls in ES, EN, PT, FR", () => {
      for (const lang of languages) {
        for (const key of uiChromeKeys) {
          const text = getTranslation(lang, key)
          expect(text, `Expected valid translation for '${key}' in '${lang}'`).toBeTruthy()
          expect(text).not.toBe(key)
        }
      }
    })

    it("titlebar.minimize matches expected locale translations", () => {
      expect(getTranslation("es", "titlebar.minimize")).toBe("Minimizar")
      expect(getTranslation("en", "titlebar.minimize")).toBe("Minimize")
      expect(getTranslation("pt", "titlebar.minimize")).toBe("Minimizar")
      expect(getTranslation("fr", "titlebar.minimize")).toBe("Réduire")
    })

    it("titlebar.close matches expected locale translations", () => {
      expect(getTranslation("es", "titlebar.close")).toBe("Cerrar")
      expect(getTranslation("en", "titlebar.close")).toBe("Close")
      expect(getTranslation("pt", "titlebar.close")).toBe("Fechar")
      expect(getTranslation("fr", "titlebar.close")).toBe("Fermer")
    })

    it("skins.badgePersonal matches expected locale translations", () => {
      expect(getTranslation("es", "skins.badgePersonal")).toBe("PERSONAL")
      expect(getTranslation("en", "skins.badgePersonal")).toBe("PERSONAL")
      expect(getTranslation("pt", "skins.badgePersonal")).toBe("PESSOAL")
      expect(getTranslation("fr", "skins.badgePersonal")).toBe("PERSONNEL")
    })
  })
})
