import React, { useEffect, useRef } from "react"

interface SkinHeadPreviewProps {
  imageUrl: string
  size?: number
  className?: string
}

/**
 * 2D Canvas renderer for Minecraft player skin head (base face + hat overlay)
 */
export default function SkinHeadPreview({
  imageUrl,
  size = 48,
  className,
}: SkinHeadPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !imageUrl) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const img = new Image()
    img.crossOrigin = "anonymous"
    img.src = imageUrl

    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.imageSmoothingEnabled = false

      // Scale factors for standard 64x64 or HD skins
      const s = img.width / 64

      // 1. Draw base face: [8, 8, 8, 8]
      ctx.drawImage(img, 8 * s, 8 * s, 8 * s, 8 * s, 0, 0, canvas.width, canvas.height)

      // 2. Draw overlay hat: [40, 8, 8, 8]
      ctx.drawImage(img, 40 * s, 8 * s, 8 * s, 8 * s, 0, 0, canvas.width, canvas.height)
    }
  }, [imageUrl, size])

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      className={className}
      style={{
        width: `${size}px`,
        height: `${size}px`,
        imageRendering: "pixelated",
        borderRadius: "8px",
        backgroundColor: "rgba(0,0,0,0.1)",
      }}
    />
  )
}
