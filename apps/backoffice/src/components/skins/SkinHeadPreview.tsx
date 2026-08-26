import React, { useEffect, useRef, useState } from "react"
import { resolveMediaUrl } from "../../services/graphqlClient"
import { IconShirt } from "../../theme/icons"

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
  const [hasError, setHasError] = useState(false)
  const resolvedUrl = resolveMediaUrl(imageUrl)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !resolvedUrl) return

    setHasError(false)
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const img = new Image()
    img.crossOrigin = "anonymous"
    img.src = resolvedUrl

    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.imageSmoothingEnabled = false

      // Scale factor for standard 64x64, 64x32, or HD skins
      const s = img.width / 64

      // 1. Draw base face: [8, 8, 8, 8]
      ctx.drawImage(img, 8 * s, 8 * s, 8 * s, 8 * s, 0, 0, canvas.width, canvas.height)

      // 2. Draw overlay hat: [40, 8, 8, 8]
      ctx.drawImage(img, 40 * s, 8 * s, 8 * s, 8 * s, 0, 0, canvas.width, canvas.height)
    }

    img.onerror = () => {
      setHasError(true)
    }
  }, [resolvedUrl, size])

  if (hasError || !resolvedUrl) {
    return (
      <div
        className={className}
        style={{
          width: `${size}px`,
          height: `${size}px`,
          borderRadius: "8px",
          backgroundColor: "rgba(148, 163, 184, 0.15)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#94a3b8",
        }}
        title="No se pudo mostrar la skin"
      >
        <IconShirt size={Math.round(size * 0.5)} />
      </div>
    )
  }

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
        backgroundColor: "rgba(0, 0, 0, 0.08)",
      }}
    />
  )
}
