export interface SkinItem {
  id: string

  name: string

  shirt?: string

  pants?: string

  skin?: string

  badge?: string

  accent?: string

  customImgUrl?: string

  skinUrl?: string

  model?: "classic" | "slim" | "auto-detect"
}

export interface CapeItem {
  id: string

  name: string

  color?: string

  badge?: string

  accent?: string

  customImgUrl?: string

  capeUrl?: string
}

export interface GlobalSkin {
  id: string

  name: string

  model: "CLASSIC" | "SLIM"

  imageUrl: string

  status: "AVAILABLE" | "UNAVAILABLE"

  createdAt: string

  updatedAt: string
}

export interface PlayerSkin {
  id: string

  userId: string

  model: "CLASSIC" | "SLIM"

  imageUrl: string

  createdAt: string

  updatedAt: string
}

export interface SkinUploadTicket {
  uploadUrl: string

  uploadToken: string

  expiresAt: string

  maxSizeBytes: number
}

export const DEFAULT_SKINS: SkinItem[] = [
  {
    id: "none",

    name: "Sin Skin",

    shirt: "",

    badge: "N/A",

    accent: "#64748b",
  },
]

export const DEFAULT_CAPES: CapeItem[] = [
  {
    id: "none",

    name: "Sin Capa",

    color: "",

    badge: "N/A",

    accent: "#64748b",
  },
]
