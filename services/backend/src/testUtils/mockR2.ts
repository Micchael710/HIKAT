/**
 * In-memory Mock implementation of Cloudflare R2Bucket for hermetic automated testing.
 */

interface StoredR2Object {
  key: string
  version: string
  size: number
  etag: string
  httpEtag: string
  uploaded: Date
  httpMetadata?: Record<string, string | undefined>
  customMetadata?: Record<string, string>
  data: Uint8Array
}

export function createTestR2Bucket(): R2Bucket & { _storage: Map<string, StoredR2Object> } {
  const storage = new Map<string, StoredR2Object>()

  function toUint8Array(value: any): Uint8Array {
    if (value instanceof Uint8Array) {
      return value
    }
    if (value instanceof ArrayBuffer) {
      return new Uint8Array(value)
    }
    if (ArrayBuffer.isView(value)) {
      return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    }
    if (typeof value === "string") {
      return new TextEncoder().encode(value)
    }
    if (!value) {
      return new Uint8Array(0)
    }
    return new Uint8Array(0)
  }

  const mockBucket: any = {
    _storage: storage,

    async put(
      key: string,
      value: any,
      options?: {
        httpMetadata?: Record<string, string | undefined>
        customMetadata?: Record<string, string>
      },
    ): Promise<R2Object> {
      let data: Uint8Array
      if (value && typeof value.arrayBuffer === "function") {
        const ab = await value.arrayBuffer()
        data = new Uint8Array(ab)
      } else {
        data = toUint8Array(value)
      }

      const etag = `"${crypto.randomUUID().replace(/-/g, "")}"`
      const stored: StoredR2Object = {
        key,
        version: crypto.randomUUID(),
        size: data.byteLength,
        etag,
        httpEtag: etag,
        uploaded: new Date(),
        httpMetadata: options?.httpMetadata,
        customMetadata: options?.customMetadata,
        data,
      }

      storage.set(key, stored)

      return {
        key: stored.key,
        version: stored.version,
        size: stored.size,
        etag: stored.etag,
        httpEtag: stored.httpEtag,
        uploaded: stored.uploaded,
        httpMetadata: stored.httpMetadata as any,
        customMetadata: stored.customMetadata,
        writeHttpMetadata: (headers: Headers) => {
          if (stored.httpMetadata?.contentType) {
            headers.set("Content-Type", stored.httpMetadata.contentType)
          }
        },
      } as unknown as R2Object
    },

    async get(key: string): Promise<R2ObjectBody | null> {
      const stored = storage.get(key)
      if (!stored) {
        return null
      }

      const bodyStream = new ReadableStream({
        start(controller) {
          controller.enqueue(stored.data)
          controller.close()
        },
      })

      return {
        key: stored.key,
        version: stored.version,
        size: stored.size,
        etag: stored.etag,
        httpEtag: stored.httpEtag,
        uploaded: stored.uploaded,
        httpMetadata: stored.httpMetadata as any,
        customMetadata: stored.customMetadata,
        body: bodyStream,
        bodyUsed: false,
        async arrayBuffer() {
          return stored.data.buffer.slice(
            stored.data.byteOffset,
            stored.data.byteOffset + stored.data.byteLength,
          ) as ArrayBuffer
        },
        async text() {
          return new TextDecoder().decode(stored.data)
        },
        async json() {
          return JSON.parse(new TextDecoder().decode(stored.data))
        },
        async blob() {
          return new Blob([stored.data as any])
        },
        writeHttpMetadata: (headers: Headers) => {
          if (stored.httpMetadata?.contentType) {
            headers.set("Content-Type", stored.httpMetadata.contentType)
          }
        },
      } as unknown as R2ObjectBody
    },

    async delete(keys: string | string[]): Promise<void> {
      const keyList = Array.isArray(keys) ? keys : [keys]
      for (const k of keyList) {
        storage.delete(k)
      }
    },

    async head(key: string): Promise<R2Object | null> {
      const stored = storage.get(key)
      if (!stored) {
        return null
      }
      return {
        key: stored.key,
        version: stored.version,
        size: stored.size,
        etag: stored.etag,
        httpEtag: stored.httpEtag,
        uploaded: stored.uploaded,
        httpMetadata: stored.httpMetadata as any,
        customMetadata: stored.customMetadata,
        writeHttpMetadata: (headers: Headers) => {
          if (stored.httpMetadata?.contentType) {
            headers.set("Content-Type", stored.httpMetadata.contentType)
          }
        },
      } as unknown as R2Object
    },

    async list(): Promise<R2Objects> {
      const objects = Array.from(storage.values()).map((stored) => ({
        key: stored.key,
        version: stored.version,
        size: stored.size,
        etag: stored.etag,
        httpEtag: stored.httpEtag,
        uploaded: stored.uploaded,
        httpMetadata: stored.httpMetadata as any,
        customMetadata: stored.customMetadata,
        writeHttpMetadata: () => {},
      })) as unknown as R2Object[]

      return {
        objects,
        truncated: false,
        delimitedPrefixes: [],
      } as unknown as R2Objects
    },
  }

  return mockBucket as R2Bucket & { _storage: Map<string, StoredR2Object> }
}
