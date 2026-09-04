/**
 * Calculate safe automatic RAM allocation based on system memory and optional admin recommendation.
 *
 * Rules:
 * minimum = 2 GB
 * safeMax = max(2, min(floor(totalRamGB * 0.50), totalRamGB - 4))
 *
 * If recommendedRamGB is provided and valid (> 0):
 *   automaticRam = clamp(recommendedRamGB, 2, safeMax)
 * Else:
 *   automaticRam = min(8, safeMax)
 */
export function calculateAutomaticRam(
  totalRamGB: number,
  recommendedRamGB?: number,
): number {
  const minimum = 2
  const safeMax = Math.max(
    2,
    Math.min(
      Math.floor(totalRamGB * 0.50),
      totalRamGB - 4,
    ),
  )

  if (
    typeof recommendedRamGB === "number" &&
    !Number.isNaN(recommendedRamGB) &&
    recommendedRamGB > 0
  ) {
    return Math.min(Math.max(recommendedRamGB, minimum), safeMax)
  }

  return Math.min(8, safeMax)
}

/**
 * Format mod loader string into a clean, human-readable name.
 */
export function formatModLoaderName(loader?: string | null): string {
  if (!loader) return ""
  const upper = loader.trim().toUpperCase()
  if (upper === "NEOFORGE") return "NeoForge"
  if (upper === "FORGE") return "Forge"
  if (upper === "FABRIC") return "Fabric"
  if (upper === "QUILT") return "Quilt"
  if (upper === "VANILLA") return "Vanilla"
  return loader
}
