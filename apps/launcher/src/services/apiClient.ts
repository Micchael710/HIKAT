/**
 * Centralized API & GraphQL Client for HiKAT Launcher
 * Configurable via centralized API authority (VITE_API_URL / local development default)
 * with proactive token validation, single-flight refresh, full GraphQL envelope preservation,
 * and 401 / UNAUTHENTICATED single-retry fallback.
 */
import { sanitizeUrl, sanitizeInput } from "../utils/security"
import { getApiBaseUrl } from "../config/api"
import { authService } from "./authService"

export interface ApiResponse<T = any> {
  success: boolean
  data?: T
  message?: string
  error?: string
  status?: number
}

export interface GraphQLClientResponse<T = any> {
  success: boolean
  data?: T
  error?: string
  errors?: Array<{ message: string; extensions?: { code?: string; [key: string]: unknown } }>
}

export const API_BASE_URL = getApiBaseUrl()

/**
 * REST API Client helper
 */
export async function apiClient<T = any>(
  endpoint: string,
  options: RequestInit = {},
  timeoutMs = 10000,
  isRetry = false,
): Promise<ApiResponse<T>> {
  const cleanEndpoint = sanitizeInput(endpoint, 512)
  const baseUrl = getApiBaseUrl()
  const rawUrl = cleanEndpoint.startsWith("http")
    ? cleanEndpoint
    : `${baseUrl.replace(/\/$/, "")}/${cleanEndpoint.replace(/^\//, "")}`

  const safeUrl = sanitizeUrl(rawUrl)
  if (!safeUrl) {
    return {
      success: false,
      status: 400,
      message: "URL de solicitud inválida o bloqueada por seguridad",
      error: "Blocked by security URL validator",
    }
  }

  const tokenOutcome = await authService.getValidAccessTokenOutcome()
  if (tokenOutcome.kind === "TRANSIENT_FAILURE") {
    return {
      success: false,
      status: 0,
      message: "Error temporal al renovar sesión con el servidor.",
      error: tokenOutcome.error,
    }
  }
  if (tokenOutcome.kind === "TERMINAL_FAILURE") {
    return {
      success: false,
      status: 401,
      message: "Su sesión ha expirado o no está autorizada.",
      error: "UNAUTHORIZED",
    }
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    ...(options.headers as Record<string, string>),
  }

  if (tokenOutcome.kind === "READY") {
    const cleanToken = sanitizeInput(tokenOutcome.accessToken, 1024)
    if (cleanToken) {
      headers["Authorization"] = `Bearer ${cleanToken}`
    }
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(safeUrl, {
      ...options,
      headers,
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    // Handle HTTP 401 Unauthorized with single-flight refresh and single retry
    if (response.status === 401) {
      if (!isRetry) {
        const outcome = await authService.refreshOutcome()
        if (outcome.kind === "REFRESHED") {
          return apiClient<T>(endpoint, options, timeoutMs, true)
        }
        if (outcome.kind === "TRANSIENT_FAILURE") {
          return {
            success: false,
            status: 401,
            message: "Error temporal al renovar sesión con el servidor.",
            error: outcome.error,
          }
        }
      }
      authService.clearSession()
      return {
        success: false,
        status: 401,
        message: "Su sesión ha expirado o no está autorizada.",
        error: "UNAUTHORIZED",
      }
    }

    const data = await response.json().catch(() => null)

    if (!response.ok) {
      if (import.meta.env?.DEV) {
        console.warn(`[Launcher API] Request to ${safeUrl} returned ${response.status}:`, data)
      }
      return {
        success: false,
        status: response.status,
        message: data?.message || `HTTP Error ${response.status}`,
        error: data?.error || response.statusText,
      }
    }

    return {
      success: true,
      status: response.status,
      data: data as T,
      message: data?.message,
    }
  } catch (err: any) {
    clearTimeout(timeoutId)
    const isTimeout = err?.name === "AbortError"
    if (import.meta.env?.DEV) {
      console.warn(`[Launcher API] Request to ${safeUrl} failed:`, err?.message || err)
    }
    return {
      success: false,
      status: 0,
      message: isTimeout
        ? "Tiempo de espera agotado al conectar con el servidor"
        : "No se pudo conectar con el servidor (Modo sin conexión)",
      error: err?.message || "Network request failed",
    }
  }
}

/**
 * GraphQL Client helper for Backend queries and mutations.
 * Preserves complete GraphQL envelope ({ data, errors }), inspects UNAUTHENTICATED errors,
 * executes proactive token validation and single-flight reactive retry.
 */
export async function graphqlClient<T = any>(
  query: string,
  variables: Record<string, any> = {},
  timeoutMs = 15000,
  isRetry = false,
): Promise<GraphQLClientResponse<T>> {
  const baseUrl = getApiBaseUrl()
  const rawUrl = `${baseUrl.replace(/\/$/, "")}/graphql`
  const safeUrl = sanitizeUrl(rawUrl)

  if (!safeUrl) {
    return {
      success: false,
      error: "URL de endpoint GraphQL bloqueada por seguridad",
    }
  }

  // 1. Authoritative access token acquisition
  const tokenOutcome = await authService.getValidAccessTokenOutcome()
  if (tokenOutcome.kind === "TRANSIENT_FAILURE") {
    return {
      success: false,
      error: tokenOutcome.error || "Error temporal al renovar sesión con el servidor.",
    }
  }
  if (tokenOutcome.kind === "TERMINAL_FAILURE") {
    return {
      success: false,
      error: "Su sesión ha expirado. Por favor inicie sesión nuevamente.",
    }
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  }

  if (tokenOutcome.kind === "READY") {
    const cleanToken = sanitizeInput(tokenOutcome.accessToken, 1024)
    if (cleanToken) {
      headers["Authorization"] = `Bearer ${cleanToken}`
    }
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(safeUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    // 2. Handle HTTP 401 Unauthorized
    if (response.status === 401) {
      if (!isRetry) {
        const outcome = await authService.refreshOutcome()
        if (outcome.kind === "REFRESHED") {
          return graphqlClient<T>(query, variables, timeoutMs, true)
        }
        if (outcome.kind === "TRANSIENT_FAILURE") {
          return {
            success: false,
            error: "Error temporal de conexión con el servidor de autenticación.",
          }
        }
      }
      authService.clearSession()
      return {
        success: false,
        error: "Su sesión ha expirado. Por favor inicie sesión nuevamente.",
      }
    }

    const payload = await response.json().catch(() => null)

    // 3. Inspect full GraphQL envelope errors (including HTTP 200 with UNAUTHENTICATED)
    if (payload && payload.errors && Array.isArray(payload.errors) && payload.errors.length > 0) {
      const hasUnauthenticated = payload.errors.some(
        (e: any) =>
          e.extensions?.code === "UNAUTHENTICATED" ||
          e.message === "UNAUTHENTICATED" ||
          e.message === "Authentication required",
      )

      if (hasUnauthenticated) {
        if (!isRetry) {
          const outcome = await authService.refreshOutcome()
          if (outcome.kind === "REFRESHED") {
            return graphqlClient<T>(query, variables, timeoutMs, true)
          }
          if (outcome.kind === "TRANSIENT_FAILURE") {
            return {
              success: false,
              error: "Error temporal al renovar sesión con el servidor.",
              errors: payload.errors,
            }
          }
        }
        authService.clearSession()
        return {
          success: false,
          error: "Su sesión ha expirado. Por favor inicie sesión nuevamente.",
          errors: payload.errors,
        }
      }

      return {
        success: false,
        error: payload.errors[0]?.message || "GraphQL query error",
        errors: payload.errors,
      }
    }

    if (!response.ok) {
      return {
        success: false,
        error: payload?.message || `HTTP Error ${response.status}`,
      }
    }

    return {
      success: true,
      data: payload?.data as T,
    }
  } catch (err: any) {
    clearTimeout(timeoutId)
    const isTimeout = err?.name === "AbortError"
    return {
      success: false,
      error: isTimeout
        ? "Tiempo de espera agotado al conectar con el servidor"
        : "No se pudo conectar con el servidor (Modo sin conexión)",
    }
  }
}
