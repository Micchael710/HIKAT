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
  imageUrl: string
  status: "AVAILABLE" | "UNAVAILABLE"
  createdAt: string
  updatedAt: string
}

export interface PlayerSkin {
  id: string
  userId: string
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

export interface ActiveSkinSelection {
  type: "GLOBAL" | "CUSTOM"
  skinId?: string | null
  skin?: {
    id: string
    name?: string | null
    imageUrl: string
  } | null
}

export interface GlobalCape {
  id: string
  name: string
  imageUrl: string
  status: "AVAILABLE" | "UNAVAILABLE"
  createdAt: string
  updatedAt: string
}

export interface PlayerCape {
  id: string
  userId: string
  name: string
  imageUrl: string
  createdAt: string
  updatedAt: string
}

export interface CapeUploadTicket {
  uploadUrl: string
  uploadToken: string
  expiresAt: string
  maxSizeBytes: number
}

export interface ActiveCapeSelection {
  type: "NONE" | "GLOBAL" | "CUSTOM"
  capeId?: string | null
  playerCapeId?: string | null
  cape?: {
    id: string
    name?: string | null
    imageUrl: string
  } | null
  playerCape?: {
    id: string
    name?: string | null
    imageUrl: string
  } | null
  imageUrl?: string | null
  name?: string | null
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
