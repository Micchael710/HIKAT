import React from "react";
import { useCardMotion } from "../../hooks/useCardMotion";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  className?: string;
  interactive?: boolean;
  enableSpotlight?: boolean;
  enableTilt?: boolean;
  onClick?: () => void;
  style?: React.CSSProperties;
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  (
    {
      children,
      className = "",
      interactive = false,
      enableSpotlight = true,
      enableTilt = false,
      onClick,
      style,
      ...props
    },
    forwardedRef
  ) => {
    const internalRef = useCardMotion<HTMLDivElement>({
      enableTilt: interactive && enableTilt,
      maxTilt: 1.2,
      enableSpotlight,
    });

    const setRefs = (node: HTMLDivElement | null) => {
      (internalRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
      if (typeof forwardedRef === "function") {
        forwardedRef(node);
      } else if (forwardedRef) {
        (forwardedRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
      }
    };

    const baseClasses =
      "hikat-glass-card relative overflow-hidden rounded-[22px] border border-white/[0.09] bg-[#121a22]/80 backdrop-blur-xl shadow-[0_8px_30px_rgba(0,0,0,0.45)]";
    const interactiveClasses = interactive
      ? "hikat-glass-card-interactive cursor-pointer hover:border-white/25 transition-all duration-200"
      : "";
    const tiltClass = enableTilt && interactive ? "has-micro-tilt" : "";

    return (
      <div
        ref={setRefs}
        className={`${baseClasses} ${interactiveClasses} ${tiltClass} ${className}`}
        onClick={onClick}
        style={style}
        {...props}
      >
        {enableSpotlight && (
          <>
            {/* Subtle radial spotlight following the cursor */}
            <div className="card-spotlight-layer" aria-hidden="true" />
            {/* Reactive luminous border highlight near cursor */}
            <div className="card-spotlight-border" aria-hidden="true" />
          </>
        )}
        {children}
      </div>
    );
  }
);

Card.displayName = "Card";

