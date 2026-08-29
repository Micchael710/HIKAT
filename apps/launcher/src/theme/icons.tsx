import React from "react"

export const IconHome = ({ size = 26 }: { active?: boolean; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <path d="M10.8 2.5a1.8 1.8 0 0 1 2.4 0l7.2 6.1c.6.5.9 1.2.9 2v9.6a1.8 1.8 0 0 1-1.8 1.8h-4.2a1.2 1.2 0 0 1-1.2-1.2v-4.6a1.2 1.2 0 0 0-1.2-1.2h-1.8a1.2 1.2 0 0 0-1.2 1.2v4.6a1.2 1.2 0 0 1-1.2 1.2H4.5A1.8 1.8 0 0 1 2.7 20.2v-9.6c0-.8.3-1.5.9-2l7.2-6.1z" />
  </svg>
)

export const IconShirt = ({
  size = 26,
}: {
  active?: boolean
  size?: number
}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <path d="M15.4 2.6a4.2 4.2 0 0 1-6.8 0L4.5 4.3a2 2 0 0 0-1.4 1.9l.6 3.6a1.5 1.5 0 0 0 1.8 1.2l1-.2V20a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2v-9.2l1 .2a1.5 1.5 0 0 0 1.8-1.2l.6-3.6a2 2 0 0 0-1.4-1.9L15.4 2.6z" />
  </svg>
)

export const IconSettings = ({
  size = 26,
}: {
  active?: boolean
  size?: number
}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M12 1a2 2 0 0 1 1.95 1.56l.24 1.13a7.5 7.5 0 0 1 2.23.92l1.01-.58a2 2 0 0 1 2.45.36l.7.7a2 2 0 0 1 .36 2.45l-.58 1.01c.37.71.69 1.46.92 2.23l1.13.24A2 2 0 0 1 23 12a2 2 0 0 1-1.56 1.95l-1.13.24a7.5 7.5 0 0 1-.92 2.23l.58 1.01a2 2 0 0 1-.36 2.45l-.7.7a2 2 0 0 1-2.45.36l-1.01-.58a7.5 7.5 0 0 1-2.23.92l-.24 1.13A2 2 0 0 1 12 23a2 2 0 0 1-1.95-1.56l-.24-1.13a7.5 7.5 0 0 1-2.23-.92l-1.01.58a2 2 0 0 1-2.45-.36l-.7-.7a2 2 0 0 1-.36-2.45l.58-1.01a7.5 7.5 0 0 1-.92-2.23l-1.13-.24A2 2 0 0 1 1 12a2 2 0 0 1 1.56-1.95l1.13-.24a7.5 7.5 0 0 1 .92-2.23l-.58-1.01a2 2 0 0 1 .36-2.45l.7-.7a2 2 0 0 1 2.45-.36l1.01.58a7.5 7.5 0 0 1 2.23-.92l.24-1.13A2 2 0 0 1 12 1zm0 7a4 4 0 1 0 0 8 4 4 0 0 0 0-8z"
    />
  </svg>
)

export const IconDownload = ({ size = 40 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="white"
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 3v13M6 10l6 6 6-6" />
    <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
  </svg>
)

export const IconChevronRight = ({ size = 20 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.6"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="9 18 15 12 9 6" />
  </svg>
)

export const IconChevronLeft = ({ size = 20 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.6"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="15 18 9 12 15 6" />
  </svg>
)

export const IconUser = () => (
  <svg
    width="15"
    height="15"
    viewBox="0 0 15 15"
    fill="none"
    stroke="rgba(255,255,255,0.65)"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="7.5" cy="5" r="3" />
    <path d="M1.5 14c0-3.314 2.686-5 6-5s6 1.686 6 5" />
  </svg>
)

export const IconLogout = () => (
  <svg
    width="15"
    height="15"
    viewBox="0 0 15 15"
    fill="none"
    stroke="rgba(255,100,80,0.9)"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M5 13H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h2M10 10l3-3-3-3M13 7H6" />
  </svg>
)

export const IconMoon = ({ size = 18 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
)

export const IconSun = ({ size = 18 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="5" />
    <line x1="12" y1="1" x2="12" y2="3" />
    <line x1="12" y1="21" x2="12" y2="23" />
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
    <line x1="1" y1="12" x2="3" y2="12" />
    <line x1="21" y1="12" x2="23" y2="12" />
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
  </svg>
)

export const IconPlay = ({ size = 36 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <polygon points="6,3 20,12 6,21" fill="white" />
  </svg>
)

export const IconResume = ({
  size = 14,
  color = "white",
}: {
  size?: number
  color?: string
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    style={{ flexShrink: 0 }}
  >
    <rect x="2" y="2" width="12" height="2.5" rx="0.5" fill={color} />
    <polygon points="8,14 2,6 14,6" fill={color} />
  </svg>
)

export const IconPause = ({
  size = 14,
  color = "#efc436",
}: {
  size?: number
  color?: string
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    style={{ flexShrink: 0 }}
  >
    <rect x="2" y="2" width="12" height="2.5" rx="0.5" fill={color} />
    <polygon points="8,14 2,6 14,6" fill={color} />
  </svg>
)

export const HikatSvgLogo = ({ size = 48 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
    <circle cx="24" cy="24" r="22" stroke="currentColor" strokeWidth="1.5" />
    <circle
      cx="24"
      cy="24"
      r="19"
      stroke="currentColor"
      strokeWidth="0.6"
      strokeDasharray="2 3"
    />
    <ellipse
      cx="24"
      cy="25"
      rx="10"
      ry="9"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
    />
    <polygon points="16,19 13.5,12 20,17" fill="currentColor" />
    <polygon points="32,19 34.5,12 28,17" fill="currentColor" />
    <polygon points="16.5,18.5 14.5,13.5 19.5,17.5" fill="#1a2030" />
    <polygon points="31.5,18.5 33.5,13.5 28.5,17.5" fill="#1a2030" />
    <ellipse cx="20.5" cy="24" rx="1.8" ry="2" fill="currentColor" />
    <ellipse cx="27.5" cy="24" rx="1.8" ry="2" fill="currentColor" />
    <circle cx="20.5" cy="24" r="1" fill="#1a2030" />
    <circle cx="27.5" cy="24" r="1" fill="#1a2030" />
    <path d="M22.5 27L24 28.5L25.5 27L24 26.5Z" fill="currentColor" />
    <line
      x1="13"
      y1="26"
      x2="21"
      y2="27"
      stroke="currentColor"
      strokeWidth="0.6"
    />
    <line
      x1="13"
      y1="28"
      x2="21"
      y2="28"
      stroke="currentColor"
      strokeWidth="0.6"
    />
    <line
      x1="35"
      y1="26"
      x2="27"
      y2="27"
      stroke="currentColor"
      strokeWidth="0.6"
    />
    <line
      x1="35"
      y1="28"
      x2="27"
      y2="28"
      stroke="currentColor"
      strokeWidth="0.6"
    />
    <polygon
      points="24,38 27,41 24,44 21,41"
      fill="none"
      stroke="currentColor"
      strokeWidth="0.8"
    />
  </svg>
)

export const IconGoogle = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24">
    <path
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      fill="#4285F4"
    />
    <path
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      fill="#34A853"
    />
    <path
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
      fill="#FBBC05"
    />
    <path
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
      fill="#EA4335"
    />
  </svg>
)

export const IconDiscord = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24">
    <path
      d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994.021-.041.001-.09-.041-.106a13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.929 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.893.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"
      fill="#5865F2"
    />
  </svg>
)

export const IconCross = ({ size = 18 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.4"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
)

