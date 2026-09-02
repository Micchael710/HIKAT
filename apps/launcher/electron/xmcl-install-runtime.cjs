const { createNodeInstallRuntime } = require("@xmcl/installer")
const { downloadMultiple, ProgressTrackerMultiple } = require("@xmcl/file-transfer")

/**
 * Creates an XMCL install runtime backed by Node and @xmcl/file-transfer
 * with optional dynamic progress tracking via ProgressTrackerMultiple.
 */
function createHiKatInstallRuntime({
  signal,
  onTransferProgress,
  progressStart = 0,
  progressEnd = 100,
  downloader = downloadMultiple,
} = {}) {
  let lastReportedProgress = progressStart

  const reportProgress = (value) => {
    if (typeof onTransferProgress === "function") {
      const clamped = Math.max(lastReportedProgress, Math.min(progressEnd, Math.round(value)))
      lastReportedProgress = clamped
      onTransferProgress(clamped)
    }
  }

  return createNodeInstallRuntime({
    signal,
    download: async (files) => {
      const tracker = new ProgressTrackerMultiple()
      let totalKnown = 0
      for (const file of files) {
        if (file && typeof file.size === "number" && file.size > 0) {
          totalKnown += file.size
        }
      }
      if (totalKnown > 0) {
        tracker.expectedTotal = totalKnown
      }

      let interval = null
      if (typeof onTransferProgress === "function") {
        interval = setInterval(() => {
          const total = tracker.total || totalKnown || 0
          const progress = tracker.progress || 0
          if (total > 0) {
            const ratio = Math.min(1, Math.max(0, progress / total))
            const mapped = progressStart + ratio * (progressEnd - progressStart)
            reportProgress(mapped)
          }
        }, 150)
      }

      try {
        const results = await downloader({
          options: files.map((file) => ({
            url: file.urls,
            destination: file.path,
            expectedTotal: file.size,
          })),
          tracker,
          signal,
        })

        const failures = results.filter((r) => r.status === "rejected")

        if (failures.length > 0) {
          throw new AggregateError(
            failures.map((f) => f.reason),
            "XMCL download failed"
          )
        }

        if (typeof onTransferProgress === "function") {
          reportProgress(progressEnd)
        }
      } finally {
        if (interval) {
          clearInterval(interval)
        }
      }
    },
  })
}

module.exports = { createHiKatInstallRuntime }
