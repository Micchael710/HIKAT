import React, { useEffect, useRef, useState } from "react"

interface SkinCardPreviewProps {
  skinUrl?: string
  width?: number
  height?: number
  className?: string
  alt?: string
}

/**
 * Extracts and composites a pixel-perfect 2D Minecraft character front preview
 * directly from any standard 64x64 or 64x32 skin texture PNG / Data URL.
 * Renders head + hair layer, torso + jacket layer, arms + sleeves, and legs + pants.
 */
export default function SkinCardPreview({
  skinUrl,
  width = 95,
  height = 190,
  className = "",
  alt = "Minecraft Skin",
}: SkinCardPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [isLoaded, setIsLoaded] = useState(false)

  useEffect(() => {
    if (!skinUrl) {
      setIsLoaded(false)
      return
    }

    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const img = new Image()
    img.crossOrigin = "anonymous"

    img.onload = () => {
      // Internal resolution in Minecraft pixels: 16 wide x 32 tall
      canvas.width = 16
      canvas.height = 32

      ctx.clearRect(0, 0, 16, 32)
      ctx.imageSmoothingEnabled = false

      const is64x32 = img.height === 32

      // 1. Head (Base + Overlay)
      // Base: (8, 8, 8, 8) -> dest: (4, 0, 8, 8)
      ctx.drawImage(img, 8, 8, 8, 8, 4, 0, 8, 8)
      // Overlay/Hair: (40, 8, 8, 8) -> dest: (4, 0, 8, 8)
      ctx.drawImage(img, 40, 8, 8, 8, 4, 0, 8, 8)

      // 2. Torso (Base + Overlay)
      // Base: (20, 20, 8, 12) -> dest: (4, 8, 8, 12)
      ctx.drawImage(img, 20, 20, 8, 12, 4, 8, 8, 12)
      if (!is64x32) {
        // Overlay/Jacket: (20, 36, 8, 12) -> dest: (4, 8, 8, 12)
        ctx.drawImage(img, 20, 36, 8, 12, 4, 8, 8, 12)
      }

      // 3. Right Arm (Base + Overlay)
      // Base: (44, 20, 4, 12) -> dest: (0, 8, 4, 12)
      ctx.drawImage(img, 44, 20, 4, 12, 0, 8, 4, 12)
      if (!is64x32) {
        // Overlay/Sleeve: (44, 36, 4, 12) -> dest: (0, 8, 4, 12)
        ctx.drawImage(img, 44, 36, 4, 12, 0, 8, 4, 12)
      }

      // 4. Left Arm (Base + Overlay)
      if (!is64x32) {
        // Base: (36, 52, 4, 12) -> dest: (12, 8, 4, 12)
        ctx.drawImage(img, 36, 52, 4, 12, 12, 8, 4, 12)
        // Overlay/Sleeve: (52, 52, 4, 12) -> dest: (12, 8, 4, 12)
        ctx.drawImage(img, 52, 52, 4, 12, 12, 8, 4, 12)
      } else {
        // Mirror right arm for legacy 64x32
        ctx.save()
        ctx.translate(16, 0)
        ctx.scale(-1, 1)
        ctx.drawImage(img, 44, 20, 4, 12, 0, 8, 4, 12)
        ctx.restore()
      }

      // 5. Right Leg (Base + Overlay)
      // Base: (4, 20, 4, 12) -> dest: (4, 20, 4, 12)
      ctx.drawImage(img, 4, 20, 4, 12, 4, 20, 4, 12)
      if (!is64x32) {
        // Overlay/Pants: (4, 36, 4, 12) -> dest: (4, 20, 4, 12)
        ctx.drawImage(img, 4, 36, 4, 12, 4, 20, 4, 12)
      }

      // 6. Left Leg (Base + Overlay)
      if (!is64x32) {
        // Base: (20, 52, 4, 12) -> dest: (8, 20, 4, 12)
        ctx.drawImage(img, 20, 52, 4, 12, 8, 20, 4, 12)
        // Overlay/Pants: (4, 52, 4, 12) -> dest: (8, 20, 4, 12)
        ctx.drawImage(img, 4, 52, 4, 12, 8, 20, 4, 12)
      } else {
        // Mirror right leg for legacy 64x32
        ctx.save()
        ctx.translate(16, 0)
        ctx.scale(-1, 1)
        ctx.drawImage(img, 4, 20, 4, 12, 4, 20, 4, 12)
        ctx.restore()
      }

      setIsLoaded(true)
    }

    img.src = skinUrl
  }, [skinUrl])

  return (
    <canvas
      ref={canvasRef}
      aria-label={alt}
      className={className}
      style={{
        width,
        height,
        imageRendering: "pixelated",
        display: isLoaded ? "block" : "none",
        filter: "drop-shadow(0 6px 18px rgba(0,0,0,0.5))",
      }}
    />
  )
}
