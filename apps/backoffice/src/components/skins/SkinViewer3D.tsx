import React, { useEffect, useRef, useState, useCallback } from "react"
import { SkinViewer, IdleAnimation, WalkingAnimation, RunningAnimation } from "skinview3d"
import type { ThemeMode, SkinModel } from "../../types"
import { resolveMediaUrl } from "../../services/graphqlClient"
import { IconSpinner, IconRefresh } from "../../theme/icons"

interface SkinViewer3DProps {
  skinUrl: string
  model?: SkinModel
  width?: number
  height?: number
  theme?: ThemeMode
  autoRotate?: boolean
  className?: string
}

export default function SkinViewer3D({
  skinUrl,
  model = "CLASSIC",
  width = 280,
  height = 360,
  theme = "dark",
  autoRotate = true,
  className,
}: SkinViewer3DProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const viewerRef = useRef<SkinViewer | null>(null)

  const [isLoading, setIsLoading] = useState(true)
  const [hasError, setHasError] = useState(false)
  const [isRotating, setIsRotating] = useState(autoRotate)
  const [animationType, setAnimationType] = useState<"idle" | "walk" | "run" | "none">("idle")

  const isDark = theme === "dark"
  const resolvedUrl = resolveMediaUrl(skinUrl)

  // 1. Initialize SkinViewer instance
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let isMounted = true
    setHasError(false)
    setIsLoading(true)

    try {
      const viewer = new SkinViewer({
        canvas,
        width,
        height,
        enableControls: true,
      })

      viewer.background = null

      // Calibrate camera
      if (viewer.camera) {
        viewer.camera.position?.set?.(0, 5, 48)
        viewer.camera.lookAt?.(0, 0, 0)
      }
      viewer.zoom = 0.9
      viewer.adjustCameraDistance?.()


      if (viewer.controls) {
        viewer.controls.enablePan = false
        viewer.controls.enableRotate = true
        viewer.controls.enableZoom = true
        viewer.controls.minDistance = 20
        viewer.controls.maxDistance = 80
        viewer.controls.rotateSpeed = 1.0
        viewer.controls.autoRotate = isRotating
        viewer.controls.autoRotateSpeed = 1.8
      }

      // Default idle animation
      const idleAnim = new IdleAnimation()
      idleAnim.speed = 0.8
      viewer.animation = idleAnim

      viewerRef.current = viewer

      // Load skin texture
      if (resolvedUrl) {
        viewer
          .loadSkin(resolvedUrl, {
            model: model === "SLIM" ? "slim" : "default",
          })
          .then(() => {
            if (isMounted) {
              setIsLoading(false)
              viewer.render()
            }
          })
          .catch((err) => {
            console.error("Failed to load skin in 3D viewer:", err)
            if (isMounted) {
              setHasError(true)
              setIsLoading(false)
            }
          })
      } else {
        setIsLoading(false)
      }
    } catch (err) {
      console.error("Failed to initialize 3D viewer WebGL canvas:", err)
      setHasError(true)
      setIsLoading(false)
    }

    return () => {
      isMounted = false
      if (viewerRef.current) {
        try {
          viewerRef.current.dispose()
        } catch (_) {}
        viewerRef.current = null
      }
    }
  }, [width, height])

  // 2. Update skin texture and model dynamically
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || !resolvedUrl) return

    let isMounted = true
    setIsLoading(true)
    setHasError(false)

    viewer
      .loadSkin(resolvedUrl, {
        model: model === "SLIM" ? "slim" : "default",
      })
      .then(() => {
        if (isMounted) {
          setIsLoading(false)
          viewer.render()
        }
      })
      .catch((err) => {
        console.error("Error updating 3D skin texture:", err)
        if (isMounted) {
          setHasError(true)
          setIsLoading(false)
        }
      })

    return () => {
      isMounted = false
    }
  }, [resolvedUrl, model])

  // 3. Auto-rotation control
  useEffect(() => {
    const viewer = viewerRef.current
    if (viewer?.controls) {
      viewer.controls.autoRotate = isRotating
      viewer.controls.autoRotateSpeed = 1.8
    }
  }, [isRotating])

  // 4. Animation switcher
  const handleToggleAnimation = useCallback(() => {
    const viewer = viewerRef.current
    if (!viewer) return

    const cycle: Array<"idle" | "walk" | "run" | "none"> = ["idle", "walk", "run", "none"]
    const nextIdx = (cycle.indexOf(animationType) + 1) % cycle.length
    const next = cycle[nextIdx] ?? "idle"
    setAnimationType(next)

    if (next === "idle") {
      const anim = new IdleAnimation()
      anim.speed = 0.8
      viewer.animation = anim
    } else if (next === "walk") {
      const anim = new WalkingAnimation()
      anim.speed = 1.0
      anim.headBobbing = true
      viewer.animation = anim
    } else if (next === "run") {
      const anim = new RunningAnimation()
      anim.speed = 1.2
      viewer.animation = anim
    } else {
      viewer.animation = null
      viewer.render()
    }
  }, [animationType])

  const handleResetCamera = useCallback(() => {
    const viewer = viewerRef.current
    if (!viewer) return

    if (viewer.camera) {
      viewer.camera.position?.set?.(0, 5, 48)
      viewer.camera.lookAt?.(0, 0, 0)
    }
    viewer.zoom = 0.9
    viewer.adjustCameraDistance?.()


    if (viewer.controls) {
      viewer.controls.target.set(0, 0, 0)
      viewer.controls.update()
    }
    viewer.render()
  }, [])

  return (
    <div
      className={className}
      style={{
        position: "relative",
        width,
        height,
        borderRadius: "12px",
        overflow: "hidden",
        backgroundColor: isDark ? "rgba(15, 23, 42, 0.6)" : "rgba(241, 245, 249, 0.8)",
        border: `1px solid ${isDark ? "#334155" : "#e2e8f0"}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        style={{
          width: "100%",
          height: "100%",
          display: hasError ? "none" : "block",
          cursor: "grab",
          outline: "none",
        }}
      />

      {isLoading && !hasError && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
            backgroundColor: isDark ? "rgba(15, 23, 42, 0.7)" : "rgba(255, 255, 255, 0.7)",
            color: isDark ? "#94a3b8" : "#64748b",
            fontSize: "12px",
            backdropFilter: "blur(2px)",
          }}
        >
          <IconSpinner size={20} />
          <span>Cargando modelo 3D...</span>
        </div>
      )}

      {hasError && (
        <div
          style={{
            padding: "20px",
            textAlign: "center",
            color: isDark ? "#94a3b8" : "#64748b",
            fontSize: "13px",
          }}
        >
          No se pudo mostrar la skin en 3D.
        </div>
      )}

      {/* Floating Viewer Controls */}
      {!hasError && (
        <div
          style={{
            position: "absolute",
            bottom: "10px",
            left: "10px",
            right: "10px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            pointerEvents: "auto",
          }}
        >
          <div style={{ display: "flex", gap: "6px" }}>
            <button
              type="button"
              onClick={handleToggleAnimation}
              title="Cambiar animación"
              style={{
                padding: "5px 10px",
                borderRadius: "6px",
                border: `1px solid ${isDark ? "#475569" : "#cbd5e1"}`,
                backgroundColor: isDark ? "rgba(30, 41, 59, 0.85)" : "rgba(255, 255, 255, 0.9)",
                color: isDark ? "#f1f5f9" : "#1e293b",
                fontSize: "11px",
                fontWeight: "600",
                cursor: "pointer",
                backdropFilter: "blur(4px)",
              }}
            >
              {animationType === "idle"
                ? "Respiración"
                : animationType === "walk"
                  ? "Caminando"
                  : animationType === "run"
                    ? "Corriendo"
                    : "Pausado"}
            </button>

            <button
              type="button"
              onClick={() => setIsRotating(!isRotating)}
              title="Rotación automática"
              style={{
                padding: "5px 8px",
                borderRadius: "6px",
                border: `1px solid ${isRotating ? "#6366f1" : isDark ? "#475569" : "#cbd5e1"}`,
                backgroundColor: isRotating
                  ? (isDark ? "rgba(99, 102, 241, 0.3)" : "#eef2ff")
                  : (isDark ? "rgba(30, 41, 59, 0.85)" : "rgba(255, 255, 255, 0.9)"),
                color: isRotating ? "#6366f1" : isDark ? "#f1f5f9" : "#1e293b",
                fontSize: "11px",
                fontWeight: "600",
                cursor: "pointer",
                backdropFilter: "blur(4px)",
              }}
            >
              Giro 360°
            </button>
          </div>

          <button
            type="button"
            onClick={handleResetCamera}
            title="Centrar vista"
            style={{
              width: "28px",
              height: "28px",
              borderRadius: "6px",
              border: `1px solid ${isDark ? "#475569" : "#cbd5e1"}`,
              backgroundColor: isDark ? "rgba(30, 41, 59, 0.85)" : "rgba(255, 255, 255, 0.9)",
              color: isDark ? "#f1f5f9" : "#1e293b",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              backdropFilter: "blur(4px)",
            }}
          >
            <IconRefresh size={14} />
          </button>
        </div>
      )}
    </div>
  )
}
