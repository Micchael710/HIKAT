const fs = require("fs")
const path = require("path")

const pkgPath = require.resolve("@xmcl/core/package.json")
const pkg = require(pkgPath)
if (pkg.version !== "2.16.1") process.exit(0)

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
require.resolve("@xmcl/core/utils")
const loaded = require("@xmcl/core/utils")
if (typeof loaded.isNotNull !== "function" || typeof loaded.exists !== "function") {
  throw new Error("[ensure-xmcl-core-utils] Failed to load @xmcl/core/utils shim")
}
