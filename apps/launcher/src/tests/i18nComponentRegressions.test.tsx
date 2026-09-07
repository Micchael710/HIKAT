// @vitest-environment jsdom
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import React, { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { encode } from "fast-png"
import { LanguageProvider } from "../context/LanguageContext"
import LoginView from "../views/LoginView"
import ProfileView from "../views/ProfileView"
import SkinsView from "../views/SkinsView"
import { authService } from "../services/authService"
import { AuthErrorCode } from "@hikat/shared"

// Mock WebGL-dependent 3D preview components for jsdom
vi.mock("../components/minecraft/SkinViewer3D", () => ({
  default: () => <div data-testid="mock-skin-viewer-3d" />,
}))

vi.mock("../components/minecraft/SkinCardPreview", () => ({
  default: ({ alt }: { alt?: string }) => <div data-testid="mock-skin-card-preview" data-alt={alt} aria-label={alt} />,
}))

vi.mock("../components/minecraft/CapeCardPreview", () => ({
  default: ({ alt }: { alt?: string }) => <div data-testid="mock-cape-card-preview" data-alt={alt} aria-label={alt} />,
}))

function changeInput(input: HTMLInputElement, value: string) {
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set
  nativeInputValueSetter?.call(input, value)
  input.dispatchEvent(new Event("input", { bubbles: true }))
  input.dispatchEvent(new Event("change", { bubbles: true }))
}

describe("i18n Component Regressions & Error Rendering Test Suite", () => {
  let unmountCurrent: (() => void) | null = null

  beforeEach(() => {
    vi.restoreAllMocks()
    sessionStorage.clear()
    localStorage.clear()
    delete (window as any).electronAPI
  })

  afterEach(async () => {
    if (unmountCurrent) {
      unmountCurrent()
      unmountCurrent = null
    }
    document.body.innerHTML = ""
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  })

  async function renderComponent(ui: React.ReactElement, lang = "en") {
    localStorage.setItem("hikat_language", lang)
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(<LanguageProvider>{ui}</LanguageProvider>)
    })
    unmountCurrent = () => {
      act(() => {
        root.unmount()
      })
      container.remove()
    }
    return container
  }

  describe("1. LoginView: Technical error codes render localized copy and never raw codes", () => {
    it("renders localized login failure message in English when receiving INVALID_CREDENTIALS code", async () => {
      vi.spyOn(authService, "login").mockResolvedValueOnce({
        success: false,
        error: "INVALID_CREDENTIALS",
        code: AuthErrorCode.INVALID_CREDENTIALS,
      })

      const container = await renderComponent(<LoginView onLogin={vi.fn()} theme="dark" />, "en")

      const inputs = container.querySelectorAll("input")
      const emailInput = inputs[0]
      const passwordInput = inputs[1]

      await act(async () => {
        changeInput(emailInput, "player@example.com")
        changeInput(passwordInput, "wrongpassword")
      })

      const submitBtn = Array.from(container.querySelectorAll("button")).find(
        (b) => b.classList.contains("launcher-btn-primary") && b.textContent?.includes("Sign In"),
      )
      expect(submitBtn).toBeDefined()

      await act(async () => {
        submitBtn?.click()
      })
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50))
      })

      expect(container.textContent).toContain("Could not sign in. Please check your credentials.")
      expect(container.textContent).not.toContain("INVALID_CREDENTIALS")
      expect(container.textContent).not.toContain("No se pudo iniciar sesión")
    })

    it("renders localized login failure message in French when receiving INVALID_CREDENTIALS", async () => {
      vi.spyOn(authService, "login").mockResolvedValueOnce({
        success: false,
        error: "INVALID_CREDENTIALS",
        code: AuthErrorCode.INVALID_CREDENTIALS,
      })

      const container = await renderComponent(<LoginView onLogin={vi.fn()} theme="dark" />, "fr")

      const inputs = container.querySelectorAll("input")
      await act(async () => {
        changeInput(inputs[0], "joueur@exemple.com")
        changeInput(inputs[1], "motdepasse")
      })

      const submitBtn = Array.from(container.querySelectorAll("button")).find(
        (b) => b.classList.contains("launcher-btn-primary") && (b.textContent?.includes("Se Connecter") || b.textContent?.includes("Connexion")),
      )

      await act(async () => {
        submitBtn?.click()
      })
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50))
      })

      expect(container.textContent).toContain("Impossible de se connecter. Veuillez vérifier vos identifiants.")
      expect(container.textContent).not.toContain("INVALID_CREDENTIALS")
    })

    it("renders localized email conflict error in Portuguese when receiving USER_ALREADY_EXISTS", async () => {
      vi.spyOn(authService, "register").mockResolvedValueOnce({
        success: false,
        error: "USER_ALREADY_EXISTS",
        code: AuthErrorCode.USER_ALREADY_EXISTS,
      })

      const container = await renderComponent(<LoginView onLogin={vi.fn()} theme="dark" />, "pt")

      // Switch to Register tab ("Cadastrar")
      const registerTab = Array.from(container.querySelectorAll("button")).find(
        (b) => b.textContent?.trim() === "Cadastrar",
      )
      expect(registerTab).toBeDefined()

      await act(async () => {
        registerTab?.click()
      })

      const inputs = container.querySelectorAll("input")
      expect(inputs.length).toBeGreaterThanOrEqual(3)

      await act(async () => {
        changeInput(inputs[0], "NovoPlayer")
        changeInput(inputs[1], "existente@exemplo.com")
        changeInput(inputs[2], "Password123!")
      })

      const submitBtn = Array.from(container.querySelectorAll("button")).find(
        (b) => b.classList.contains("launcher-btn-primary") && b.textContent?.includes("Criar Conta"),
      )

      await act(async () => {
        submitBtn?.click()
      })
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50))
      })

      expect(container.textContent).toContain("Este e-mail já pertence a uma conta HiKAT.")
      expect(container.textContent).not.toContain("USER_ALREADY_EXISTS")
    })
  })

  describe("2. Contextual Token Error Handling: verify-email, reset-password, and OAuth", () => {
    it("verify-email + INVALID_TOKEN renders invalidVerificationToken and never raw code", async () => {
      vi.spyOn(authService, "verifyEmail").mockResolvedValueOnce({
        success: false,
        error: "INVALID_TOKEN",
        code: AuthErrorCode.INVALID_TOKEN,
      })

      const container = await renderComponent(
        <LoginView onLogin={vi.fn()} theme="dark" initialDeepLinkUrl="hikat://auth/verify-email?token=invalid_tok_123" />,
        "en",
      )

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50))
      })

      expect(container.textContent).toContain("The verification link is invalid or has expired.")
      expect(container.textContent).not.toContain("INVALID_TOKEN")
      expect(container.textContent).not.toContain("auth.invalidVerificationToken")
    })

    it("verify-email + NETWORK_ERROR renders genericAuthError (never invalidVerificationToken)", async () => {
      vi.spyOn(authService, "verifyEmail").mockResolvedValueOnce({
        success: false,
        error: "Error de conexión",
        code: "NETWORK_ERROR",
      })

      const container = await renderComponent(
        <LoginView onLogin={vi.fn()} theme="dark" initialDeepLinkUrl="hikat://auth/verify-email?token=valid_tok_123" />,
        "en",
      )

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50))
      })

      expect(container.textContent).toContain("Failed to complete authentication.")
      expect(container.textContent).not.toContain("The verification link is invalid")
      expect(container.textContent).not.toContain("NETWORK_ERROR")
      expect(container.textContent).not.toContain("auth.genericAuthError")
    })

    it("reset-password + INVALID_TOKEN renders invalidResetToken (never invalidVerificationToken)", async () => {
      vi.spyOn(authService, "resetPassword").mockResolvedValueOnce({
        success: false,
        error: "INVALID_TOKEN",
        code: AuthErrorCode.INVALID_TOKEN,
      })

      const container = await renderComponent(
        <LoginView onLogin={vi.fn()} theme="dark" initialDeepLinkUrl="hikat://auth/reset-password?token=invalid_reset_tok" />,
        "en",
      )

      const inputs = container.querySelectorAll("input")
      expect(inputs.length).toBeGreaterThanOrEqual(2)

      await act(async () => {
        changeInput(inputs[0], "NewSecurePass123!")
        changeInput(inputs[1], "NewSecurePass123!")
      })

      const submitBtn = Array.from(container.querySelectorAll("button")).find(
        (b) => b.classList.contains("launcher-btn-primary"),
      )
      expect(submitBtn).toBeDefined()

      await act(async () => {
        submitBtn?.click()
      })
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50))
      })

      expect(container.textContent).toContain("The reset link is invalid or has expired.")
      expect(container.textContent).not.toContain("The verification link is invalid")
      expect(container.textContent).not.toContain("INVALID_TOKEN")
      expect(container.textContent).not.toContain("auth.invalidResetToken")
    })

    it("reset-password + TOKEN_EXPIRED renders invalidResetToken (never invalidVerificationToken)", async () => {
      vi.spyOn(authService, "resetPassword").mockResolvedValueOnce({
        success: false,
        error: "TOKEN_EXPIRED",
        code: AuthErrorCode.TOKEN_EXPIRED,
      })

      const container = await renderComponent(
        <LoginView onLogin={vi.fn()} theme="dark" initialDeepLinkUrl="hikat://auth/reset-password?token=expired_reset_tok" />,
        "en",
      )

      const inputs = container.querySelectorAll("input")
      await act(async () => {
        changeInput(inputs[0], "NewSecurePass123!")
        changeInput(inputs[1], "NewSecurePass123!")
      })

      const submitBtn = Array.from(container.querySelectorAll("button")).find(
        (b) => b.classList.contains("launcher-btn-primary"),
      )

      await act(async () => {
        submitBtn?.click()
      })
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50))
      })

      expect(container.textContent).toContain("The reset link is invalid or has expired.")
      expect(container.textContent).not.toContain("The verification link is invalid")
      expect(container.textContent).not.toContain("TOKEN_EXPIRED")
    })

    it("reset-password + NETWORK_ERROR renders genericAuthError (never invalidResetToken)", async () => {
      vi.spyOn(authService, "resetPassword").mockResolvedValueOnce({
        success: false,
        error: "Error de conexión",
        code: "NETWORK_ERROR",
      })

      const container = await renderComponent(
        <LoginView onLogin={vi.fn()} theme="dark" initialDeepLinkUrl="hikat://auth/reset-password?token=valid_reset_tok" />,
        "en",
      )

      const inputs = container.querySelectorAll("input")
      await act(async () => {
        changeInput(inputs[0], "NewSecurePass123!")
        changeInput(inputs[1], "NewSecurePass123!")
      })

      const submitBtn = Array.from(container.querySelectorAll("button")).find(
        (b) => b.classList.contains("launcher-btn-primary"),
      )

      await act(async () => {
        submitBtn?.click()
      })
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50))
      })

      expect(container.textContent).toContain("Failed to complete authentication.")
      expect(container.textContent).not.toContain("The reset link is invalid")
      expect(container.textContent).not.toContain("NETWORK_ERROR")
    })

    it("OAuth + INVALID_STATE renders invalidOAuthAttempt (never technical code)", async () => {
      const err: any = new Error("Invalid state")
      err.code = AuthErrorCode.INVALID_STATE
      vi.spyOn(authService, "handleOAuthCallback").mockRejectedValueOnce(err)

      const container = await renderComponent(
        <LoginView onLogin={vi.fn()} theme="dark" initialDeepLinkUrl="hikat://auth/callback?code=mock_code&state=bad_state" />,
        "en",
      )

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50))
      })

      expect(container.textContent).toContain("This sign-in attempt is no longer valid. Please try again.")
      expect(container.textContent).not.toContain("INVALID_STATE")
      expect(container.textContent).not.toContain("The reset link is invalid")
    })

    it("OAuth + TOKEN_EXPIRED renders invalidOAuthAttempt (NEVER invalidResetToken)", async () => {
      const err: any = new Error("OAuth token expired")
      err.code = AuthErrorCode.TOKEN_EXPIRED
      vi.spyOn(authService, "handleOAuthCallback").mockRejectedValueOnce(err)

      const container = await renderComponent(
        <LoginView onLogin={vi.fn()} theme="dark" initialDeepLinkUrl="hikat://auth/callback?code=expired_code&state=valid_state" />,
        "en",
      )

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50))
      })

      expect(container.textContent).toContain("This sign-in attempt is no longer valid. Please try again.")
      expect(container.textContent).not.toContain("The reset link is invalid")
      expect(container.textContent).not.toContain("TOKEN_EXPIRED")
    })
  })

  describe("3. ProfileView: Username error mapping renders localized copy", () => {
    it("enters edit mode and renders localized usernameTakenError in English when changeUsername returns USERNAME_ALREADY_EXISTS", async () => {
      vi.spyOn(authService, "getUser").mockReturnValue({
        id: "u-1",
        username: "CurrentName",
        displayName: "CurrentName",
        email: "user@test.com",
      })

      vi.spyOn(authService, "changeUsername").mockResolvedValueOnce({
        success: false,
        error: "USERNAME_ALREADY_EXISTS",
        code: AuthErrorCode.USERNAME_ALREADY_EXISTS,
      })

      const container = await renderComponent(
        <ProfileView username="CurrentName" onBack={vi.fn()} theme="dark" />,
        "en",
      )

      // Enter edit mode by clicking the pencil button
      const editBtn = container.querySelector('button[aria-label="Change Username"], button[title="Change Username"]') as HTMLButtonElement
      expect(editBtn).not.toBeNull()

      await act(async () => {
        editBtn.click()
      })

      const input = container.querySelector("input") as HTMLInputElement
      expect(input).not.toBeNull()

      await act(async () => {
        changeInput(input, "TakenUsername")
      })

      const saveBtn = Array.from(container.querySelectorAll("button")).find(
        (b) => b.textContent?.includes("Save") || b.textContent?.includes("Guardar"),
      )
      expect(saveBtn).toBeDefined()

      await act(async () => {
        saveBtn?.click()
      })
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50))
      })

      expect(container.textContent).toContain("This username is already taken.")
      expect(container.textContent).not.toContain("USERNAME_ALREADY_EXISTS")
      expect(container.textContent).not.toContain("Este nombre de usuario ya está en uso")
    })
  })

  describe("4. SkinsView: Sentinels and accessibility use dynamic localized labels", () => {
    it("renders English sentinel names and alt attributes for 'none' and 'player-custom'", async () => {
      const container = await renderComponent(
        <SkinsView
          username="HeroPlayer"
          appliedSkin="player-custom"
          setAppliedSkin={vi.fn()}
          appliedCape="none"
          setAppliedCape={vi.fn()}
          allSkins={[
            {
              id: "player-custom",
              name: "",
              badge: "CUSTOM",
              customImgUrl: "data:image/png;base64,mockCustomSkin",
            },
            {
              id: "none",
              name: "",
            },
          ]}
          allCapes={[
            {
              id: "none",
              name: "",
            },
          ]}
          playerSkin={{
            id: "ps-1",
            userId: "u-1",
            imageUrl: "data:image/png;base64,mockCustomSkin",
            createdAt: "2026-01-01",
            updatedAt: "2026-01-01",
          }}
        />,
        "en",
      )

      // In EN locale:
      // "My Skin" should be rendered for player-custom, NOT Spanish "Mi Skin"
      expect(container.textContent).toContain("My Skin")
      expect(container.textContent).not.toContain("Mi Skin")

      // Info card shows "No Cape" for activeCape "none"
      expect(container.textContent).toContain("No Cape")
      expect(container.textContent).not.toContain("Sin Capa")

      // Accessibility / preview elements have localized alt
      const previewCard = container.querySelector('[data-testid="mock-skin-card-preview"]')
      expect(previewCard?.getAttribute("data-alt")).toBe("My Skin")
    })

    it("renders French sentinel names and alt attributes for 'none' and 'player-custom'", async () => {
      const container = await renderComponent(
        <SkinsView
          username="HeroPlayer"
          appliedSkin="none"
          setAppliedSkin={vi.fn()}
          appliedCape="none"
          setAppliedCape={vi.fn()}
          allSkins={[
            {
              id: "none",
              name: "",
            },
          ]}
          allCapes={[
            {
              id: "none",
              name: "",
            },
          ]}
        />,
        "fr",
      )

      expect(container.textContent).toContain("Aucun Skin")
      expect(container.textContent).toContain("Aucune Cape")
      expect(container.textContent).not.toContain("Sin Skin")
      expect(container.textContent).not.toContain("Sin Capa")
    })

    it("renders Portuguese sentinel names for 'none' and 'player-custom'", async () => {
      const container = await renderComponent(
        <SkinsView
          username="HeroPlayer"
          appliedSkin="player-custom"
          setAppliedSkin={vi.fn()}
          appliedCape="none"
          setAppliedCape={vi.fn()}
          allSkins={[
            {
              id: "player-custom",
              name: "",
              badge: "CUSTOM",
              customImgUrl: "data:image/png;base64,mockCustomSkin",
            },
            {
              id: "none",
              name: "",
            },
          ]}
          allCapes={[
            {
              id: "none",
              name: "",
            },
          ]}
          playerSkin={{
            id: "ps-1",
            userId: "u-1",
            imageUrl: "data:image/png;base64,mockCustomSkin",
            createdAt: "2026-01-01",
            updatedAt: "2026-01-01",
          }}
        />,
        "pt",
      )

      expect(container.textContent).toContain("Minha Skin")
      expect(container.textContent).toContain("Sem Capa")
      expect(container.textContent).not.toContain("Mi Skin")
      expect(container.textContent).not.toContain("Sin Capa")
    })
  })

  describe("5. SkinsView: Upload failure differentiation", () => {
    it("shows dimensions error when file buffer has invalid dimensions", async () => {
      const container = await renderComponent(
        <SkinsView
          username="HeroPlayer"
          appliedSkin="none"
          setAppliedSkin={vi.fn()}
          appliedCape="none"
          setAppliedCape={vi.fn()}
          onUploadSkin={vi.fn()}
        />,
        "en",
      )

      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
      expect(fileInput).not.toBeNull()

      // Create a mock PNG with invalid size/dimensions
      const invalidPngFile = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 10, 0, 0, 0, 10, 8, 2, 0, 0, 0])], "skin.png", { type: "image/png" })

      await act(async () => {
        Object.defineProperty(fileInput, "files", {
          value: [invalidPngFile],
          writable: true,
        })
        fileInput.dispatchEvent(new Event("change", { bubbles: true }))
      })

      // In EN locale, invalid dimensions message should appear
      expect(container.textContent).toContain("The image doesn't look like a Minecraft skin. Please use a valid skin file.")
    })

    it("shows toastSaveError when local validation passes but upload rejects with network error (does NOT show invalidSkinDimensions)", async () => {
      const onUploadSkinMock = vi.fn().mockRejectedValueOnce(new Error("Failed to fetch GraphQL upload endpoint"))

      const container = await renderComponent(
        <SkinsView
          username="HeroPlayer"
          appliedSkin="none"
          setAppliedSkin={vi.fn()}
          appliedCape="none"
          setAppliedCape={vi.fn()}
          onUploadSkin={onUploadSkinMock}
        />,
        "en",
      )

      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
      expect(fileInput).not.toBeNull()

      // 64x64 valid decoded PNG buffer
      const valid64x64Png = encode({
        width: 64,
        height: 64,
        data: new Uint8Array(64 * 64 * 4).fill(255),
        channels: 4,
        depth: 8,
      })
      const mockFile = new File([valid64x64Png.buffer as ArrayBuffer], "valid_skin.png", { type: "image/png" })

      await act(async () => {
        Object.defineProperty(fileInput, "files", {
          value: [mockFile],
          writable: true,
        })
        fileInput.dispatchEvent(new Event("change", { bubbles: true }))
      })

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50))
      })

      // When upload throws after passing header & texture validation, toastSaveError ("Error saving changes") is displayed,
      // and invalidSkinDimensions ("The image doesn't look like a Minecraft skin. Please use a valid skin file.") is NOT shown.
      expect(container.textContent).toContain("Error saving changes")
      expect(container.textContent).not.toContain("The image doesn't look like a Minecraft skin. Please use a valid skin file.")
      expect(container.textContent).not.toContain("Failed to fetch GraphQL upload endpoint")
    })
  })
})
