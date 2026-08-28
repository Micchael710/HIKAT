import React, { useEffect, useRef, useState } from "react"
import { loadCapeToCanvas } from "skinview-utils"

interface CapeCardPreviewProps {
  capeUrl?: string
  width?: number
  height?: number
  className?: string
  alt?: string
}

/**
 * Renders a crisp 2D cape preview in Back Office catalog cards.
 * Uses skinview-utils loadCapeToCanvas to process standard Minecraft 64x32 templates,
 * HD multiples (128x64, 256x128, 512x256, etc.), and official supported cape formats.
 */
export default function CapeCardPreview({
  capeUrl,
  width = 64,
  height = 96,
  className = "",
  alt = "Capa Minecraft",
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

    let isMounted = true
    const img = new Image()
    img.crossOrigin = "anonymous"

    img.onload = () => {
      if (!isMounted) return

      try {
        const tempCanvas = document.createElement("canvas")
        loadCapeToCanvas(tempCanvas, img)

        canvas.width = 160
        canvas.height = 256
        ctx.clearRect(0, 0, 160, 256)

        // The processed tempCanvas has width 64 * scale, height 32 * scale
        const scale = tempCanvas.width / 64
        ctx.imageSmoothingEnabled = scale > 2

        // Minecraft standard cape front: (1*scale, 1*scale, 10*scale, 16*scale) -> dest (0, 0, 160, 256)
        ctx.drawImage(
          tempCanvas,
          1 * scale,
          1 * scale,
          10 * scale,
          16 * scale,
          0,
          0,
          160,
          256,
        )

        setIsLoaded(true)
      } catch {
        // Bad cape size or incompatible layout - do not crop or display
        setIsLoaded(false)
      }
    }

    img.onerror = () => {
      if (isMounted) setIsLoaded(false)
    }

    img.src = capeUrl

    return () => {
      isMounted = false
    }
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
        filter: "drop-shadow(0 4px 12px rgba(0,0,0,0.4))",
      }}
    />
  )
}
