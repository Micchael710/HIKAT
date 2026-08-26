import React, { useEffect, useRef, useState, useCallback } from "react"
import { SkinViewer, WalkingAnimation, RunningAnimation, IdleAnimation } from "skinview3d"
import * as THREE from "three"
import { getNextPose, resetPlayerJoints, SKIN_POSES, SkinPose } from "../../utils/poses"
import { useTranslation } from "../../context/LanguageContext"

export type AnimationType = "pose" | "walk" | "idle" | "run"

export interface SkinViewer3DProps {
  skinUrl?: string
  capeUrl?: string
  model?: "classic" | "slim" | "auto-detect"
  accentHex?: string
  width?: number
  height?: number
  isDark?: boolean
  isCapeMode?: boolean
  initialPoseId?: string
  onPoseChange?: (pose: SkinPose) => void
}

export default function SkinViewer3D({
  skinUrl,
  capeUrl,
  model = "auto-detect",
  accentHex = "#38bdf8",
  width = 400,
  height = 540,
  isDark = true,
  isCapeMode = false,
  initialPoseId,
  onPoseChange,
}: SkinViewer3DProps) {
  const { t } = useTranslation()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const viewerRef = useRef<SkinViewer | null>(null)
  const topSpotLightRef = useRef<THREE.SpotLight | null>(null)
  const pedestalMatRef = useRef<THREE.MeshBasicMaterial | null>(null)
  const shadowLightRef = useRef<THREE.DirectionalLight | null>(null)
  const lastPoseRef = useRef<string>(initialPoseId || "default")
  const [currentPose, setCurrentPose] = useState<SkinPose>(() => {
    return SKIN_POSES.find((p) => p.id === (initialPoseId || "default")) || SKIN_POSES[0]
  })
  // Default animation is "idle" (Respiración)
  const [activeAnimation, setActiveAnimation] = useState<AnimationType>("idle")
  const [autoRotate, setAutoRotate] = useState<boolean>(false)
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [hasError, setHasError] = useState<boolean>(false)

  // Helper to enable shadow casting on all meshes
  const enableShadowCasting = (root: THREE.Object3D) => {
    root.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        child.castShadow = true
        child.receiveShadow = false
      }
    })
  }

  // 1. Initialize SkinViewer instance with real-time Three.js Shadows & Ground Floor
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    try {
      const viewer = new SkinViewer({
        canvas,
        width,
        height,
        enableControls: true,
      })

      // Transparent background
      viewer.background = null

      // Enable WebGL real-time shadow maps
      if (viewer.renderer) {
        viewer.renderer.shadowMap.enabled = true
        viewer.renderer.shadowMap.type = THREE.PCFSoftShadowMap
      }

      // Camera calibrated for perfect centering within the stage frame
      viewer.camera.position.set(0, 10, 52)
      viewer.camera.lookAt(0, 0, 0)
      viewer.zoom = 0.84
      viewer.adjustCameraDistance()

      // Bounded camera controls: full 360 horizontal rotation, bounded vertically so it NEVER goes below the floor!
      if (viewer.controls) {
        viewer.controls.target.set(0, 0, 0)
        viewer.controls.enablePan = false
        viewer.controls.enableRotate = true
        viewer.controls.enableZoom = true
        viewer.controls.minDistance = 25
        viewer.controls.maxDistance = 85
        viewer.controls.minPolarAngle = 0.15 // Look from high above
        viewer.controls.maxPolarAngle = Math.PI / 2 - 0.04 // STOPS right before ground plane! Never clips below!
        viewer.controls.rotateSpeed = 1.0
        viewer.controls.autoRotate = false
        viewer.controls.autoRotateSpeed = 2.4
        viewer.controls.saveState() // Save calibrated neutral state
      }

      // --- 3D Scene Lighting with Real-Time Shadow Projection ---
      // A. Directional Shadow-Casting Light (Upper Left-Front, projecting dynamic shadow to bottom-right)
      const shadowLight = new THREE.DirectionalLight(0xffffff, 0.52)
      shadowLight.position.set(-14, 40, 22)
      shadowLight.castShadow = true
      shadowLight.shadow.mapSize.width = 1024
      shadowLight.shadow.mapSize.height = 1024
      shadowLight.shadow.camera.near = 1
      shadowLight.shadow.camera.far = 120
      shadowLight.shadow.camera.left = -22
      shadowLight.shadow.camera.right = 22
      shadowLight.shadow.camera.top = 35
      shadowLight.shadow.camera.bottom = -25
      shadowLight.shadow.bias = -0.0012
      shadowLight.shadow.radius = 3.5 // Soft shadow blur
      viewer.scene.add(shadowLight)
      shadowLightRef.current = shadowLight

      // B. Overhead Dynamic Accent Spotlight
      const topSpot = new THREE.SpotLight(accentHex, 0.7)
      topSpot.position.set(0, 32, 10)
      topSpot.angle = Math.PI / 3.2
      topSpot.penumbra = 0.85
      topSpot.decay = 1.2
      viewer.scene.add(topSpot)
      topSpotLightRef.current = topSpot

      // C. 3D Pedestal on Floor (52x52 circle canvas with radial glow)
      const pedGeo = new THREE.PlaneGeometry(52, 52)
      const pedCanvas = document.createElement("canvas")
      pedCanvas.width = 512
      pedCanvas.height = 512
      const pedCtx = pedCanvas.getContext("2d")
      if (pedCtx) {
        const radGrd = pedCtx.createRadialGradient(256, 256, 0, 256, 256, 256)
        radGrd.addColorStop(0, "rgba(255, 255, 255, 0.55)")
        radGrd.addColorStop(0.35, "rgba(255, 255, 255, 0.25)")
        radGrd.addColorStop(0.7, "rgba(255, 255, 255, 0.06)")
        radGrd.addColorStop(1, "rgba(255, 255, 255, 0)")
        pedCtx.fillStyle = radGrd
        pedCtx.fillRect(0, 0, 512, 512)
      }
      const pedTex = new THREE.CanvasTexture(pedCanvas)
      const pedMat = new THREE.MeshBasicMaterial({
        map: pedTex,
        color: new THREE.Color(accentHex),
        transparent: true,
        opacity: isDark ? 0.45 : 0.3,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
      const pedMesh = new THREE.Mesh(pedGeo, pedMat)
      pedMesh.rotation.x = -Math.PI / 2
      pedMesh.position.set(0, -16.05, 0)
      viewer.scene.add(pedMesh)
      pedestalMatRef.current = pedMat

      // D. Real-Time Dynamic Shadow Receiver Plane on the Floor
      const shadowReceiverGeo = new THREE.PlaneGeometry(64, 64)
      const shadowReceiverMat = new THREE.ShadowMaterial({
        opacity: 0.45,
      })
      const shadowReceiverMesh = new THREE.Mesh(shadowReceiverGeo, shadowReceiverMat)
      shadowReceiverMesh.rotation.x = -Math.PI / 2
      shadowReceiverMesh.position.set(0, -16.04, 0)
      shadowReceiverMesh.receiveShadow = true
      viewer.scene.add(shadowReceiverMesh)

      // E. Soft front fill and ambient illumination
      const frontFill = new THREE.DirectionalLight(0xffffff, 0.35)
      frontFill.position.set(12, 14, 30)
      viewer.scene.add(frontFill)

      const ambient = new THREE.AmbientLight(isDark ? 0xdddddd : 0xffffff, 0.6)
      viewer.scene.add(ambient)

      enableShadowCasting(viewer.playerObject)

      viewerRef.current = viewer
      setIsLoading(false)
    } catch (err) {
      console.error("Failed to initialize SkinViewer3D:", err)
      setHasError(true)
    }

    return () => {
      if (viewerRef.current) {
        try {
          viewerRef.current.dispose()
        } catch (_) {}
        viewerRef.current = null
        topSpotLightRef.current = null
        pedestalMatRef.current = null
        shadowLightRef.current = null
      }
    }
  }, [width, height, isDark])

  // 2. Synchronize Top Spotlight & 3D Pedestal with dynamic accent
  useEffect(() => {
    if (accentHex) {
      try {
        if (topSpotLightRef.current) topSpotLightRef.current.color.set(accentHex)
        if (pedestalMatRef.current) pedestalMatRef.current.color.set(accentHex)
      } catch (_) {}
    }
  }, [accentHex])

  // 3. OrbitControls Auto-rotation: Rotates camera 360 around the stage
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer) return
    viewer.autoRotate = false
    if (viewer.controls) {
      viewer.controls.autoRotate = autoRotate
      viewer.controls.autoRotateSpeed = 2.4
    }
  }, [autoRotate])

  // 4. Apply Poses / Animations
  const applyPoseOrAnimation = useCallback(
    (pose: SkinPose, animType: AnimationType) => {
      const viewer = viewerRef.current
      if (!viewer) return

      if (animType === "pose") {
        viewer.animation = null
        pose.apply(viewer)
        enableShadowCasting(viewer.playerObject)
        viewer.render()
      } else if (animType === "idle") {
        viewer.animation = null
        resetPlayerJoints(viewer)
        const anim = new IdleAnimation()
        anim.speed = 1.0
        viewer.animation = anim
        enableShadowCasting(viewer.playerObject)
      } else if (animType === "walk") {
        viewer.animation = null
        resetPlayerJoints(viewer)
        const anim = new WalkingAnimation()
        anim.speed = 1.0
        anim.headBobbing = true
        viewer.animation = anim
        enableShadowCasting(viewer.playerObject)
      } else if (animType === "run") {
        viewer.animation = null
        resetPlayerJoints(viewer)
        const anim = new RunningAnimation()
        anim.speed = 1.2
        viewer.animation = anim
        enableShadowCasting(viewer.playerObject)
      }
    },
    [],
  )

  // 5. Select Next Pose in Ordered Sequence
  const triggerNextPose = useCallback(() => {
    const nextPose = getNextPose(lastPoseRef.current, isCapeMode)
    lastPoseRef.current = nextPose.id
    setCurrentPose(nextPose)
    setActiveAnimation("pose")
    applyPoseOrAnimation(nextPose, "pose")
    if (onPoseChange) onPoseChange(nextPose)
  }, [isCapeMode, applyPoseOrAnimation, onPoseChange])

  // 6. Reset Camera View
  const handleResetCamera = useCallback(() => {
    const viewer = viewerRef.current
    if (!viewer) return

    if (viewer.controls) {
      viewer.controls.reset()
      viewer.controls.target.set(0, 0, 0)
      viewer.controls.autoRotate = autoRotate
    }

    viewer.camera.position.set(0, 10, 52)
    viewer.camera.lookAt(0, 0, 0)
    viewer.zoom = 0.84
    viewer.adjustCameraDistance()

    if (viewer.controls) {
      viewer.controls.target.set(0, 0, 0)
      viewer.controls.update()
    }

    viewer.render()
  }, [autoRotate])

  // 7. Load Skin & Cape Textures whenever inputs change
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer) return

    let isMounted = true

    const loadTextures = async () => {
      setIsLoading(true)
      try {
        if (skinUrl) {
          await viewer.loadSkin(skinUrl, {
            model: model === "auto-detect" ? "auto-detect" : model === "slim" ? "slim" : "default",
          })
          if (viewer.playerObject) {
            viewer.playerObject.visible = true
            if (viewer.playerObject.skin) {
              viewer.playerObject.skin.visible = true
            }
          }
        }

        if (capeUrl && capeUrl.trim().length > 0 && capeUrl !== "none") {
          await viewer.loadCape(capeUrl)
          viewer.playerObject.backEquipment = "cape"
          try {
            viewer.playerObject.cape.rotation.y = Math.PI
            if (viewer.playerObject.cape.children && viewer.playerObject.cape.children[0]) {
              viewer.playerObject.cape.children[0].position.z = 0.5
            }
          } catch (_) {}
        } else {
          viewer.resetCape()
          viewer.playerObject.backEquipment = null
        }

        if (!isMounted) return

        enableShadowCasting(viewer.playerObject)

        // Apply active pose or animation (defaults to idle / Respiración)
        if (activeAnimation === "pose") {
          currentPose.apply(viewer)
        } else {
          applyPoseOrAnimation(currentPose, activeAnimation)
        }

        viewer.render()
      } catch (err) {
        console.error("Error loading 3D skin/cape textures:", err)
      } finally {
        if (isMounted) setIsLoading(false)
      }
    }

    loadTextures()

    return () => {
      isMounted = false
    }
  }, [skinUrl, capeUrl, model, isCapeMode, applyPoseOrAnimation, onPoseChange])

  return (
    <div
      style={{
        position: "relative",
        width,
        height,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        userSelect: "none",
      }}
    >
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        style={{
          width: "100%",
          height: "100%",
          display: "block",
          outline: "none",
          cursor: "grab",
          transition: "opacity 0.25s ease",
          opacity: isLoading ? 0.4 : 1,
        }}
      />

      {/* Interactive Controls Overlay */}
      <div
        style={{
          position: "absolute",
          bottom: 16,
          left: 16,
          right: 16,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          zIndex: 10,
          pointerEvents: "auto",
        }}
      >
        {/* Left: Pose changer & Animation selectors */}
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {/* Pose Selector Button (Sequential Order) */}
          <button
            type="button"
            onClick={triggerNextPose}
            title={t("skins.controls.changePose") || "Cambiar pose"}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "7px 13px",
              background: isDark ? "rgba(18, 26, 36, 0.85)" : "rgba(255, 255, 255, 0.9)",
              border: isDark ? "1px solid rgba(255, 255, 255, 0.12)" : "1px solid rgba(0, 0, 0, 0.12)",
              borderRadius: 10,
              color: isDark ? "#ffffff" : "#111827",
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
              backdropFilter: "blur(12px)",
              transition: "all 0.15s ease",
              boxShadow: "0 4px 14px rgba(0,0,0,0.25)",
            }}
          >
            <svg
              width={14}
              height={14}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="4" r="2" />
              <path d="M12 6v7m0 0l-3 7m3-7l3 7M7 10l5 1 5-1" />
            </svg>
            <span>{t(`skins.poses.${currentPose.id}`) || currentPose.name}</span>
          </button>

          {/* Animation Mode Toggle */}
          <button
            type="button"
            onClick={() => {
              const animCycle: AnimationType[] = ["idle", "walk", "run", "pose"]
              const nextIdx = (animCycle.indexOf(activeAnimation) + 1) % animCycle.length
              const nextAnim = animCycle[nextIdx]
              setActiveAnimation(nextAnim)
              applyPoseOrAnimation(currentPose, nextAnim)
            }}
            title={t("skins.controls.changeAnimation") || "Cambiar animación"}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "7px 13px",
              background: isDark ? "rgba(18, 26, 36, 0.85)" : "rgba(255, 255, 255, 0.9)",
              border: isDark ? "1px solid rgba(255, 255, 255, 0.12)" : "1px solid rgba(0, 0, 0, 0.12)",
              borderRadius: 10,
              color: isDark ? "#ffffff" : "#111827",
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
              backdropFilter: "blur(12px)",
              transition: "all 0.15s ease",
              boxShadow: "0 4px 14px rgba(0,0,0,0.25)",
            }}
          >
            <svg
              width={14}
              height={14}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
            <span>
              {t(`skins.animations.${activeAnimation}`) ||
                (activeAnimation === "idle"
                  ? "Respiración"
                  : activeAnimation === "walk"
                    ? "Caminando"
                    : activeAnimation === "run"
                      ? "Corriendo"
                      : "Pose Fija")}
            </span>
          </button>
        </div>

        {/* Right: Camera Reset & 360 Auto-Rotate */}
        <div style={{ display: "flex", gap: 6 }}>
          {/* Auto-Rotate Toggle */}
          <button
            type="button"
            onClick={() => setAutoRotate(!autoRotate)}
            title={t("skins.controls.toggleRotate") || "Giro 360°"}
            style={{
              width: 32,
              height: 32,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: autoRotate
                ? `rgba(${accentHex}, 0.35)`
                : isDark
                  ? "rgba(18, 26, 36, 0.85)"
                  : "rgba(255, 255, 255, 0.9)",
              border: isDark ? "1px solid rgba(255, 255, 255, 0.12)" : "1px solid rgba(0, 0, 0, 0.12)",
              borderRadius: 10,
              color: isDark ? "#ffffff" : "#111827",
              cursor: "pointer",
              backdropFilter: "blur(12px)",
              transition: "all 0.15s ease",
              boxShadow: "0 4px 14px rgba(0,0,0,0.25)",
            }}
          >
            <svg
              width={14}
              height={14}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
            </svg>
          </button>

          {/* Reset Camera View */}
          <button
            type="button"
            onClick={handleResetCamera}
            title={t("skins.controls.resetCamera") || "Reiniciar cámara"}

            style={{
              width: 32,
              height: 32,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: isDark ? "rgba(18, 26, 36, 0.85)" : "rgba(255, 255, 255, 0.9)",
              border: isDark ? "1px solid rgba(255, 255, 255, 0.12)" : "1px solid rgba(0, 0, 0, 0.12)",
              borderRadius: 10,
              color: isDark ? "#ffffff" : "#111827",
              cursor: "pointer",
              backdropFilter: "blur(12px)",
              transition: "all 0.15s ease",
              boxShadow: "0 4px 14px rgba(0,0,0,0.25)",
            }}
          >
            <svg
              width={14}
              height={14}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M3 12h3m12 0h3M12 3v3m0 12v3" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}
