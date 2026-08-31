const { createNodeInstallRuntime } = require("@xmcl/installer")
const { downloadMultiple } = require("@xmcl/file-transfer")

/**
 * Creates an XMCL install runtime backed by Node and @xmcl/file-transfer
 * without relying on ConcurrencyDispatcher or custom downloaders.
 */
function createHiKatInstallRuntime({ signal } = {}) {
  return createNodeInstallRuntime({
    signal,
    download: async (files) => {
      const results = await downloadMultiple({
        options: files.map((file) => ({
          url: file.urls,
          destination: file.path,
          expectedTotal: file.size,
        })),
        signal,
      })

      const failures = results.filter((r) => r.status === "rejected")

      if (failures.length > 0) {
        throw new AggregateError(
          failures.map((f) => f.reason),
          "XMCL download failed"
        )
      }
    },
  })
}

module.exports = { createHiKatInstallRuntime }
