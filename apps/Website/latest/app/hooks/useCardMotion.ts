import { useEffect, useRef } from "react";

export interface CardMotionOptions {
  enableTilt?: boolean;
  maxTilt?: number; // max tilt in degrees (default 1.2)
  enableSpotlight?: boolean;
}

export function useCardMotion<T extends HTMLElement = HTMLDivElement>(
  options: CardMotionOptions = {}
) {
  const ref = useRef<T>(null);
  const { enableTilt = false, maxTilt = 1.2, enableSpotlight = true } = options;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Only enable pointer tracking on fine pointer devices without reduced motion
    const hoverQuery = window.matchMedia("(hover: hover) and (pointer: fine)");
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

    if (!hoverQuery.matches || motionQuery.matches) {
      return;
    }

    let rafId: number | null = null;
    let targetX = -999;
    let targetY = -999;
    let targetTiltX = 0;
    let targetTiltY = 0;
    let currentTiltX = 0;
    let currentTiltY = 0;
    let isHovering = false;

    const render = () => {
      if (!el) return;

      if (enableSpotlight) {
        el.style.setProperty("--mouse-x", `${targetX}px`);
        el.style.setProperty("--mouse-y", `${targetY}px`);
        el.style.setProperty("--spotlight-opacity", isHovering ? "1" : "0");
      }

      if (enableTilt) {
        currentTiltX += (targetTiltX - currentTiltX) * 0.15;
        currentTiltY += (targetTiltY - currentTiltY) * 0.15;

        el.style.setProperty("--tilt-x", `${currentTiltX.toFixed(2)}deg`);
        el.style.setProperty("--tilt-y", `${currentTiltY.toFixed(2)}deg`);

        // If still animating tilt towards 0 after leave
        if (!isHovering && Math.abs(currentTiltX) < 0.05 && Math.abs(currentTiltY) < 0.05) {
          el.style.setProperty("--tilt-x", "0deg");
          el.style.setProperty("--tilt-y", "0deg");
          rafId = null;
          return;
        }
      }

      if (isHovering || Math.abs(currentTiltX) > 0.05 || Math.abs(currentTiltY) > 0.05) {
        rafId = requestAnimationFrame(render);
      } else {
        rafId = null;
      }
    };

    const handlePointerMove = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      targetX = e.clientX - rect.left;
      targetY = e.clientY - rect.top;
      isHovering = true;

      if (enableTilt) {
        const normX = ((targetX / rect.width) - 0.5) * 2; // -1 to 1
        const normY = ((targetY / rect.height) - 0.5) * 2; // -1 to 1
        targetTiltX = -normY * maxTilt;
        targetTiltY = normX * maxTilt;
      }

      if (rafId === null) {
        rafId = requestAnimationFrame(render);
      }
    };

    const handlePointerLeave = () => {
      isHovering = false;
      targetTiltX = 0;
      targetTiltY = 0;

      if (rafId === null) {
        rafId = requestAnimationFrame(render);
      }
    };

    el.addEventListener("pointermove", handlePointerMove, { passive: true });
    el.addEventListener("pointerleave", handlePointerLeave, { passive: true });

    return () => {
      el.removeEventListener("pointermove", handlePointerMove);
      el.removeEventListener("pointerleave", handlePointerLeave);
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [enableTilt, maxTilt, enableSpotlight]);

  return ref;
}
