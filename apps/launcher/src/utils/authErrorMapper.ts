import { AuthErrorCode } from "@hikat/shared"

/**
 * Maps a technical authentication or registration error code/status to a localized translation key.
 * The UI layer passes this key to `t(key)` for localized presentation.
 */
export function mapAuthErrorToKey(
  errorCode?: string | null,
  fallbackKey: string = "auth.genericAuthError",
): string {
  if (!errorCode) return fallbackKey

  const code = String(errorCode).trim()

  switch (code) {
    case AuthErrorCode.INVALID_CREDENTIALS:
    case "INVALID_CREDENTIALS":
      return "auth.loginFailed"

    case AuthErrorCode.USER_ALREADY_EXISTS:
    case "USER_ALREADY_EXISTS":
    case AuthErrorCode.EMAIL_CONFLICT_LINK_REQUIRED:
    case "EMAIL_CONFLICT_LINK_REQUIRED":
      return "auth.emailConflictError"

    case AuthErrorCode.USERNAME_ALREADY_EXISTS:
    case "USERNAME_ALREADY_EXISTS":
      return "profile.usernameTakenError"

    case AuthErrorCode.INVALID_USERNAME:
    case "INVALID_USERNAME":
      return "profile.usernameInvalidError"

    case AuthErrorCode.EMAIL_NOT_VERIFIED:
    case "EMAIL_NOT_VERIFIED":
      return "auth.emailNotVerifiedError"

    case AuthErrorCode.INVALID_PKCE:
    case "INVALID_PKCE":
    case AuthErrorCode.INVALID_STATE:
    case "INVALID_STATE":
    case "OAUTH_CALLBACK_ERROR":
      return "auth.invalidOAuthAttempt"

    case "OAUTH_INIT_ERROR":
      return "auth.oauthInitError"

    case "EXTERNAL_AUTH_ERROR":
      return "auth.externalAuthError"

    case "PASSWORDS_DO_NOT_MATCH":
      return "auth.passwordsDoNotMatch"

    case "MISSING_FIELDS":
      return "auth.missingFields"

    case "INVALID_EMAIL":
      return "auth.invalidEmail"

    case "PASSWORD_TOO_SHORT":
      return "auth.passwordMinLength"

    case "REGISTRATION_FAILED":
      return "auth.registrationFailed"

    case "LOGIN_FAILED":
      return "auth.loginFailed"

    case "RESET_EMAIL_ERROR":
      return "profile.emailError"

    case "USERNAME_SAME_ERROR":
      return "profile.usernameSameError"

    case "USERNAME_CHANGE_ERROR":
      return "profile.usernameChangeError"

    default:
      // Pattern inspection for errors from legacy/shared layers
      if (
        code === AuthErrorCode.USERNAME_ALREADY_EXISTS ||
        code.includes("USERNAME_ALREADY_EXISTS") ||
        code.toLowerCase().includes("taken")
      ) {
        return "profile.usernameTakenError"
      }
      if (
        code === AuthErrorCode.INVALID_USERNAME ||
        code.includes("INVALID_USERNAME") ||
        code.toLowerCase().includes("invalid username")
      ) {
        return "profile.usernameInvalidError"
      }
      if (
        code === AuthErrorCode.EMAIL_NOT_VERIFIED ||
        code.includes("EMAIL_NOT_VERIFIED") ||
        code.toLowerCase().includes("email verification is required")
      ) {
        return "auth.emailNotVerifiedError"
      }
      if (
        code === AuthErrorCode.USER_ALREADY_EXISTS ||
        code.includes("USER_ALREADY_EXISTS") ||
        code.toLowerCase().includes("already registered") ||
        code.toLowerCase().includes("already exists")
      ) {
        return "auth.emailConflictError"
      }
      if (
        code.includes("OAuth") ||
        code.includes("PKCE") ||
        code.includes("CSRF") ||
        code.includes("state")
      ) {
        return "auth.invalidOAuthAttempt"
      }
      return fallbackKey
  }
}
