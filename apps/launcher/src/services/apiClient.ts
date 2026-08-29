/**
 * Centralized API Client for HiKAT Launcher
 * Configurable via centralized API authority (VITE_API_URL / local development default)
 * with automatic auth token handling, single-flight refresh, and 401 / UNAUTHENTICATED one-time retry.
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

export const API_BASE_URL = getApiBaseUrl()

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

  const token = authService.getAccessToken()

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    ...(options.headers as Record<string, string>),
  }

  if (token) {
    const cleanToken = sanitizeInput(token, 1024)
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
        const newToken = await authService.refresh()
        if (newToken) {
          return apiClient<T>(endpoint, options, timeoutMs, true)
        }
      }
      authService.clearSession()
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
      data: data?.data !== undefined ? data.data : data,
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
 * GraphQL Client helper for Backend queries and mutations
 * Handles single-flight refresh for UNAUTHENTICATED errors and retries once
 */
export async function graphqlClient<T = any>(
  query: string,
  variables: Record<string, any> = {},
  timeoutMs = 15000,
  isRetry = false,
): Promise<{ success: boolean; data?: T; error?: string }> {
  const res = await apiClient<{ data?: T; errors?: Array<{ message: string; extensions?: { code?: string } }> }>(
    "/graphql",
    {
      method: "POST",
      body: JSON.stringify({ query, variables }),
    },
    timeoutMs,
    isRetry,
  )

  if (res.success && res.data) {
    if (res.data.errors && res.data.errors.length > 0) {
      const hasUnauthenticated = res.data.errors.some(
        (e: any) =>
          e.extensions?.code === "UNAUTHENTICATED" ||
          e.message === "UNAUTHENTICATED" ||
          e.message === "Authentication required",
      )

      if (hasUnauthenticated) {
        if (!isRetry) {
          const newToken = await authService.refresh()
          if (newToken) {
            return graphqlClient<T>(query, variables, timeoutMs, true)
          }
        }
        authService.clearSession()
        return {
          success: false,
          error: "Su sesión ha expirado. Por favor inicie sesión nuevamente.",
        }
      }

      return {
        success: false,
        error: res.data.errors[0]?.message || "GraphQL query error",
      }
    }
    const resultData = res.data.data !== undefined ? res.data.data : (res.data as unknown as T)
    return {
      success: true,
      data: resultData,
    }
  }

  return {
    success: false,
    error: res.message || res.error || "GraphQL query failed",
  }
}
