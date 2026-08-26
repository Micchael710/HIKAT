import { graphqlClient, API_BASE_URL } from "./apiClient"
import type { GlobalSkin, PlayerSkin, SkinUploadTicket } from "../types"

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
    return res.data.skins.items
  }
  return []
}

/**
 * Fetches the authenticated player's personal custom skin (or null if none set).
 */
export async function fetchMyPlayerSkin(): Promise<PlayerSkin | null> {
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
  if (res.success && res.data) {
    return res.data.myPlayerSkin
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
      data: res.data.setMyPlayerSkin,
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
 * Complete workflow to upload a player custom skin: creates ticket, uploads to R2, and links in D1.
 */
export async function uploadPlayerSkin(
  file: File,
  model: "CLASSIC" | "SLIM" = "CLASSIC",
): Promise<PlayerSkin> {
  const ticketRes = await createPlayerSkinUploadTicket()
  if (!ticketRes.success || !ticketRes.data) {
    throw new Error(ticketRes.error || "No se pudo obtener el ticket de subida")
  }
  const { uploadUrl, uploadToken } = ticketRes.data

  let fullUploadUrl = uploadUrl
  if (!fullUploadUrl.startsWith("http")) {
    const origin = API_BASE_URL.replace(/\/$/, "")
    fullUploadUrl = `${origin}/${uploadUrl.replace(/^\//, "")}`
  }

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

  const uploadRes = await fetch(fullUploadUrl, {
    method: "PUT",
    headers,
    body: file,
  })

  if (!uploadRes.ok) {
    const errBody = await uploadRes.json().catch(() => null)
    throw new Error(
      errBody?.message || `Error al subir la textura (${uploadRes.status})`,
    )
  }

  const uploadData = await uploadRes.json()
  const mediaId = uploadData?.media?.id
  if (!mediaId) {
    throw new Error(
      "Respuesta de subida incompleta: falta identificador de medio",
    )
  }

  const setRes = await setMyPlayerSkin(mediaId, model)
  if (!setRes.success || !setRes.data) {
    throw new Error(setRes.error || "No se pudo vincular la skin a tu cuenta")
  }

  return setRes.data
}
