import { describe, it, expect } from "vitest"
import es from "./es.json"
import en from "./en.json"
import pt from "./pt.json"
import fr from "./fr.json"
import { getTranslation, LanguageCode } from "../context/LanguageContext"

function extractLeafKeys(obj: Record<string, any>, prefix = ""): Record<string, string> {
  const leaves: Record<string, string> = {}
  for (const [key, value] of Object.entries(obj)) {
    const fullPath = prefix ? `${prefix}.${key}` : key
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      Object.assign(leaves, extractLeafKeys(value, fullPath))
    } else {
      leaves[fullPath] = String(value)
    }
  }
  return leaves
}

describe("Locales Parity & Translation Integrity Suite", () => {
  const locales: Record<LanguageCode, Record<string, any>> = {
    es,
    en,
    pt,
    fr,
  }

  const esLeaves = extractLeafKeys(es)
  const enLeaves = extractLeafKeys(en)
  const ptLeaves = extractLeafKeys(pt)
  const frLeaves = extractLeafKeys(fr)

  const allKeyPaths = Array.from(
    new Set([
      ...Object.keys(esLeaves),
      ...Object.keys(enLeaves),
      ...Object.keys(ptLeaves),
      ...Object.keys(frLeaves),
    ]),
  ).sort()

  it("1. All four locales (ES, EN, PT, FR) have identical leaf key sets", () => {
    const missingKeys: Record<LanguageCode, string[]> = {
      es: [],
      en: [],
      pt: [],
      fr: [],
    }

    for (const keyPath of allKeyPaths) {
      if (!(keyPath in esLeaves)) missingKeys.es.push(keyPath)
      if (!(keyPath in enLeaves)) missingKeys.en.push(keyPath)
      if (!(keyPath in ptLeaves)) missingKeys.pt.push(keyPath)
      if (!(keyPath in frLeaves)) missingKeys.fr.push(keyPath)
    }

    const failureDetails: string[] = []
    for (const [lang, missing] of Object.entries(missingKeys) as [LanguageCode, string[]][]) {
      if (missing.length > 0) {
        failureDetails.push(`Locale '${lang}' is missing ${missing.length} keys: ${missing.join(", ")}`)
      }
    }

    expect(failureDetails, failureDetails.join("\n")).toHaveLength(0)
    expect(Object.keys(esLeaves).length).toBe(allKeyPaths.length)
    expect(Object.keys(enLeaves).length).toBe(allKeyPaths.length)
    expect(Object.keys(ptLeaves).length).toBe(allKeyPaths.length)
    expect(Object.keys(frLeaves).length).toBe(allKeyPaths.length)
  })

  it("2. No leaf key has empty or whitespace-only translation in any locale", () => {
    const emptyEntries: Array<{ lang: LanguageCode; key: string }> = []

    for (const [lang, dict] of Object.entries(locales) as [LanguageCode, Record<string, any>][]) {
      const leaves = extractLeafKeys(dict)
      for (const [key, value] of Object.entries(leaves)) {
        if (!value || !value.trim()) {
          emptyEntries.push({ lang, key })
        }
      }
    }

    expect(emptyEntries).toEqual([])
  })

  it("3. getTranslation returns valid translated text (not raw key) for all keys and locales", () => {
    const languages: LanguageCode[] = ["es", "en", "pt", "fr"]

    for (const lang of languages) {
      for (const keyPath of allKeyPaths) {
        const translated = getTranslation(lang, keyPath)
        expect(translated).not.toBe(keyPath)
        expect(typeof translated).toBe("string")
        expect(translated.length).toBeGreaterThan(0)
      }
    }
  })

  it("4. Parameterized template variables match between all locale variants", () => {
    const paramRegex = /\{([a-zA-Z0-9_]+)\}/g

    for (const keyPath of allKeyPaths) {
      const esParams = new Set((esLeaves[keyPath].match(paramRegex) || []).sort())
      const enParams = new Set((enLeaves[keyPath].match(paramRegex) || []).sort())
      const ptParams = new Set((ptLeaves[keyPath].match(paramRegex) || []).sort())
      const frParams = new Set((frLeaves[keyPath].match(paramRegex) || []).sort())

      expect(Array.from(enParams), `Param mismatch in 'en' for key '${keyPath}'`).toEqual(Array.from(esParams))
      expect(Array.from(ptParams), `Param mismatch in 'pt' for key '${keyPath}'`).toEqual(Array.from(esParams))
      expect(Array.from(frParams), `Param mismatch in 'fr' for key '${keyPath}'`).toEqual(Array.from(esParams))
    }
  })
})
