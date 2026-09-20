import React, { useEffect, useRef, useState } from "react";

export interface ScrollRevealProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  className?: string;
  delay?: number; // stagger delay in ms
  threshold?: number;
  as?: React.ElementType;
}

export const ScrollReveal: React.FC<ScrollRevealProps> = ({
  children,
  className = "",
  delay = 0,
  threshold = 0.1,
  as: Component = "div",
  style,
  ...props
}) => {
  const ref = useRef<HTMLElement>(null);
  const [isClient, setIsClient] = useState(false);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    setIsClient(true);

    // If reduced motion is requested, reveal immediately
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setRevealed(true);
      return;
    }

    const el = ref.current;
    if (!el) return;

    if (!("IntersectionObserver" in window)) {
      setRevealed(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setRevealed(true);
          observer.disconnect();
        }
      },
      {
        threshold,
        rootMargin: "0px 0px -40px 0px",
      }
    );

    observer.observe(el);

    return () => {
      observer.disconnect();
    };
  }, [threshold]);

  // Progressive enhancement: if not in client or revealed, apply revealed state
  const revealClass = isClient
    ? `reveal-on-scroll ${revealed ? "is-revealed" : ""}`
    : "";

  return (
    <Component
      ref={ref}
      className={`${revealClass} ${className}`}
      style={{
        ...style,
        ...(isClient && delay > 0 ? { transitionDelay: `${delay}ms` } : {}),
      }}
      {...props}
    >
      {children}
    </Component>
  );
};
