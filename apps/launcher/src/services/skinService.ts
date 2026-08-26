import { graphqlClient, API_BASE_URL } from "./apiClient"
import type { GlobalSkin, PlayerSkin, SkinUploadTicket } from "../types"
import {
  validateMinecraftSkinTexture,
  MAX_SKIN_SIZE_BYTES,
} from "@hikat/shared"

/**
 * Normalizes relative backend asset URLs (/media/content/...) into absolute HTTP URLs
 * without mutating already absolute HTTPS/HTTP or data URLs.
 */
export function resolveApiAssetUrl(url?: string | null): string {
  if (!url || typeof url !== "string") return ""
  const trimmed = url.trim()
  if (
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("data:") ||
    trimmed.startsWith("blob:")
  ) {
    return trimmed
  }
  const baseUrl = (
    import.meta.env.VITE_BACKEND_API_URL ||
    import.meta.env.VITE_API_URL ||
    "http://localhost:8787"
  ).replace(/\/$/, "")
  const cleanPath = trimmed.replace(/^\//, "")
  return `${baseUrl}/${cleanPath}`
}

/**
 * Fetches the public global skin catalog (status: AVAILABLE) from HiKAT Backend.
 */
export async function fetchGlobalSkins(
  first = 50,
  after?: string,
): Promise<GlobalSkin[]> {
  const query = /* GraphQL */ `
    query Skins($first: Int, $after: String) {
      skins(first: $first, after: $after) {
        items {
          id
          name
          model
          imageUrl
          status
          createdAt
          updatedAt
        }
        totalCount
      }
    }
  `
  const res = await graphqlClient<{
    skins: { items: GlobalSkin[]; totalCount: number }
  }>(query, {
    first,
    after,
  })

  if (res.success && res.data?.skins?.items) {
    return res.data.skins.items.map((item) => ({
      ...item,
      imageUrl: resolveApiAssetUrl(item.imageUrl),
    }))
  }
  return []
}

/**
 * Fetches the authenticated player's personal custom skin (or null if none set).
 */
export async function fetchMyPlayerSkin(): Promise<PlayerSkin | null> {
  const token =
    typeof window !== "undefined"
      ? localStorage.getItem("hikat_auth_token")
      : null
  if (!token) return null

  const query = /* GraphQL */ `
    query MyPlayerSkin {
      myPlayerSkin {
        id
        userId
        model
        imageUrl
        createdAt
        updatedAt
      }
    }
  `
  const res = await graphqlClient<{ myPlayerSkin: PlayerSkin | null }>(query)
  if (res.success && res.data?.myPlayerSkin) {
    return {
      ...res.data.myPlayerSkin,
      imageUrl: resolveApiAssetUrl(res.data.myPlayerSkin.imageUrl),
    }
  }
  return null
}

/**
 * Creates a single-use upload ticket for the authenticated player's skin.
 */
export async function createPlayerSkinUploadTicket(): Promise<{
  success: boolean
  data?: SkinUploadTicket
  error?: string
}> {
  const mutation = /* GraphQL */ `
    mutation CreatePlayerSkinUpload {
      createPlayerSkinUpload {
        uploadUrl
        uploadToken
        expiresAt
        maxSizeBytes
      }
    }
  `
  const res = await graphqlClient<{ createPlayerSkinUpload: SkinUploadTicket }>(
    mutation,
  )
  if (res.success && res.data?.createPlayerSkinUpload) {
    return {
      success: true,
      data: res.data.createPlayerSkinUpload,
    }
  }
  return {
    success: false,
    error: res.error || "No se pudo crear el ticket de subida",
  }
}

/**
 * Associates an uploaded texture media to the authenticated player's account.
 */
export async function setMyPlayerSkin(
  mediaId: string,
  model: "CLASSIC" | "SLIM",
): Promise<{ success: boolean; data?: PlayerSkin; error?: string }> {
  const mutation = /* GraphQL */ `
    mutation SetMyPlayerSkin($input: SetPlayerSkinInput!) {
      setMyPlayerSkin(input: $input) {
        id
        userId
        model
        imageUrl
        createdAt
        updatedAt
      }
    }
  `
  const res = await graphqlClient<{ setMyPlayerSkin: PlayerSkin }>(mutation, {
    input: { mediaId, model },
  })
  if (res.success && res.data?.setMyPlayerSkin) {
    return {
      success: true,
      data: {
        ...res.data.setMyPlayerSkin,
        imageUrl: resolveApiAssetUrl(res.data.setMyPlayerSkin.imageUrl),
      },
    }
  }
  return {
    success: false,
    error: res.error || "No se pudo guardar la skin personalizada",
  }
}

/**
 * Deletes the authenticated player's custom skin.
 */
export async function deleteMyPlayerSkin(): Promise<{
  success: boolean
  error?: string
}> {
  const mutation = /* GraphQL */ `
    mutation DeleteMyPlayerSkin {
      deleteMyPlayerSkin
    }
  `
  const res = await graphqlClient<{ deleteMyPlayerSkin: boolean }>(mutation)
  if (res.success && res.data?.deleteMyPlayerSkin) {
    return { success: true }
  }
  return {
    success: false,
    error: res.error || "No se pudo eliminar la skin personalizada",
  }
}

/**
 * Complete workflow to upload a player custom skin:
 * 1. Validates local file format (PNG), size (<= 1MB), and Minecraft skin dimensions (64x64 or 64x32)
 * 2. Creates single-use upload ticket via Backend GraphQL
 * 3. PUT upload binary texture to R2 endpoint
 * 4. Extracts mediaId from response ({ id, ... } or { media: { id } })
 * 5. Executes setMyPlayerSkin(mediaId, model)
 * 6. Returns fully resolved PlayerSkin
 */
export async function uploadPlayerSkin(
  file: File,
  model: "CLASSIC" | "SLIM" = "CLASSIC",
): Promise<PlayerSkin> {
  // 1. Client-side validation: format and max size
  if (!file.type.includes("png") && !file.name.toLowerCase().endsWith(".png")) {
    throw new Error("El archivo debe ser una imagen en formato PNG (.png).")
  }
  if (file.size > MAX_SKIN_SIZE_BYTES) {
    throw new Error("El archivo supera el tamaño máximo permitido de 1 MB.")
  }

  // Read buffer and validate dimensions
  const arrayBuffer = await file.arrayBuffer()
  const validation = validateMinecraftSkinTexture(arrayBuffer)
  if (!validation.valid) {
    throw new Error(
      validation.error ||
        validation.reason ||
        "Dimensiones de skin inválidas. Se requiere PNG de 64x64 o 64x32.",
    )
  }

  // 2. Request upload ticket
  const ticketRes = await createPlayerSkinUploadTicket()
  if (!ticketRes.success || !ticketRes.data) {
    throw new Error(ticketRes.error || "No se pudo obtener el ticket de subida")
  }
  const { uploadUrl, uploadToken } = ticketRes.data
  const fullUploadUrl = resolveApiAssetUrl(uploadUrl)

  const token =
    typeof window !== "undefined"
      ? localStorage.getItem("hikat_auth_token")
      : null
  const headers: Record<string, string> = {
    "X-Upload-Token": uploadToken,
    "Content-Type": "image/png",
  }
  if (token) {
    headers["Authorization"] = `Bearer ${token}`
  }

  // 3. Binary PUT upload
  const uploadRes = await fetch(fullUploadUrl, {
    method: "PUT",
    headers,
    body: file,
  })

  if (!uploadRes.ok) {
    const errBody = await uploadRes.json().catch(() => null)
    throw new Error(
      errBody?.error ||
        errBody?.message ||
        `Error al subir la textura (${uploadRes.status})`,
    )
  }

  // 4. Extract flat mediaId from response
  const uploadData = await uploadRes.json()
  const mediaId = uploadData?.id || uploadData?.media?.id
  if (!mediaId) {
    throw new Error(
      "Respuesta de subida incompleta: falta identificador de medio",
    )
  }

  // 5. Link texture to player skin in D1
  const setRes = await setMyPlayerSkin(mediaId, model)
  if (!setRes.success || !setRes.data) {
    throw new Error(setRes.error || "No se pudo asociar la skin a tu cuenta")
  }

  return setRes.data
}
