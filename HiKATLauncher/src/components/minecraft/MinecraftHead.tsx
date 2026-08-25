import React, { useEffect, useRef, useState } from "react"

interface MinecraftHeadProps {
  skinId?: string
  skinColor?: string
  customImgUrl?: string
  size?: number
}

/**
 * Renders a pixel-perfect 2D Minecraft Head Avatar (8x8 canvas with head + hair overlay).
 * If no custom texture is provided, renders a stylish vector fallback.
 */
export default function MinecraftHead({
  customImgUrl,
  size = 38,
}: MinecraftHeadProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [hasCanvasLoaded, setHasCanvasLoaded] = useState(false)

  useEffect(() => {
    if (!customImgUrl) {
      setHasCanvasLoaded(false)
      return
    }

    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const img = new Image()
    img.crossOrigin = "anonymous"

    img.onload = () => {
      // Internal 8x8 Minecraft Head resolution
      canvas.width = 8
      canvas.height = 8

      ctx.clearRect(0, 0, 8, 8)
      ctx.imageSmoothingEnabled = false

      // 1. Base Head Face (8, 8, 8, 8)
      ctx.drawImage(img, 8, 8, 8, 8, 0, 0, 8, 8)

      // 2. Hat / Hair Overlay (40, 8, 8, 8)
      ctx.drawImage(img, 40, 8, 8, 8, 0, 0, 8, 8)

      setHasCanvasLoaded(true)
    }

    img.onerror = () => {
      setHasCanvasLoaded(false)
    }

    img.src = customImgUrl
  }, [customImgUrl])

  if (customImgUrl) {
    return (
      <canvas
        ref={canvasRef}
        style={{
          width: size,
          height: size,
          display: hasCanvasLoaded ? "block" : "none",
          imageRendering: "pixelated",
          borderRadius: "50%",
        }}
      />
    )
  }

  // Clean Default Steve / User Avatar Fallback
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{
        width: size,
        height: size,
        color: "rgba(255, 255, 255, 0.6)",
        padding: 4,
      }}
    >
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  )
}
