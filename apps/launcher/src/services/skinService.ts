import { graphqlClient } from "./apiClient"
import { resolveApiAssetUrl } from "../config/api"
import { authService } from "./authService"
import type { GlobalSkin, PlayerSkin, SkinUploadTicket, ActiveSkinSelection } from "../types"

import {
  validateMinecraftSkinTexture,
  MAX_SKIN_SIZE_BYTES,
} from "@hikat/shared"

export { resolveApiAssetUrl }


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

  if (!res.success) {
    throw new Error(res.error || "Error al consultar el catálogo de skins globales")
  }
  if (res.data?.skins?.items) {
    return res.data.skins.items.map((item) => ({
      ...item,
      imageUrl: resolveApiAssetUrl(item.imageUrl),
    }))
  }
  return []
}

/**
 * Fetches the authenticated player's personal custom skin (or null if none set).
 * Throws an Error if the network or server request fails.
 */
export async function fetchMyPlayerSkin(): Promise<PlayerSkin | null> {
  const token = authService.getAccessToken()
  if (!token) return null

  const query = /* GraphQL */ `
    query MyPlayerSkin {
      myPlayerSkin {
        id
        userId
        imageUrl
        createdAt
        updatedAt
      }
    }
  `
  const res = await graphqlClient<{ myPlayerSkin: PlayerSkin | null }>(query)
  if (!res.success) {
    throw new Error(res.error || "Error al consultar la skin personalizada del jugador")
  }

  if (res.data?.myPlayerSkin) {
    return {
      ...res.data.myPlayerSkin,
      imageUrl: resolveApiAssetUrl(res.data.myPlayerSkin.imageUrl),
    }
  }
  return null
}

/**
 * Fetches the authenticated player's currently active skin selection.
 * Throws an Error if the request fails.
 */
export async function fetchMyActiveSkin(): Promise<ActiveSkinSelection | null> {
  const token = authService.getAccessToken()
  if (!token) return null


  const query = /* GraphQL */ `
    query MyActiveSkin {
      myActiveSkin {
        type
        skinId
        skin {
          id
          name
          imageUrl
        }
      }
    }
  `
  const res = await graphqlClient<{ myActiveSkin: ActiveSkinSelection | null }>(query)
  if (!res.success) {
    throw new Error(res.error || "Error al consultar la skin activa del jugador")
  }

  if (res.data?.myActiveSkin) {
    return {
      ...res.data.myActiveSkin,
      skin: res.data.myActiveSkin.skin
        ? {
            ...res.data.myActiveSkin.skin,
            imageUrl: resolveApiAssetUrl(res.data.myActiveSkin.skin.imageUrl),
          }
        : null,
    }
  }
  return null
}


/**
 * Sets the active skin selection (GLOBAL or CUSTOM) for the authenticated player.
 */
export async function setMyActiveSkin(
  type: "GLOBAL" | "CUSTOM",
  skinId?: string | null,
): Promise<{ success: boolean; data?: ActiveSkinSelection; error?: string }> {
  const mutation = /* GraphQL */ `
    mutation SetMyActiveSkin($input: SetActiveSkinInput!) {
      setMyActiveSkin(input: $input) {
        type
        skinId
        skin {
          id
          name
          imageUrl
        }
      }
    }
  `
  const res = await graphqlClient<{ setMyActiveSkin: ActiveSkinSelection }>(mutation, {
    input: { type, skinId },
  })
  if (res.success && res.data?.setMyActiveSkin) {
    return {
      success: true,
      data: {
        ...res.data.setMyActiveSkin,
        skin: res.data.setMyActiveSkin.skin
          ? {
              ...res.data.setMyActiveSkin.skin,
              imageUrl: resolveApiAssetUrl(res.data.setMyActiveSkin.skin.imageUrl),
            }
          : null,
      },
    }
  }
  return {
    success: false,
    error: res.error || "No se pudo cambiar la skin activa",
  }
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
): Promise<{ success: boolean; data?: PlayerSkin; error?: string }> {
  const mutation = /* GraphQL */ `
    mutation SetMyPlayerSkin($input: SetPlayerSkinInput!) {
      setMyPlayerSkin(input: $input) {
        id
        userId
        imageUrl
        createdAt
        updatedAt
      }
    }
  `
  const res = await graphqlClient<{ setMyPlayerSkin: PlayerSkin }>(mutation, {
    input: { mediaId },
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
 * 4. Extracts mediaId from response
 * 5. Executes setMyPlayerSkin(mediaId)
 * 6. Returns fully resolved PlayerSkin
 */
export async function uploadPlayerSkin(
  file: File,
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

  const token = await authService.ensureValidAccessToken()
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
  const setRes = await setMyPlayerSkin(mediaId)
  if (!setRes.success || !setRes.data) {
    throw new Error(setRes.error || "No se pudo asociar la skin a tu cuenta")
  }

  return setRes.data
}
