import { useState, useEffect } from "react"
import { hexToRGB } from "../theme/tokens"

export interface AccentColor {
  r: number
  g: number
  b: number
  hex: string
  css: string
}

export const DEFAULT_NEUTRAL_ACCENT: AccentColor = {
  r: 56,
  g: 189,
  b: 248,
  hex: "#38bdf8",
  css: "56, 189, 248",
}

const accentCache = new Map<string, AccentColor>()

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (c: number) => {
    const hex = Math.max(0, Math.min(255, Math.round(c))).toString(16)
    return hex.length === 1 ? `0${hex}` : hex
  }
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

export function parseFallbackAccent(fallbackHex?: string): AccentColor {
  if (!fallbackHex) return DEFAULT_NEUTRAL_ACCENT
  try {
    const rgb = hexToRGB(fallbackHex)
    return {
      r: rgb.r,
      g: rgb.g,
      b: rgb.b,
      hex: fallbackHex,
      css: rgb.css,
    }
  } catch (_) {
    return DEFAULT_NEUTRAL_ACCENT
  }
}

/**
 * Synchronous cache lookup for an image's dominant accent.
 */
export function getDominantAccentSync(
  src?: string | null,
  fallbackHex?: string,
): AccentColor {
  if (!src) return parseFallbackAccent(fallbackHex)
  const cached = accentCache.get(src)
  if (cached) return cached
  return parseFallbackAccent(fallbackHex)
}

/**
 * Extracts a dominant, vibrant accent color from an image or texture.
 * Balances pixel population (frequency) with saturation and filters out extreme
 * blacks, whites, and neutrals. Works accurately on Minecraft textures and news art.
 */
export async function extractDominantAccent(
  src?: string | null,
  fallbackHex?: string,
): Promise<AccentColor> {
  const fallback = parseFallbackAccent(fallbackHex)
  if (!src) return fallback

  const cached = accentCache.get(src)
  if (cached) return cached

  return new Promise<AccentColor>((resolve) => {
    try {
      const img = new Image()
      img.crossOrigin = "anonymous"

      let resolved = false
      const finish = (accent: AccentColor) => {
        if (resolved) return
        resolved = true
        accentCache.set(src, accent)
        resolve(accent)
      }

      img.onload = () => {
        try {
          const W = 48
          const H = 48
          const canvas = document.createElement("canvas")
          canvas.width = W
          canvas.height = H
          const ctx = canvas.getContext("2d", { willReadFrequently: true })
          if (!ctx) {
            finish(fallback)
            return
          }

          ctx.drawImage(img, 0, 0, W, H)
          const imgData = ctx.getImageData(0, 0, W, H).data

          // 16-level buckets: (4 bits per channel = 4096 bins)
          interface Bucket {
            rSum: number
            gSum: number
            bSum: number
            count: number
            satSum: number
          }
          const buckets = new Map<number, Bucket>()

          let fallbackR = 0
          let fallbackG = 0
          let fallbackB = 0
          let fallbackCount = 0

          for (let i = 0; i < imgData.length; i += 4) {
            const r = imgData[i]
            const g = imgData[i + 1]
            const b = imgData[i + 2]
            const a = imgData[i + 3]

            // 1. Ignore transparent pixels
            if (a < 64) continue

            fallbackR += r
            fallbackG += g
            fallbackB += b
            fallbackCount++

            const max = Math.max(r, g, b)
            const min = Math.min(r, g, b)
            const lum = (max + min) / 2
            const delta = max - min
            const sat = max === 0 ? 0 : delta / max

            // 2. Filter out extreme blacks, extreme whites, and extreme grays
            if (lum < 28 || lum > 235) continue
            if (delta < 18 && (lum < 40 || lum > 200)) continue

            // 3. Quantize into 4-bit per channel bucket
            const binKey = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
            let bObj = buckets.get(binKey)
            if (!bObj) {
              bObj = { rSum: 0, gSum: 0, bSum: 0, count: 0, satSum: 0 }
              buckets.set(binKey, bObj)
            }
            bObj.rSum += r
            bObj.gSum += g
            bObj.bSum += b
            bObj.count++
            bObj.satSum += sat
          }

          if (buckets.size === 0) {
            if (fallbackCount > 0) {
              const avgR = Math.round(fallbackR / fallbackCount)
              const avgG = Math.round(fallbackG / fallbackCount)
              const avgB = Math.round(fallbackB / fallbackCount)
              const hex = rgbToHex(avgR, avgG, avgB)
              finish({ r: avgR, g: avgG, b: avgB, hex, css: `${avgR}, ${avgG}, ${avgB}` })
            } else {
              finish(fallback)
            }
            return
          }

          // 4. Score buckets: Population × Saturation weighting
          let bestScore = -1
          let bestBucket: Bucket | null = null

          for (const bObj of buckets.values()) {
            const avgSat = bObj.satSum / bObj.count
            // Score rewards population count with saturation multiplier
            const score = bObj.count * (1.0 + Math.pow(avgSat, 1.2) * 2.5)
            if (score > bestScore) {
              bestScore = score
              bestBucket = bObj
            }
          }

          if (bestBucket) {
            const finalR = Math.round(bestBucket.rSum / bestBucket.count)
            const finalG = Math.round(bestBucket.gSum / bestBucket.count)
            const finalB = Math.round(bestBucket.bSum / bestBucket.count)
            const hex = rgbToHex(finalR, finalG, finalB)
            finish({
              r: finalR,
              g: finalG,
              b: finalB,
              hex,
              css: `${finalR}, ${finalG}, ${finalB}`,
            })
          } else {
            finish(fallback)
          }
        } catch (_) {
          finish(fallback)
        }
      }

      img.onerror = () => {
        finish(fallback)
      }

      img.src = src
    } catch (_) {
      resolve(fallback)
    }
  })
}

/**
 * React hook to automatically extract and observe the dominant accent of an image or texture.
 */
export function useDynamicAccent(
  src?: string | null,
  fallbackHex?: string,
): AccentColor {
  const [accent, setAccent] = useState<AccentColor>(() =>
    getDominantAccentSync(src, fallbackHex),
  )

  useEffect(() => {
    if (!src) {
      setAccent(parseFallbackAccent(fallbackHex))
      return
    }

    let isMounted = true
    const cached = accentCache.get(src)
    if (cached) {
      setAccent(cached)
      return
    }

    extractDominantAccent(src, fallbackHex).then((result) => {
      if (isMounted) {
        setAccent(result)
      }
    })

    return () => {
      isMounted = false
    }
  }, [src, fallbackHex])

  return accent
}
