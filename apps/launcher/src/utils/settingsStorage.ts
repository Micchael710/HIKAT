export const STORAGE_KEYS = {
  THEME: "hikat_theme",
  LANGUAGE: "hikat_language",
  START_WITH_SYSTEM: "hikat_start_with_system",
  MINIMIZE_TO_TRAY: "hikat_minimize_to_tray",
  AUTO_UPDATES: "hikat_auto_updates",
  RAM_GB: "hikat_ram_gb",
  DEDICATED_GPU: "hikat_dedicated_gpu",
} as const

export function getStoredBoolean(key: string, defaultValue: boolean): boolean {
  if (typeof window === "undefined") return defaultValue
  try {
    const saved = localStorage.getItem(key)
    if (saved === null) return defaultValue
    return saved === "true"
  } catch (_) {
    return defaultValue
  }
}

export function setStoredBoolean(key: string, value: boolean): void {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(key, String(value))
  } catch (_) {}
}

export function getStoredNumber(key: string, defaultValue: number): number {
  if (typeof window === "undefined") return defaultValue
  try {
    const saved = localStorage.getItem(key)
    if (saved === null) return defaultValue
    const num = parseInt(saved, 10)
    return isNaN(num) ? defaultValue : num
  } catch (_) {
    return defaultValue
  }
}

export function setStoredNumber(key: string, value: number): void {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(key, String(value))
  } catch (_) {}
}
