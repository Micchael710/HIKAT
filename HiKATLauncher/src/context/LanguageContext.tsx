import React, { createContext, useContext, useState, useEffect } from "react"
import esDict from "../locales/es.json"
import enDict from "../locales/en.json"
import ptDict from "../locales/pt.json"
import frDict from "../locales/fr.json"

export type LanguageCode = "es" | "en" | "pt" | "fr"

export interface LanguageOption {
  code: LanguageCode
  label: string
  flag?: string
}

export const AVAILABLE_LANGUAGES: LanguageOption[] = [
  { code: "es", label: "Español" },
  { code: "en", label: "English" },
  { code: "pt", label: "Português" },
  { code: "fr", label: "Français" },
]

const DICTIONARIES: Record<LanguageCode, any> = {
  es: esDict,
  en: enDict,
  pt: ptDict,
  fr: frDict,
}

interface LanguageContextType {
  language: LanguageCode
  setLanguage: (lang: LanguageCode) => void
  t: (key: string, params?: Record<string, string | number>) => string
  languages: LanguageOption[]
}

const LanguageContext = createContext<LanguageContextType>({
  language: "es",
  setLanguage: () => {},
  t: (key: string) => key,
  languages: AVAILABLE_LANGUAGES,
})

function getNestedValue(obj: any, path: string): string | undefined {
  if (!obj) return undefined
  const parts = path.split(".")
  let current: any = obj
  for (const part of parts) {
    if (current === undefined || current === null) return undefined
    current = current[part]
  }
  return typeof current === "string" ? current : undefined
}

export function getTranslation(
  lang: LanguageCode,
  key: string,
  params?: Record<string, string | number>,
): string {
  const activeDict = DICTIONARIES[lang] || DICTIONARIES.es
  let val = getNestedValue(activeDict, key)

  // Fallback to Spanish if key is missing in active translation
  if (val === undefined && lang !== "es") {
    val = getNestedValue(DICTIONARIES.es, key)
  }

  if (val === undefined) {
    return key
  }

  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      val = val!.replace(new RegExp(`\\{${k}\\}`, "g"), String(v))
    })
  }

  return val
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<LanguageCode>(() => {
    try {
      const saved = localStorage.getItem("hikat_language") as LanguageCode
      if (saved && ["es", "en", "pt", "fr"].includes(saved)) {
        return saved
      }
      const navLang = navigator.language?.slice(0, 2).toLowerCase()
      if (navLang === "pt") return "pt"
      if (navLang === "en") return "en"
      if (navLang === "fr") return "fr"
      return "es"
    } catch (_) {
      return "es"
    }
  })

  const setLanguage = (newLang: LanguageCode) => {
    setLanguageState(newLang)
    try {
      localStorage.setItem("hikat_language", newLang)
    } catch (_) {}
  }

  const t = (key: string, params?: Record<string, string | number>): string => {
    return getTranslation(language, key, params)
  }

  return (
    <LanguageContext.Provider
      value={{
        language,
        setLanguage,
        t,
        languages: AVAILABLE_LANGUAGES,
      }}
    >
      {children}
    </LanguageContext.Provider>
  )
}

export function useTranslation() {
  return useContext(LanguageContext)
}
