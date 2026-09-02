const fs = require("fs")
const path = require("path")

// 1. Ensure @xmcl/core/utils shim exists
try {
  const pkgPath = require.resolve("@xmcl/core/package.json")
  const pkg = require(pkgPath)
  if (pkg.version === "2.16.1") {
    const utilsJsPath = path.join(path.dirname(pkgPath), "utils.js")
    const shimContent = `"use strict";
const fs = require("fs"), fsp = require("fs/promises"), crypto = require("crypto");
const isNotNull = (v) => v !== null && v !== undefined;
const exists = (t) => fsp.access(t).then(() => true, () => false);
const checksum = (t, a) => new Promise((res, rej) => {
  const h = crypto.createHash(a), s = fs.createReadStream(t);
  s.on("data", (d) => h.update(d)).on("end", () => res(h.digest("hex"))).on("error", rej);
});
const validateSha1 = async (t, h, strict = true) => {
  if (!h && !strict) return true;
  try { return (await checksum(t, "sha1")).toLowerCase() === (h || "").toLowerCase(); } catch (_) { return false; }
};
module.exports = { isNotNull, exists, checksum, validateSha1 };
`
    fs.writeFileSync(utilsJsPath, shimContent, "utf8")
  }
} catch (_) {}

// 2. Ensure @xmcl/file-transfer points to compiled JavaScript (./dist/index.js) instead of ./index.ts
function fixFileTransferPkg(dir) {
  try {
    const pkgFile = path.join(dir, "package.json")
    if (fs.existsSync(pkgFile)) {
      const content = fs.readFileSync(pkgFile, "utf8")
      const parsed = JSON.parse(content)
      if (parsed.name === "@xmcl/file-transfer" && parsed.main !== "./dist/index.js") {
        parsed.main = "./dist/index.js"
        fs.writeFileSync(pkgFile, JSON.stringify(parsed, null, 2), "utf8")
      }
    }
  } catch (_) {}
}

try {
  const ftPkgPath = require.resolve("@xmcl/file-transfer/package.json")
  fixFileTransferPkg(path.dirname(ftPkgPath))
} catch (_) {}

function findAndFixPnpmPackages(rootDir) {
  try {
    const pnpmDir = path.join(rootDir, "node_modules", ".pnpm")
    if (fs.existsSync(pnpmDir)) {
      const entries = fs.readdirSync(pnpmDir)
      for (const entry of entries) {
        if (entry.startsWith("@xmcl+file-transfer")) {
          const targetDir = path.join(pnpmDir, entry, "node_modules", "@xmcl", "file-transfer")
          fixFileTransferPkg(targetDir)
        }
      }
    }
  } catch (_) {}
}

findAndFixPnpmPackages(path.resolve(__dirname, ".."))
findAndFixPnpmPackages(path.resolve(__dirname, "../../.."))

// 3. Smoke verification
try {
  require("@xmcl/core/utils")
  require("@xmcl/file-transfer")
  require("@xmcl/installer")
} catch (err) {
  console.warn("[ensure-xmcl-core-utils] Warning during verification:", err.message)
}
