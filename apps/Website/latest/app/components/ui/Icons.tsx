import React from "react";

interface IconProps {
  size?: number;
  className?: string;
}

export function HikatLogoSvg({ size = 36, className = "" }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <circle cx="24" cy="24" r="22" stroke="currentColor" strokeWidth="1.8" />
      <circle
        cx="24"
        cy="24"
        r="19"
        stroke="currentColor"
        strokeWidth="0.8"
        strokeDasharray="2 3"
      />
      <ellipse
        cx="24"
        cy="25"
        rx="10"
        ry="9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <polygon points="16,19 13.5,12 20,17" fill="currentColor" />
      <polygon points="32,19 34.5,12 28,17" fill="currentColor" />
      <polygon points="16.5,18.5 14.5,13.5 19.5,17.5" fill="#121a22" />
      <polygon points="31.5,18.5 33.5,13.5 28.5,17.5" fill="#121a22" />
      <ellipse cx="20.5" cy="24" rx="1.8" ry="2" fill="currentColor" />
      <ellipse cx="27.5" cy="24" rx="1.8" ry="2" fill="currentColor" />
      <circle cx="20.5" cy="24" r="1" fill="#121a22" />
      <circle cx="27.5" cy="24" r="1" fill="#121a22" />
      <path d="M22.5 27L24 28.5L25.5 27L24 26.5Z" fill="currentColor" />
      <line x1="13" y1="26" x2="21" y2="27" stroke="currentColor" strokeWidth="0.8" />
      <line x1="13" y1="28" x2="21" y2="28" stroke="currentColor" strokeWidth="0.8" />
      <line x1="35" y1="26" x2="27" y2="27" stroke="currentColor" strokeWidth="0.8" />
      <line x1="35" y1="28" x2="27" y2="28" stroke="currentColor" strokeWidth="0.8" />
      <polygon
        points="24,38 27,41 24,44 21,41"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
      />
    </svg>
  );
}

export function IconDownload({ size = 20, className = "" }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 3v13M6 10l6 6 6-6" />
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </svg>
  );
}

export function IconArrowRight({ size = 20, className = "" }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M5 12h14M12 5l7 7-7 7" />
    </svg>
  );
}

export function IconPlay({ size = 20, className = "" }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  );
}

export function IconShirt({ size = 22, className = "" }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M15.4 2.6a4.2 4.2 0 0 1-6.8 0L4.5 4.3a2 2 0 0 0-1.4 1.9l.6 3.6a1.5 1.5 0 0 0 1.8 1.2l1-.2V20a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2v-9.2l1 .2a1.5 1.5 0 0 0 1.8-1.2l.6-3.6a2 2 0 0 0-1.4-1.9L15.4 2.6z" />
    </svg>
  );
}

export function IconServer({ size = 22, className = "" }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
      <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
      <line x1="6" y1="6" x2="6.01" y2="6" strokeWidth="3" />
      <line x1="6" y1="18" x2="6.01" y2="18" strokeWidth="3" />
    </svg>
  );
}

export function IconLauncherBadge({ size = 24, className = "" }: IconProps) {
  return (
    <div
      style={{ width: size, height: size }}
      className={`flex items-center justify-center font-black text-amber-300 font-mono ${className}`}
      aria-hidden="true"
    >
      <span className="text-xl tracking-tighter drop-shadow-[0_2px_8px_rgba(245,158,11,0.6)]">
        A
      </span>
    </div>
  );
}

export function IconDiscord({ size = 20, className = "" }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994.021-.041.001-.09-.041-.106a13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.929 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.893.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}

export function IconUsers({ size = 20, className = "" }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

export function IconGear({ size = 18, className = "" }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

export function IconBars({ size = 18, className = "" }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  );
}

export function IconMouseScroll({ size = 28, className = "" }: IconProps) {
  return (
    <svg
      width={size}
      height={size * 1.5}
      viewBox="0 0 24 36"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className={className}
      aria-hidden="true"
    >
      <rect x="2" y="2" width="20" height="32" rx="10" />
      <line
        x1="12"
        y1="8"
        x2="12"
        y2="14"
        strokeWidth="2.5"
        strokeLinecap="round"
        className="mouse-scroll-wheel"
      />
    </svg>
  );
}

export function DynamicBadgeIcon({
  type,
  size = 22,
}: {
  type: "launcher" | "skins" | "server" | "custom" | string;
  size?: number;
}) {
  switch (type) {
    case "launcher":
      return <IconLauncherBadge size={size} />;
    case "skins":
      return <IconShirt size={size} className="text-cyan-400" />;
    case "server":
      return <IconServer size={size} className="text-purple-400" />;
    default:
      return <IconLauncherBadge size={size} />;
  }
}
