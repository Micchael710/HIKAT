import { graphqlClient } from "./apiClient"
import { resolveApiAssetUrl } from "./skinService"
import type { GlobalCape, PlayerCape, CapeUploadTicket, ActiveCapeSelection } from "../types"
import {
  validateCapeTextureBuffer,
  MAX_CAPE_SIZE_BYTES,
} from "@hikat/shared"
import { loadCapeToCanvas } from "skinview-utils"

/**
 * Fetches the public global cape catalog (status: AVAILABLE) from HiKAT Backend.
 */
export async function fetchGlobalCapes(
  first = 50,
  after?: string,
): Promise<GlobalCape[]> {
  const query = /* GraphQL */ `
    query Capes($first: Int, $after: String) {
      capes(first: $first, after: $after) {
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
    capes: { items: GlobalCape[]; totalCount: number }
  }>(query, {
    first,
    after,
  })

  if (res.success && res.data?.capes?.items) {
    return res.data.capes.items.map((item) => ({
      ...item,
      imageUrl: resolveApiAssetUrl(item.imageUrl),
    }))
  }
  return []
}

/**
 * Fetches all custom capes belonging to the authenticated player.
 */
export async function fetchMyPlayerCapes(): Promise<PlayerCape[]> {
  const token =
    typeof window !== "undefined"
      ? localStorage.getItem("hikat_auth_token")
      : null
  if (!token) return []

  const query = /* GraphQL */ `
    query MyPlayerCapes {
      myPlayerCapes {
        id
        userId
        name
        imageUrl
        createdAt
        updatedAt
      }
    }
  `
  const res = await graphqlClient<{ myPlayerCapes: PlayerCape[] }>(query)
  if (res.success && res.data?.myPlayerCapes) {
    return res.data.myPlayerCapes.map((item) => ({
      ...item,
      imageUrl: resolveApiAssetUrl(item.imageUrl),
    }))
  }
  return []
}

/**
 * Fetches the authenticated player's currently active cape selection.
 */
export async function fetchMyActiveCape(): Promise<ActiveCapeSelection> {
  const defaultNone: ActiveCapeSelection = {
    type: "NONE",
    capeId: null,
    playerCapeId: null,
    cape: null,
    playerCape: null,
    imageUrl: null,
    name: "Sin capa",
  }

  const token =
    typeof window !== "undefined"
      ? localStorage.getItem("hikat_auth_token")
      : null
  if (!token) return defaultNone

  const query = /* GraphQL */ `
    query MyActiveCape {
      myActiveCape {
        type
        capeId
        playerCapeId
        imageUrl
        name
        cape {
          id
          name
          imageUrl
        }
        playerCape {
          id
          name
          imageUrl
        }
      }
    }
  `
  const res = await graphqlClient<{ myActiveCape: ActiveCapeSelection }>(query)
  if (res.success && res.data?.myActiveCape) {
    const raw = res.data.myActiveCape
    return {
      type: raw.type,
      capeId: raw.capeId,
      playerCapeId: raw.playerCapeId,
      imageUrl: raw.imageUrl ? resolveApiAssetUrl(raw.imageUrl) : null,
      name: raw.name || (raw.type === "NONE" ? "Sin capa" : null),
      cape: raw.cape
        ? {
            ...raw.cape,
            imageUrl: resolveApiAssetUrl(raw.cape.imageUrl),
          }
        : null,
      playerCape: raw.playerCape
        ? {
            ...raw.playerCape,
            imageUrl: resolveApiAssetUrl(raw.playerCape.imageUrl),
          }
        : null,
    }
  }
  return defaultNone
}

/**
 * Sets the active cape selection (NONE, GLOBAL, or CUSTOM) for the authenticated player.
 */
export async function setMyActiveCape(
  type: "NONE" | "GLOBAL" | "CUSTOM",
  capeId?: string | null,
  playerCapeId?: string | null,
): Promise<{ success: boolean; data?: ActiveCapeSelection; error?: string }> {
  const mutation = /* GraphQL */ `
    mutation SetMyActiveCape($input: SetActiveCapeInput!) {
      setMyActiveCape(input: $input) {
        type
        capeId
        playerCapeId
        imageUrl
        name
        cape {
          id
          name
          imageUrl
        }
        playerCape {
          id
          name
          imageUrl
        }
      }
    }
  `
  const res = await graphqlClient<{ setMyActiveCape: ActiveCapeSelection }>(mutation, {
    input: { type, capeId, playerCapeId },
  })
  if (res.success && res.data?.setMyActiveCape) {
    const raw = res.data.setMyActiveCape
    return {
      success: true,
      data: {
        type: raw.type,
        capeId: raw.capeId,
        playerCapeId: raw.playerCapeId,
        imageUrl: raw.imageUrl ? resolveApiAssetUrl(raw.imageUrl) : null,
        name: raw.name || (raw.type === "NONE" ? "Sin capa" : null),
        cape: raw.cape
          ? {
              ...raw.cape,
              imageUrl: resolveApiAssetUrl(raw.cape.imageUrl),
            }
          : null,
        playerCape: raw.playerCape
          ? {
              ...raw.playerCape,
              imageUrl: resolveApiAssetUrl(raw.playerCape.imageUrl),
            }
          : null,
      },
    }
  }
  return {
    success: false,
    error: res.error || "No se pudo cambiar la capa activa",
  }
}

/**
 * Creates a single-use upload ticket for the authenticated player's custom cape.
 */
export async function createPlayerCapeUploadTicket(): Promise<{
  success: boolean
  data?: CapeUploadTicket
  error?: string
}> {
  const mutation = /* GraphQL */ `
    mutation CreatePlayerCapeUpload {
      createPlayerCapeUpload {
        uploadUrl
        uploadToken
        expiresAt
        maxSizeBytes
      }
    }
  `
  const res = await graphqlClient<{ createPlayerCapeUpload: CapeUploadTicket }>(
    mutation,
  )
  if (res.success && res.data?.createPlayerCapeUpload) {
    return {
      success: true,
      data: res.data.createPlayerCapeUpload,
    }
  }
  return {
    success: false,
    error: res.error || "No se pudo crear el ticket de subida de capa",
  }
}

/**
 * Adds a new custom cape to the authenticated player's collection.
 */
export async function addMyPlayerCape(
  name: string,
  mediaId: string,
): Promise<{ success: boolean; data?: PlayerCape; error?: string }> {
  const mutation = /* GraphQL */ `
    mutation AddMyPlayerCape($input: AddPlayerCapeInput!) {
      addMyPlayerCape(input: $input) {
        id
        userId
        name
        imageUrl
        createdAt
        updatedAt
      }
    }
  `
  const res = await graphqlClient<{ addMyPlayerCape: PlayerCape }>(mutation, {
    input: { name, mediaId },
  })
  if (res.success && res.data?.addMyPlayerCape) {
    return {
      success: true,
      data: {
        ...res.data.addMyPlayerCape,
        imageUrl: resolveApiAssetUrl(res.data.addMyPlayerCape.imageUrl),
      },
    }
  }
  return {
    success: false,
    error: res.error || "No se pudo guardar la capa personalizada",
  }
}

/**
 * Deletes a custom cape belonging to the authenticated player.
 */
export async function deleteMyPlayerCape(
  id: string,
): Promise<{ success: boolean; error?: string }> {
  const mutation = /* GraphQL */ `
    mutation DeleteMyPlayerCape($id: ID!) {
      deleteMyPlayerCape(id: $id)
    }
  `
  const res = await graphqlClient<{ deleteMyPlayerCape: boolean }>(mutation, { id })
  if (res.success && res.data?.deleteMyPlayerCape) {
    return { success: true }
  }
  return {
    success: false,
    error: res.error || "No se pudo eliminar la capa",
  }
}

/**
 * Complete workflow to upload and add a player custom cape:
 * 1. Validates local file format (PNG), size (<= 5MB), and decodability (validateCapeTextureBuffer)
 * 2. Creates single-use upload ticket via Backend GraphQL
 * 3. PUT upload binary texture to R2 endpoint
 * 4. Extracts mediaId from response
 * 5. Executes addMyPlayerCape(name, mediaId)
 * 6. Returns fully resolved PlayerCape
 */
export async function uploadPlayerCape(
  file: File,
  name?: string,
): Promise<PlayerCape> {
  // 1. Client-side validation: format and max size
  if (!file.type.includes("png") && !file.name.toLowerCase().endsWith(".png")) {
    throw new Error("El archivo debe ser una imagen en formato PNG (.png).")
  }
  if (file.size > MAX_CAPE_SIZE_BYTES) {
    throw new Error("El archivo supera el tamaño máximo permitido de 5 MB.")
  }

  // Read buffer and validate PNG decodability
  const arrayBuffer = await file.arrayBuffer()
  const validation = validateCapeTextureBuffer(arrayBuffer)
  if (!validation.valid) {
    throw new Error(
      validation.error || "El archivo no contiene una textura de capa PNG válida.",
    )
  }

  // Visual compatibility check with skinview-utils
  try {
    const imgUrl = URL.createObjectURL(file)
    const img = new Image()
    img.src = imgUrl
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error("No se pudo cargar la imagen"))
    })
    URL.revokeObjectURL(imgUrl)

    const tempCanvas = document.createElement("canvas")
    loadCapeToCanvas(tempCanvas, img)
  } catch {
    throw new Error("Esta imagen no tiene un formato de capa compatible.")
  }

  // 2. Request upload ticket
  const ticketRes = await createPlayerCapeUploadTicket()
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
        `Error al subir la textura de capa (${uploadRes.status})`,
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

  // 5. Add cape to player collection in D1
  const capeName = (name && name.trim()) || file.name.replace(/\.[^/.]+$/, "") || "Mi Capa"
  const addRes = await addMyPlayerCape(capeName, mediaId)
  if (!addRes.success || !addRes.data) {
    throw new Error(addRes.error || "No se pudo guardar la capa en tu colección")
  }

  return addRes.data
}
