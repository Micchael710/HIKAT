const fs = require("fs")
const fsp = fs.promises
const path = require("path")
const crypto = require("crypto")

/**
 * Calculates SHA-1 hash of a local file via stream.
 */
async function calculateFileSha1(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha1")
    const stream = fs.createReadStream(filePath)
    stream.on("data", (chunk) => hash.update(chunk))
    stream.on("end", () => resolve(hash.digest("hex").toLowerCase()))
    stream.on("error", (err) => reject(err))
  })
}

/**
 * Calculates SHA-256 hash of a local file via stream.
 */
async function calculateFileSha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256")
    const stream = fs.createReadStream(filePath)
    stream.on("data", (chunk) => hash.update(chunk))
    stream.on("end", () => resolve(hash.digest("hex").toLowerCase()))
    stream.on("error", (err) => reject(err))
  })
}

/**
 * Deep integrity verification for local files with SHA-1:
 * Supports (filePath, expectedSize, expectedSha1) or (filePath, expectedSha1).
 */
async function validateFileIntegrity(filePath, expectedSizeOrSha1, expectedSha1) {
  if (!filePath || typeof filePath !== "string") return false
  try {
    let expectedSize = -1
    let hash = expectedSha1

    if (typeof expectedSizeOrSha1 === "string" && !expectedSha1) {
      hash = expectedSizeOrSha1
      expectedSize = -1
    } else if (typeof expectedSizeOrSha1 === "number") {
      expectedSize = expectedSizeOrSha1
    }

    const stat = await fsp.stat(filePath)
    if (!stat.isFile()) return false

    if (typeof expectedSize === "number" && expectedSize >= 0) {
      if (stat.size !== expectedSize) {
        return false
      }
    }

    if (hash && typeof hash === "string" && hash.trim()) {
      const cleanSha1 = hash.trim().toLowerCase()
      const actualSha1 = await calculateFileSha1(filePath)
      if (actualSha1 !== cleanSha1) {
        return false
      }
    }

    return true
  } catch (_) {
    return false
  }
}

/**
 * Deep integrity verification for local files with SHA-256:
 * Supports (filePath, expectedSize, expectedSha256) or (filePath, expectedSha256).
 */
async function validateFileSha256(filePath, expectedSizeOrSha256, expectedSha256) {
  if (!filePath || typeof filePath !== "string") return false
  try {
    let expectedSize = -1
    let hash = expectedSha256

    if (typeof expectedSizeOrSha256 === "string" && !expectedSha256) {
      hash = expectedSizeOrSha256
      expectedSize = -1
    } else if (typeof expectedSizeOrSha256 === "number") {
      expectedSize = expectedSizeOrSha256
    }

    const stat = await fsp.stat(filePath)
    if (!stat.isFile()) return false

    if (typeof expectedSize === "number" && expectedSize >= 0) {
      if (stat.size !== expectedSize) {
        return false
      }
    }

    if (hash && typeof hash === "string" && hash.trim()) {
      const cleanSha256 = hash.trim().toLowerCase()
      const actualSha256 = await calculateFileSha256(filePath)
      if (actualSha256 !== cleanSha256) {
        return false
      }
    }

    return true
  } catch (_) {
    return false
  }
}

/**
 * Downloads a URL into a Buffer using standard fetch or customFetch.
 */
async function downloadBuffer(url, { signal, headers = {}, customFetch = globalThis.fetch } = {}) {
  const fetchFn = typeof customFetch === "function" ? customFetch : globalThis.fetch
  const res = await fetchFn(url, {
    headers: {
      "User-Agent": "HiKAT-Launcher/1.0",
      ...headers,
    },
    signal,
  })

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} downloading ${url}`)
  }

  const arrayBuf = await res.arrayBuffer()
  return Buffer.from(arrayBuf)
}

/**
 * Downloads a file atomically with optional SHA-1 or SHA-256 verification and progress tracking.
 */
async function downloadFileAtomic(
  url,
  destPath,
  {
    expectedSize = -1,
    expectedSha1,
    expectedSha256,
    cancelSignal,
    signal,
    onChunkBytes,
    customFetch = globalThis.fetch,
  } = {},
) {
  if (cancelSignal?.isCancelled || signal?.aborted) {
    throw new Error("Preflight cancelled.")
  }

  const targetDir = path.dirname(destPath)
  await fsp.mkdir(targetDir, { recursive: true })

  const tempPath = path.join(
    targetDir,
    `.dl_tmp_${path.basename(destPath)}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}.tmp`,
  )

  try {
    const fetchFn = typeof customFetch === "function" ? customFetch : globalThis.fetch
    const res = await fetchFn(url, {
      headers: { "User-Agent": "HiKAT-Launcher/1.0" },
      signal,
    })

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} fetching ${url}`)
    }

    if (res.body && typeof res.body.getReader === "function") {
      const fileStream = fs.createWriteStream(tempPath)
      const reader = res.body.getReader()
      try {
        while (true) {
          if (cancelSignal?.isCancelled || signal?.aborted) {
            throw new Error("Preflight cancelled.")
          }
          const { done, value } = await reader.read()
          if (done) break
          const chunk = Buffer.from(value)
          fileStream.write(chunk)
          if (typeof onChunkBytes === "function") {
            onChunkBytes(chunk.length)
          }
        }
        await new Promise((resolve, reject) => {
          fileStream.end((err) => (err ? reject(err) : resolve()))
        })
      } catch (streamErr) {
        try {
          fileStream.destroy()
        } catch (_) {}
        throw streamErr
      }
    } else if (
      res.body &&
      (typeof res.body[Symbol.asyncIterator] === "function" ||
        typeof res.body.pipe === "function" ||
        typeof res.body.on === "function")
    ) {
      const fileStream = fs.createWriteStream(tempPath)
      try {
        if (typeof res.body[Symbol.asyncIterator] === "function") {
          for await (const chunk of res.body) {
            if (cancelSignal?.isCancelled || signal?.aborted) {
              throw new Error("Preflight cancelled.")
            }
            const bufChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
            fileStream.write(bufChunk)
            if (typeof onChunkBytes === "function") {
              onChunkBytes(bufChunk.length)
            }
          }
          await new Promise((resolve, reject) => {
            fileStream.end((err) => (err ? reject(err) : resolve()))
          })
        } else {
          await new Promise((resolve, reject) => {
            res.body.on("data", (chunk) => {
              if (typeof onChunkBytes === "function") {
                onChunkBytes(chunk.length)
              }
            })
            res.body.pipe(fileStream)
            fileStream.on("finish", resolve)
            fileStream.on("error", reject)
            res.body.on("error", reject)
          })
        }
      } catch (streamErr) {
        try {
          fileStream.destroy()
        } catch (_) {}
        throw streamErr
      }
    } else {
      let buf
      if (typeof res.arrayBuffer === "function") {
        buf = Buffer.from(await res.arrayBuffer())
      } else if (typeof res.buffer === "function") {
        buf = await res.buffer()
      } else if (typeof res.text === "function") {
        buf = Buffer.from(await res.text(), "utf8")
      } else {
        buf = Buffer.alloc(0)
      }
      if (typeof onChunkBytes === "function" && buf.length > 0) {
        onChunkBytes(buf.length)
      }
      await fsp.writeFile(tempPath, buf)
    }

    // Verify integrity
    if (expectedSize > 0) {
      const stat = await fsp.stat(tempPath)
      if (stat.size !== expectedSize) {
        throw new Error(`Size mismatch downloading ${url}: expected ${expectedSize}, got ${stat.size}`)
      }
    }

    if (expectedSha1) {
      const actualSha1 = await calculateFileSha1(tempPath)
      if (actualSha1 !== expectedSha1.toLowerCase().trim()) {
        throw new Error(`SHA-1 mismatch downloading ${url}: expected ${expectedSha1}, got ${actualSha1}`)
      }
    }

    if (expectedSha256) {
      const actualSha256 = await calculateFileSha256(tempPath)
      if (actualSha256 !== expectedSha256.toLowerCase().trim()) {
        throw new Error(`SHA-256 verification failed downloading ${url}: expected ${expectedSha256}, got ${actualSha256}`)
      }
    }

    // Safe replace
    try {
      await fsp.rename(tempPath, destPath)
    } catch (_) {
      if (fs.existsSync(destPath)) {
        await fsp.unlink(destPath)
      }
      await fsp.rename(tempPath, destPath)
    }
  } catch (err) {
    try {
      if (fs.existsSync(tempPath)) {
        await fsp.unlink(tempPath)
      }
    } catch (_) {}
    throw err
  }
}

module.exports = {
  calculateFileSha1,
  calculateFileSha256,
  validateFileIntegrity,
  validateFileSha256,
  downloadBuffer,
  downloadFileAtomic,
}
