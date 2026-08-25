const path = require("path")
const fs = require("fs")

/**
 * Strict path validator to prevent path traversal and symlink escaping.
 * Rejects any relative path that uses parent segments (..) or attempts to escape instanceRoot.
 */
function resolveSafePath(instanceRoot, relativePath) {
  if (typeof relativePath !== "string" || !relativePath.trim()) {
    throw new Error("Invalid relative path: path must be a non-empty string.")
  }

  // Strictly reject paths containing parent directory traversal components
  if (relativePath.includes("..") || relativePath.startsWith("/") || relativePath.startsWith("\\")) {
    throw new Error(`Path traversal attempt detected: "${relativePath}"`)
  }

  const normalizedRelative = path.normalize(relativePath).replace(/^(\.\.[\/\\])+/, "")
  if (path.isAbsolute(normalizedRelative)) {
    throw new Error(`Absolute paths are not permitted in client files: "${relativePath}"`)
  }

  const absoluteRoot = path.resolve(instanceRoot)
  const resolvedTarget = path.resolve(absoluteRoot, normalizedRelative)

  // Ensure target is strictly inside the instanceRoot
  const relativeCheck = path.relative(absoluteRoot, resolvedTarget)
  if (relativeCheck.startsWith("..") || path.isAbsolute(relativeCheck)) {
    throw new Error(`Path escapes instance root: "${relativePath}"`)
  }

  // Check for symlinks/junctions on existing target or ancestors
  let current = resolvedTarget
  while (current && current !== absoluteRoot && current !== path.dirname(current)) {
    try {
      if (fs.existsSync(current)) {
        const lstat = fs.lstatSync(current)
        if (lstat.isSymbolicLink()) {
          const real = fs.realpathSync(current)
          const realRelative = path.relative(fs.realpathSync(absoluteRoot), real)
          if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
            throw new Error(`Symlink escapes instance root at: "${current}"`)
          }
        }
      }
    } catch (err) {
      if (err.message.includes("escapes instance root")) {
        throw err
      }
    }
    current = path.dirname(current)
  }

  return resolvedTarget
}

module.exports = {
  resolveSafePath,
}
