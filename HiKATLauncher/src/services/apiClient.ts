/**
 * Centralized API Client for HiKAT Launcher
 * Configurable via VITE_API_URL environment variable with automatic auth token handling
 */
import { sanitizeUrl, sanitizeInput } from "../utils/security"

export interface ApiResponse<T = any> {
  success: boolean
  data?: T
  message?: string
  error?: string
  status?: number
}

export const API_BASE_URL =
  import.meta.env.VITE_API_URL || "https://api.apparatia.net/api/v1"

export async function apiClient<T = any>(
  endpoint: string,
  options: RequestInit = {},
  timeoutMs = 10000,
): Promise<ApiResponse<T>> {
  const cleanEndpoint = sanitizeInput(endpoint, 512)
  const rawUrl = cleanEndpoint.startsWith("http")
    ? cleanEndpoint
    : `${API_BASE_URL.replace(/\/$/, "")}/${cleanEndpoint.replace(/^\//, "")}`

  const safeUrl = sanitizeUrl(rawUrl)
  if (!safeUrl) {
    return {
      success: false,
      status: 400,
      message: "URL de solicitud inválida o bloqueada por seguridad",
      error: "Blocked by security URL validator",
    }
  }

  const token =
    typeof window !== "undefined"
      ? localStorage.getItem("hikat_auth_token")
      : null

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    ...options.headers as Record<string, string>,
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
    const data = await response.json().catch(() => null)

    if (!response.ok) {
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
