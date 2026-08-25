import React, { useEffect, useState } from "react"
import { SkinViewer } from "skinview3d"
import * as THREE from "three"

interface SkinCardPreviewProps {
  skinUrl?: string
  width?: number
  height?: number
  className?: string
  alt?: string
}

// In-memory cache for rendered skin snapshots
const skinThumbnailCache = new Map<string, string>()
const renderQueue: Array<{
  url: string
  resolve: (dataUrl: string) => void
  reject: () => void
}> = []
let isProcessingQueue = false
let sharedViewer: SkinViewer | null = null
let sharedCanvas: HTMLCanvasElement | null = null

function getOrCreateSharedViewer(): { viewer: SkinViewer; canvas: HTMLCanvasElement } {
  if (sharedViewer && sharedCanvas) {
    return { viewer: sharedViewer, canvas: sharedCanvas }
  }

  const canvas = document.createElement("canvas")
  canvas.width = 200
  canvas.height = 320

  const viewer = new SkinViewer({
    canvas,
    width: 200,
    height: 320,
    enableControls: false,
  })

  viewer.background = null

  // Camera setup: closer zoom and centered vertically so character fills the card nicely
  viewer.camera.position.set(0, 0, 36)
  viewer.camera.lookAt(0, 0, 0)
  viewer.zoom = 1.1
  viewer.adjustCameraDistance()

  // Directional lighting from upper front-left for crisp 3D depth & limb shading
  const light = new THREE.DirectionalLight(0xffffff, 0.95)
  light.position.set(-15, 30, 25)
  viewer.scene.add(light)

  const ambient = new THREE.AmbientLight(0xffffff, 0.75)
  viewer.scene.add(ambient)

  sharedViewer = viewer
  sharedCanvas = canvas
  return { viewer, canvas }
}

async function processQueue() {
  if (isProcessingQueue || renderQueue.length === 0) return
  isProcessingQueue = true

  const { viewer, canvas } = getOrCreateSharedViewer()

  while (renderQueue.length > 0) {
    const task = renderQueue.shift()
    if (!task) continue

    if (skinThumbnailCache.has(task.url)) {
      task.resolve(skinThumbnailCache.get(task.url)!)
      continue
    }

    try {
      await viewer.loadSkin(task.url, { model: "auto-detect" })

      // Apply charming 3D isometric presentation pose
      const player = viewer.playerObject
      player.rotation.set(0, 0.42, 0) // Charming 24 degree isometric angle
      player.position.set(0, 0, 0)
      player.skin.resetJoints()

      // Natural limbs & head tilt
      player.skin.head.rotation.set(-0.06, -0.16, 0.04)
      player.skin.leftArm.rotation.set(0.18, 0, 0.18)
      player.skin.rightArm.rotation.set(-0.18, 0, -0.18)
      player.skin.leftLeg.rotation.set(-0.08, 0, 0.05)
      player.skin.rightLeg.rotation.set(0.08, 0, -0.05)

      viewer.render()

      const dataUrl = canvas.toDataURL("image/png")
      skinThumbnailCache.set(task.url, dataUrl)
      task.resolve(dataUrl)
    } catch (err) {
      console.warn("Failed to generate skin thumbnail:", err)
      task.reject()
    }
  }

  isProcessingQueue = false
}

function requestSkinThumbnail(url: string): Promise<string> {
  if (skinThumbnailCache.has(url)) {
    return Promise.resolve(skinThumbnailCache.get(url)!)
  }

  return new Promise<string>((resolve, reject) => {
    renderQueue.push({ url, resolve, reject })
    processQueue()
  })
}

/**
 * Renders a high-resolution 3D isometric posed thumbnail for skins in catalog cards.
 * Uses a single shared offscreen WebGL renderer with full 3D lighting, depth, and hair overlay layers.
 */
export default function SkinCardPreview({
  skinUrl,
  width = 110,
  height = 185,
  className = "",
  alt = "Minecraft Skin",
}: SkinCardPreviewProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(() => {
    return skinUrl ? skinThumbnailCache.get(skinUrl) || null : null
  })

  useEffect(() => {
    if (!skinUrl) {
      setDataUrl(null)
      return
    }

    let isMounted = true
    requestSkinThumbnail(skinUrl)
      .then((url) => {
        if (isMounted) setDataUrl(url)
      })
      .catch(() => {
        if (isMounted) setDataUrl(null)
      })

    return () => {
      isMounted = false
    }
  }, [skinUrl])

  if (!dataUrl) {
    return (
      <div
        style={{
          width,
          height,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          opacity: 0.3,
        }}
      />
    )
  }

  return (
    <img
      src={dataUrl}
      alt={alt}
      className={className}
      style={{
        width,
        height,
        objectFit: "contain",
        display: "block",
        filter: "drop-shadow(0 8px 20px rgba(0,0,0,0.5))",
        pointerEvents: "none",
      }}
    />
  )
}
