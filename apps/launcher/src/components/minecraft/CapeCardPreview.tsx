import React, { useEffect, useRef, useState } from "react"

interface CapeCardPreviewProps {
  capeUrl?: string
  width?: number
  height?: number
  className?: string
  alt?: string
}

/**
 * Renders a crisp 2D cape preview in catalog cards.
 * Supports standard Minecraft 64x32 templates, HD multiples (128x64, 512x256, etc.),
 * and custom full-image/artwork cape uploads.
 */
export default function CapeCardPreview({
  capeUrl,
  width = 90,
  height = 144,
  className = "",
  alt = "Minecraft Cape",
}: CapeCardPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [isLoaded, setIsLoaded] = useState(false)

  useEffect(() => {
    if (!capeUrl || capeUrl === "none") {
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
      canvas.width = 160
      canvas.height = 256

      ctx.clearRect(0, 0, 160, 256)

      const isStandardMinecraftTemplate =
        img.width === img.height * 2 && img.width >= 64 && img.width % 64 === 0

      if (isStandardMinecraftTemplate) {
        ctx.imageSmoothingEnabled = img.width > 128
        const scale = img.width / 64
        // Minecraft standard cape front: (1*scale, 1*scale, 10*scale, 16*scale) -> dest (0, 0, 160, 256)
        ctx.drawImage(
          img,
          1 * scale,
          1 * scale,
          10 * scale,
          16 * scale,
          0,
          0,
          160,
          256,
        )
      } else {
        // Custom HD artwork / full image cape
        ctx.imageSmoothingEnabled = true
        // Crop/fit image proportionally into the 160x256 cape aspect ratio
        const imgRatio = img.width / img.height
        const targetRatio = 160 / 256

        let sx = 0,
          sy = 0,
          sw = img.width,
          sh = img.height
        if (imgRatio > targetRatio) {
          sw = img.height * targetRatio
          sx = (img.width - sw) / 2
        } else {
          sh = img.width / targetRatio
          sy = (img.height - sh) / 2
        }
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, 160, 256)
      }

      setIsLoaded(true)
    }

    img.src = capeUrl
  }, [capeUrl])

  return (
    <canvas
      ref={canvasRef}
      aria-label={alt}
      className={className}
      style={{
        width,
        height,
        borderRadius: 8,
        imageRendering: "auto",
        display: isLoaded ? "block" : "none",
        filter: "drop-shadow(0 8px 20px rgba(0,0,0,0.5))",
      }}
    />
  )
}
