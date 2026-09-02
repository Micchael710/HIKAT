import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import path from "path"
import fs from "fs"
import fsp from "fs/promises"
import os from "os"
import http from "http"
import crypto from "crypto"
import {
  generateSyncPlan,
  executeSync,
  loadInstalledManifest,
  saveInstalledManifest,
  loadDownloadSession,
  saveDownloadSession,
  cleanStaging,
  reconcileStagingFiles,
  getDeterministicStagingFileName,
  calculateFileSha256,
  resolveAndValidateDownloadUrl,
  validateUrlSecurity,
  getEffectiveApiBaseUrl,
  uninstallGame,
  // @ts-expect-error CJS module without bundled declaration
} from "../../electron/client-files-sync.cjs"


describe("Shard 8E: Launcher Sync Engine & Filesystem Authority Tests", () => {
  let tempDir: string
  let instanceRoot: string
  let appDataRoot: string
  let server: http.Server
  let serverPort: number
  let serverBaseUrl: string

  function computeSha(content: Buffer | string): string {
    return crypto
      .createHash("sha256")
      .update(typeof content === "string" ? Buffer.from(content, "utf8") : content)
      .digest("hex")
      .toLowerCase()
  }

  beforeEach(async () => {
    tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "hikat-sync-test-"))
    appDataRoot = path.join(tempDir, "HiKAT")
    instanceRoot = path.join(appDataRoot, "game files")
    await fsp.mkdir(instanceRoot, { recursive: true })

    // Setup local HTTP server for realistic stream downloads
    server = http.createServer((req, res) => {
      const url = req.url || ""
      if (url.startsWith("/files/")) {
        const fileKey = url.replace("/files/", "")
        const content = Buffer.from(`Content for ${fileKey}`, "utf8")
        const rangeHeader = req.headers.range
        if (rangeHeader) {
          const match = rangeHeader.trim().match(/^bytes=(\d+)-(\d+)?$/)
          if (match) {
            const start = parseInt(match[1], 10)
            const end = match[2] ? parseInt(match[2], 10) : content.length - 1
            if (start >= content.length || end < start) {
              res.writeHead(416, {
                "Content-Range": `bytes */${content.length}`,
                "Accept-Ranges": "bytes",
              })
              res.end()
              return
            }
            const slice = content.subarray(start, end + 1)
            res.writeHead(206, {
              "Content-Type": "application/octet-stream",
              "Content-Range": `bytes ${start}-${end}/${content.length}`,
              "Content-Length": slice.length,
              "Accept-Ranges": "bytes",
            })
            res.end(slice)
            return
          }
        }
        res.writeHead(200, {
          "Content-Type": "application/octet-stream",
          "Content-Length": content.length,
          "Accept-Ranges": "bytes",
        })
        res.end(content)
      } else if (url.startsWith("/no-range/")) {
        // Ignores Range header and returns full content with 200
        const fileKey = url.replace("/no-range/", "")
        const content = Buffer.from(`Content for ${fileKey}`, "utf8")
        res.writeHead(200, {
          "Content-Type": "application/octet-stream",
          "Content-Length": content.length,
        })
        res.end(content)
      } else if (url.startsWith("/fail-range/")) {
        // Responds with 416 to Range request, 200 to plain GET
        const fileKey = url.replace("/fail-range/", "")
        const content = Buffer.from(`Content for ${fileKey}`, "utf8")
        if (req.headers.range) {
          res.writeHead(416, { "Content-Range": `bytes */${content.length}` })
          res.end()
        } else {
          res.writeHead(200, {
            "Content-Type": "application/octet-stream",
            "Content-Length": content.length,
          })
          res.end(content)
        }
      } else if (url.startsWith("/slow/")) {
        // Slow streaming endpoint for pause/abort testing
        res.writeHead(200, { "Content-Type": "application/octet-stream" })
        res.write(Buffer.from("part1", "utf8"))
        setTimeout(() => {
          if (!res.writableEnded) {
            res.write(Buffer.from("part2", "utf8"))
            res.end()
          }
        }, 500)
      } else if (url.startsWith("/redirect-evil")) {
        // Redirect to external evil site
        res.writeHead(302, { Location: "https://evil.com/malware.jar" })
        res.end()
      } else {
        res.writeHead(404)
        res.end()
      }
    })

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address() as any
        serverPort = addr.port
        serverBaseUrl = `http://127.0.0.1:${serverPort}`
        resolve()
      })
    })
  })

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
    try {
      await fsp.rm(tempDir, { recursive: true, force: true })
    } catch (_) {}
  })

  // ─────────────────────────────────────────────────────────────
  // 1. Filesystem Authority & MODIFICABLE Tests
  // ─────────────────────────────────────────────────────────────
  describe("Filesystem as the True Authority", () => {
    it("1. Missing file in instanceRoot produces toDownload even if manifest exists", async () => {
      const expectedSha = computeSha("mod content")
      const clientFiles = [
        {
          path: "mods/example.jar",
          sha256: expectedSha,
          sizeBytes: 11,
          policy: "NO_MODIFICABLE",
          downloadUrl: `${serverBaseUrl}/files/example`,
        },
      ]

      await saveInstalledManifest(instanceRoot, {
        modpackVersion: "1.0.0",
        lastSync: new Date().toISOString(),
        files: {
          "mods/example.jar": {
            officialSha256: expectedSha,
            policy: "NO_MODIFICABLE",
            lastSyncedAt: new Date().toISOString(),
          },
        },
      })

      const plan = await generateSyncPlan(instanceRoot, clientFiles, "1.0.0")
      expect(plan.toDownload).toHaveLength(1)
      expect(plan.toDownload[0].path).toBe("mods/example.jar")
      expect(plan.toRetain).toHaveLength(0)
    })

    it("2. File on disk with invalid/tampered SHA-256 is scheduled for redownload", async () => {
      const officialSha = computeSha("official content")
      const tamperedContent = "tampered content"
      const modPath = path.join(instanceRoot, "mods", "example.jar")
      await fsp.mkdir(path.dirname(modPath), { recursive: true })
      await fsp.writeFile(modPath, tamperedContent, "utf8")

      const clientFiles = [
        {
          path: "mods/example.jar",
          sha256: officialSha,
          sizeBytes: 16,
          policy: "NO_MODIFICABLE",
          downloadUrl: `${serverBaseUrl}/files/example`,
        },
      ]

      const plan = await generateSyncPlan(instanceRoot, clientFiles, "1.0.0")
      expect(plan.toDownload).toHaveLength(1)
      expect(plan.toDownload[0].sha256).toBe(officialSha)
      expect(plan.toRetain).toHaveLength(0)
    })

    it("3. Healthy filesystem with matching SHA-256 retains files without downloading", async () => {
      const content = "exact valid mod content"
      const officialSha = computeSha(content)
      const modPath = path.join(instanceRoot, "mods", "valid.jar")
      await fsp.mkdir(path.dirname(modPath), { recursive: true })
      await fsp.writeFile(modPath, content, "utf8")

      const clientFiles = [
        {
          path: "mods/valid.jar",
          sha256: officialSha,
          sizeBytes: Buffer.byteLength(content),
          policy: "NO_MODIFICABLE",
          downloadUrl: `${serverBaseUrl}/files/valid`,
        },
      ]

      const plan = await generateSyncPlan(instanceRoot, clientFiles, "1.0.0")
      expect(plan.toDownload).toHaveLength(0)
      expect(plan.toRetain).toHaveLength(1)
      expect(plan.toRetain[0].path).toBe("mods/valid.jar")
    })

    it("4. Fresh directory results in all files in toDownload (Download state)", async () => {
      const clientFiles = [
        {
          path: "mods/mod1.jar",
          sha256: computeSha("m1"),
          sizeBytes: 2,
          policy: "NO_MODIFICABLE",
          downloadUrl: `${serverBaseUrl}/files/m1`,
        },
        {
          path: "mods/mod2.jar",
          sha256: computeSha("m2"),
          sizeBytes: 2,
          policy: "NO_MODIFICABLE",
          downloadUrl: `${serverBaseUrl}/files/m2`,
        },
      ]

      const plan = await generateSyncPlan(instanceRoot, clientFiles, "1.0.0")
      expect(plan.toDownload).toHaveLength(2)
      expect(plan.hasExistingInstall).toBe(false)
    })

    it("5. MODIFICABLE policy: retains user modifications if admin officialSha256 unchanged", async () => {
      const officialSha = computeSha("original config")
      const userModifiedContent = "user customized config text"
      const configPath = path.join(instanceRoot, "config", "custom.toml")
      await fsp.mkdir(path.dirname(configPath), { recursive: true })
      await fsp.writeFile(configPath, userModifiedContent, "utf8")

      await saveInstalledManifest(instanceRoot, {
        modpackVersion: "1.0.0",
        lastSync: new Date().toISOString(),
        files: {
          "config/custom.toml": {
            officialSha256: officialSha,
            policy: "MODIFICABLE",
            lastSyncedAt: new Date().toISOString(),
          },
        },
      })

      const clientFiles = [
        {
          path: "config/custom.toml",
          sha256: officialSha,
          sizeBytes: 100,
          policy: "MODIFICABLE",
          downloadUrl: `${serverBaseUrl}/files/cfg1`,
        },
      ]

      const plan = await generateSyncPlan(instanceRoot, clientFiles, "1.0.0")
      expect(plan.toPreserveUser).toHaveLength(1)
      expect(plan.toPreserveUser[0].path).toBe("config/custom.toml")
      expect(plan.toDownload).toHaveLength(0)
    })

    it("6. MODIFICABLE policy: updates file when admin publishes new official version", async () => {
      const oldOfficialSha = computeSha("old official config")
      const newOfficialSha = computeSha("new official config updated")
      const userContent = "user modifications"
      const configPath = path.join(instanceRoot, "config", "custom.toml")
      await fsp.mkdir(path.dirname(configPath), { recursive: true })
      await fsp.writeFile(configPath, userContent, "utf8")

      await saveInstalledManifest(instanceRoot, {
        modpackVersion: "1.0.0",
        lastSync: new Date().toISOString(),
        files: {
          "config/custom.toml": {
            officialSha256: oldOfficialSha,
            policy: "MODIFICABLE",
            lastSyncedAt: new Date().toISOString(),
          },
        },
      })

      const clientFiles = [
        {
          path: "config/custom.toml",
          sha256: newOfficialSha,
          sizeBytes: 100,
          policy: "MODIFICABLE",
          downloadUrl: `${serverBaseUrl}/files/cfg1`,
        },
      ]

      const plan = await generateSyncPlan(instanceRoot, clientFiles, "1.1.0")
      expect(plan.toDownload).toHaveLength(1)
      expect(plan.toPreserveUser).toHaveLength(0)
    })

    it("7. MODIFICABLE complete executeSync flow: old A -> new B -> download B -> apply -> verify clean -> manifest B", async () => {
      const oldOfficialContent = "old official version A"
      const oldOfficialSha = computeSha(oldOfficialContent)
      const configPath = path.join(instanceRoot, "config", "options.txt")
      await fsp.mkdir(path.dirname(configPath), { recursive: true })
      await fsp.writeFile(configPath, oldOfficialContent, "utf8")

      await saveInstalledManifest(instanceRoot, {
        modpackVersion: "1.0.0",
        lastSync: new Date().toISOString(),
        files: {
          "config/options.txt": {
            officialSha256: oldOfficialSha,
            policy: "MODIFICABLE",
            lastSyncedAt: new Date().toISOString(),
          },
        },
      })

      const newContent = "Content for options-b"
      const newSha = computeSha(newContent)

      const clientFiles = [
        {
          path: "config/options.txt",
          sha256: newSha,
          sizeBytes: Buffer.byteLength(newContent),
          policy: "MODIFICABLE",
          downloadUrl: `${serverBaseUrl}/files/options-b`,
        },
      ]

      const syncRes = await executeSync({
        instanceRoot,
        clientFiles,
        modpackVersion: "2.0.0",
        apiBaseUrl: serverBaseUrl,
      })

      expect(syncRes.success).toBe(true)
      expect(fs.readFileSync(configPath, "utf8")).toBe(newContent)

      const postManifest = await loadInstalledManifest(instanceRoot)
      expect(postManifest.modpackVersion).toBe("2.0.0")
      expect(postManifest.files["config/options.txt"]?.officialSha256).toBe(newSha)

      // Post-verification check with generateSyncPlan returns 0 toDownload
      const finalPlan = await generateSyncPlan(instanceRoot, clientFiles, "2.0.0")
      expect(finalPlan.toDownload).toHaveLength(0)
      expect(finalPlan.toRetain).toHaveLength(1)
    })
  })

  // ─────────────────────────────────────────────────────────────
  // 2. Pause & Resume Semantics (No Partial Byte Resume)
  // ─────────────────────────────────────────────────────────────
  describe("Pause, Resume & Staging Reconciliation", () => {
    it("8. Staging file names are deterministic, collision-free, and path-safe", () => {
      const task1 = { path: "mods/create.jar", sha256: "a".repeat(64) }
      const task2 = { path: "mods/sub/create.jar", sha256: "a".repeat(64) }
      const task3 = { path: "mods/create.jar", sha256: "b".repeat(64) }

      const name1 = getDeterministicStagingFileName(task1)
      const name2 = getDeterministicStagingFileName(task2)
      const name3 = getDeterministicStagingFileName(task3)

      expect(name1).toContain("stage_")
      expect(name1).not.toBe(name2)
      expect(name1).not.toBe(name3)
      expect(name1).toMatch(/^[a-zA-Z0-9._-]+$/)
    })

    it("9. reconcileStagingFiles reuses verified staged files, preserves partials, and removes corrupt ones", async () => {
      const validContent = "valid completed staged binary"
      const validSha = computeSha(validContent)

      const taskValid = {
        path: "mods/valid.jar",
        sha256: validSha,
        sizeBytes: Buffer.byteLength(validContent),
      }
      const taskPartial = {
        path: "mods/partial.jar",
        sha256: computeSha("full partial binary content here"),
        sizeBytes: Buffer.byteLength("full partial binary content here"),
      }
      const taskCorrupt = {
        path: "mods/bad.jar",
        sha256: "c".repeat(64),
        sizeBytes: 50,
      }
      const taskOversized = {
        path: "mods/oversized.jar",
        sha256: "d".repeat(64),
        sizeBytes: 10,
      }

      const filesDir = path.join(instanceRoot, ".hikat", "staging", "files")
      await fsp.mkdir(filesDir, { recursive: true })

      const validStagingFile = path.join(filesDir, getDeterministicStagingFileName(taskValid))
      await fsp.writeFile(validStagingFile, validContent, "utf8")

      const partialStagingFile = path.join(filesDir, getDeterministicStagingFileName(taskPartial))
      await fsp.writeFile(partialStagingFile, "full partial", "utf8") // 12 bytes out of 32 bytes

      const corruptStagingFile = path.join(filesDir, getDeterministicStagingFileName(taskCorrupt))
      await fsp.writeFile(corruptStagingFile, "bad content".padEnd(50, "x"), "utf8")

      const oversizedStagingFile = path.join(filesDir, getDeterministicStagingFileName(taskOversized))
      await fsp.writeFile(oversizedStagingFile, "oversized content beyond limit", "utf8")

      const { validStagedMap, alreadyStagedBytes } = await reconcileStagingFiles(
        instanceRoot,
        [taskValid, taskPartial, taskCorrupt, taskOversized],
      )

      expect(validStagedMap.has("mods/valid.jar")).toBe(true)
      expect(validStagedMap.has("mods/partial.jar")).toBe(false) // Not complete yet, so not in validStagedMap
      expect(validStagedMap.has("mods/bad.jar")).toBe(false)
      expect(alreadyStagedBytes).toBe(Buffer.byteLength(validContent) + 12) // Includes 12 bytes of partial
      expect(fs.existsSync(validStagingFile)).toBe(true)
      expect(fs.existsSync(partialStagingFile)).toBe(true) // Preserved for resume!
      expect(fs.existsSync(corruptStagingFile)).toBe(false)
      expect(fs.existsSync(oversizedStagingFile)).toBe(false)
    })

    it("10. Pause retains completed files and partial downloads in staging", async () => {
      const filesDir = path.join(instanceRoot, ".hikat", "staging", "files")
      await fsp.mkdir(filesDir, { recursive: true })

      const completedTasks: any[] = []
      for (let i = 1; i <= 10; i++) {
        const c = `file ${i} data`
        const sha = computeSha(c)
        const task = {
          path: `mods/mod${i}.jar`,
          sha256: sha,
          sizeBytes: Buffer.byteLength(c),
          policy: "NO_MODIFICABLE",
          downloadUrl: `${serverBaseUrl}/files/mod${i}`,
        }
        completedTasks.push(task)
        await fsp.writeFile(
          path.join(filesDir, getDeterministicStagingFileName(task)),
          c,
          "utf8",
        )
      }

      const file11Task = {
        path: "mods/mod11.jar",
        sha256: computeSha("part1part2"),
        sizeBytes: 10,
        policy: "NO_MODIFICABLE",
        downloadUrl: `${serverBaseUrl}/slow/mod11`,
      }
      const allTasks = [...completedTasks, file11Task]

      const cancelSignal = { isCancelled: false, isPaused: false }
      setTimeout(() => {
        cancelSignal.isPaused = true
      }, 50)

      const result = await executeSync({
        instanceRoot,
        clientFiles: allTasks,
        modpackVersion: "1.0.0",
        cancelSignal,
        apiBaseUrl: serverBaseUrl,
      })

      expect(result.paused).toBe(true)

      for (let i = 1; i <= 10; i++) {
        const stFile = path.join(filesDir, getDeterministicStagingFileName(completedTasks[i - 1]))
        expect(fs.existsSync(stFile)).toBe(true)
      }

      // Partial file11 is preserved in staging
      const stFile11 = path.join(filesDir, getDeterministicStagingFileName(file11Task))
      expect(fs.existsSync(stFile11)).toBe(true)

      const session = await loadDownloadSession(instanceRoot)
      expect(session?.status).toBe("PAUSED")
    })

    it("10B. Range resume: partial staging file continues from its exact offset and completes", async () => {
      const filesDir = path.join(instanceRoot, ".hikat", "staging", "files")
      await fsp.mkdir(filesDir, { recursive: true })

      const fullContent = "Content for resumed-file-12345"
      const fullSha = computeSha(fullContent)
      const fullLength = Buffer.byteLength(fullContent) // 30 bytes

      const task = {
        path: "mods/resumed.jar",
        sha256: fullSha,
        sizeBytes: fullLength,
        policy: "NO_MODIFICABLE",
        downloadUrl: `${serverBaseUrl}/files/resumed-file-12345`,
      }

      // Pre-create partial staging file with first 12 bytes ("Content for ")
      const partialContent = fullContent.slice(0, 12)
      const stagingFilePath = path.join(filesDir, getDeterministicStagingFileName(task))
      await fsp.writeFile(stagingFilePath, partialContent, "utf8")

      let reportedChunkBytes = 0
      const progressList: number[] = []

      const result = await executeSync({
        instanceRoot,
        clientFiles: [task],
        modpackVersion: "1.0.0",
        onProgress: (p: any) => progressList.push(p.downloadedBytes),
        apiBaseUrl: serverBaseUrl,
      })

      expect(result.success).toBe(true)

      // Verified final file installed in instanceRoot
      const installedPath = path.join(instanceRoot, "mods", "resumed.jar")
      expect(fs.existsSync(installedPath)).toBe(true)
      const installedData = await fsp.readFile(installedPath, "utf8")
      expect(installedData).toBe(fullContent)
    })

    it("10C. Fallback to full download if server returns 200 (no Range) or 416, discounting partial bytes from progress", async () => {
      const filesDir = path.join(instanceRoot, ".hikat", "staging", "files")
      await fsp.mkdir(filesDir, { recursive: true })

      const fullContent = "Content for no-range-mod"
      const fullSha = computeSha(fullContent)
      const fullLength = Buffer.byteLength(fullContent)

      const taskNoRange = {
        path: "mods/no-range.jar",
        sha256: fullSha,
        sizeBytes: fullLength,
        policy: "NO_MODIFICABLE",
        downloadUrl: `${serverBaseUrl}/no-range/no-range-mod`,
      }

      // Pre-create partial staging file with 8 bytes
      const stagingFilePath = path.join(filesDir, getDeterministicStagingFileName(taskNoRange))
      await fsp.writeFile(stagingFilePath, fullContent.slice(0, 8), "utf8")

      const result = await executeSync({
        instanceRoot,
        clientFiles: [taskNoRange],
        modpackVersion: "1.0.0",
        apiBaseUrl: serverBaseUrl,
      })

      expect(result.success).toBe(true)
      const installedPath = path.join(instanceRoot, "mods", "no-range.jar")
      expect(fs.existsSync(installedPath)).toBe(true)
      const installedData = await fsp.readFile(installedPath, "utf8")
      expect(installedData).toBe(fullContent)
    })

    it("10D. Full SHA-256 and size integrity validated after resuming; corrupted final fails", async () => {
      const filesDir = path.join(instanceRoot, ".hikat", "staging", "files")
      await fsp.mkdir(filesDir, { recursive: true })

      const fullContent = "Content for corrupted-resume"
      const expectedSha = computeSha("Something completely different") // Wrong expected hash
      const task = {
        path: "mods/corrupt.jar",
        sha256: expectedSha,
        sizeBytes: Buffer.byteLength(fullContent),
        policy: "NO_MODIFICABLE",
        downloadUrl: `${serverBaseUrl}/files/corrupted-resume`,
      }

      // Pre-create partial file
      const stagingFilePath = path.join(filesDir, getDeterministicStagingFileName(task))
      await fsp.writeFile(stagingFilePath, "Content for ", "utf8")

      await expect(
        executeSync({
          instanceRoot,
          clientFiles: [task],
          modpackVersion: "1.0.0",
          apiBaseUrl: serverBaseUrl,
        }),
      ).rejects.toThrow(/SHA-256 mismatch/i)

      // The corrupt staging file is deleted
      expect(fs.existsSync(stagingFilePath)).toBe(false)
    })

    it("11. Resume reuses 10 completed files and only downloads file 11", async () => {
      const filesDir = path.join(instanceRoot, ".hikat", "staging", "files")
      await fsp.mkdir(filesDir, { recursive: true })

      const completedTasks: any[] = []
      for (let i = 1; i <= 10; i++) {
        const c = `file ${i} data`
        const sha = computeSha(c)
        const task = {
          path: `mods/mod${i}.jar`,
          sha256: sha,
          sizeBytes: Buffer.byteLength(c),
          policy: "NO_MODIFICABLE",
          downloadUrl: `${serverBaseUrl}/files/mod${i}`,
        }
        completedTasks.push(task)
        await fsp.writeFile(
          path.join(filesDir, getDeterministicStagingFileName(task)),
          c,
          "utf8",
        )
      }

      const mod11Content = "Content for mod11"
      const file11Task = {
        path: "mods/mod11.jar",
        sha256: computeSha(mod11Content),
        sizeBytes: Buffer.byteLength(mod11Content),
        policy: "NO_MODIFICABLE",
        downloadUrl: `${serverBaseUrl}/files/mod11`,
      }
      const allTasks = [...completedTasks, file11Task]

      const result = await executeSync({
        instanceRoot,
        clientFiles: allTasks,
        modpackVersion: "1.0.0",
        apiBaseUrl: serverBaseUrl,
      })

      expect(result.success).toBe(true)
      expect(result.downloadedCount).toBe(11)

      for (let i = 1; i <= 11; i++) {
        expect(fs.existsSync(path.join(instanceRoot, `mods/mod${i}.jar`))).toBe(true)
      }
    })
  })

  // ─────────────────────────────────────────────────────────────
  // 3. Phase A -> B Barrier & Cancel Invariants
  // ─────────────────────────────────────────────────────────────
  describe("Phase A -> Phase B Barrier & Cancel Invariants", () => {
    it("12. Barrier: Cancel at end of Phase A strictly stops before entering INSTALLING", async () => {
      const task = {
        path: "mods/m.jar",
        sha256: computeSha("Content for m"),
        sizeBytes: 13,
        policy: "NO_MODIFICABLE",
        downloadUrl: `${serverBaseUrl}/files/m`,
      }

      const cancelSignal = { isCancelled: false, isPaused: false }
      const phases: string[] = []

      // Trigger cancel right before Phase B
      const syncPromise = executeSync({
        instanceRoot,
        clientFiles: [task],
        modpackVersion: "1.0.0",
        cancelSignal,
        onPhaseChange: (p: string) => phases.push(p),
        apiBaseUrl: serverBaseUrl,
      })

      cancelSignal.isCancelled = true

      await expect(syncPromise).rejects.toThrow(/cancelled/i)
      expect(phases).not.toContain("INSTALLING")
      expect(fs.existsSync(path.join(instanceRoot, ".hikat", "staging"))).toBe(false)
    })

    it("13. Barrier: Pause at end of Phase A saves paused session without entering INSTALLING", async () => {
      const task = {
        path: "mods/p.jar",
        sha256: computeSha("Content for p"),
        sizeBytes: 13,
        policy: "NO_MODIFICABLE",
        downloadUrl: `${serverBaseUrl}/files/p`,
      }

      const cancelSignal = { isCancelled: false, isPaused: false }
      const phases: string[] = []

      cancelSignal.isPaused = true

      const res = await executeSync({
        instanceRoot,
        clientFiles: [task],
        modpackVersion: "1.0.0",
        cancelSignal,
        onPhaseChange: (p: string) => phases.push(p),
        apiBaseUrl: serverBaseUrl,
      })

      expect(res.paused).toBe(true)
      expect(phases).not.toContain("INSTALLING")
      const session = await loadDownloadSession(instanceRoot)
      expect(session?.status).toBe("PAUSED")
    })

    it("14. Cancel cleans staging and session but leaves installed version 100% intact", async () => {
      const existingMod = path.join(instanceRoot, "mods", "v1.jar")
      await fsp.mkdir(path.dirname(existingMod), { recursive: true })
      await fsp.writeFile(existingMod, "version 1.0 mod", "utf8")
      const v1Sha = computeSha("version 1.0 mod")

      await saveInstalledManifest(instanceRoot, {
        modpackVersion: "1.0.0",
        lastSync: new Date().toISOString(),
        files: {
          "mods/v1.jar": {
            officialSha256: v1Sha,
            policy: "NO_MODIFICABLE",
            lastSyncedAt: new Date().toISOString(),
          },
        },
      })

      const cancelSignal = { isCancelled: true, isPaused: false }
      const newTasks = [
        {
          path: "mods/v2.jar",
          sha256: computeSha("Content for v2"),
          sizeBytes: 14,
          policy: "NO_MODIFICABLE",
          downloadUrl: `${serverBaseUrl}/files/v2`,
        },
      ]

      await expect(
        executeSync({
          instanceRoot,
          clientFiles: newTasks,
          modpackVersion: "2.0.0",
          cancelSignal,
          apiBaseUrl: serverBaseUrl,
        }),
      ).rejects.toThrow(/cancelled/i)

      expect(fs.existsSync(path.join(instanceRoot, ".hikat", "staging"))).toBe(false)
      expect(fs.existsSync(existingMod)).toBe(true)
      const installedManifest = await loadInstalledManifest(instanceRoot)
      expect(installedManifest.modpackVersion).toBe("1.0.0")
    })
  })

  // ─────────────────────────────────────────────────────────────
  // 4. Safe Apply via Temp Sibling & Fail-Hard Pruning
  // ─────────────────────────────────────────────────────────────
  describe("Phase B: Safe Temp Sibling Apply & Strict Pruning", () => {
    it("15. Pruning failure strictly fails sync and aborts manifest save", async () => {
      const extraMod = path.join(instanceRoot, "mods", "extra.jar")
      await fsp.mkdir(path.dirname(extraMod), { recursive: true })
      await fsp.writeFile(extraMod, "extra", "utf8")

      const realUnlink = fsp.unlink
      vi.spyOn(fsp, "unlink").mockImplementation(async (target: any) => {
        if (String(target).includes("extra.jar")) {
          throw new Error("EPERM: operation not permitted")
        }
        return realUnlink(target)
      })

      await expect(
        executeSync({
          instanceRoot,
          clientFiles: [],
          modpackVersion: "1.0.0",
          apiBaseUrl: serverBaseUrl,
        }),
      ).rejects.toThrow(/Pruning failed/i)

      const manifest = await loadInstalledManifest(instanceRoot)
      expect(manifest.modpackVersion).toBeNull()
    })

    it("16. Full successful sync downloads, applies via temp sibling, prunes obsoletes, and writes manifest atomically", async () => {
      const obsoleteMod = path.join(instanceRoot, "mods", "obsolete.jar")
      await fsp.mkdir(path.dirname(obsoleteMod), { recursive: true })
      await fsp.writeFile(obsoleteMod, "obsolete data", "utf8")

      const modContent = "Content for real-mod"
      const modSha = computeSha(modContent)

      const clientFiles = [
        {
          path: "mods/real-mod.jar",
          sha256: modSha,
          sizeBytes: Buffer.byteLength(modContent),
          policy: "NO_MODIFICABLE",
          downloadUrl: `${serverBaseUrl}/files/real-mod`,
        },
      ]

      const phases: string[] = []
      const res = await executeSync({
        instanceRoot,
        clientFiles,
        modpackVersion: "3.0.0",
        onPhaseChange: (p: string) => phases.push(p),
        apiBaseUrl: serverBaseUrl,
      })

      expect(res.success).toBe(true)
      expect(phases).toContain("INSTALLING")
      expect(fs.existsSync(path.join(instanceRoot, "mods", "real-mod.jar"))).toBe(true)
      expect(fs.existsSync(obsoleteMod)).toBe(false)

      const manifest = await loadInstalledManifest(instanceRoot)
      expect(manifest.modpackVersion).toBe("3.0.0")
      expect(manifest.files["mods/real-mod.jar"]?.officialSha256).toBe(modSha)
    })
  })

  // ─────────────────────────────────────────────────────────────
  // 5. Security: URL Validation & Environment Modes
  // ─────────────────────────────────────────────────────────────
  describe("Security: URL Environment Modes & Boundaries", () => {
    it("17. Production mode: HTTPS apparatia.net allowed, localhost strictly blocked", () => {
      const origEnv = process.env.NODE_ENV
      process.env.NODE_ENV = "production"
      try {
        expect(validateUrlSecurity(new URL("https://api.apparatia.net/game/download/1"))).toBe(true)
        expect(validateUrlSecurity(new URL("https://cdn.apparatia.net/files/mod.jar"))).toBe(true)

        // Localhost blocked in production
        expect(() => validateUrlSecurity(new URL("http://localhost:3000/mod.jar"))).toThrow(
          /forbidden in production/i,
        )
        expect(() => validateUrlSecurity(new URL("http://127.0.0.1:3000/mod.jar"))).toThrow(
          /forbidden in production/i,
        )

        // Non-HTTPS blocked in production
        expect(() => validateUrlSecurity(new URL("http://api.apparatia.net/mod.jar"))).toThrow(
          /strictly forbidden in production/i,
        )

        // Foreign domains blocked in production
        expect(() => validateUrlSecurity(new URL("https://evil.com/mod.jar"))).toThrow(
          /Unauthorized external download host/i,
        )
      } finally {
        process.env.NODE_ENV = origEnv
      }
    })

    it("18. Development mode: localhost HTTP allowed, foreign domains blocked", () => {
      const origEnv = process.env.NODE_ENV
      process.env.NODE_ENV = "development"
      try {
        expect(validateUrlSecurity(new URL("http://localhost:8787/game/download/1"))).toBe(true)
        expect(validateUrlSecurity(new URL("http://127.0.0.1:8787/game/download/1"))).toBe(true)

        // Foreign domains still blocked in dev
        expect(() => validateUrlSecurity(new URL("https://unauthorized.org/mod.jar"))).toThrow(
          /Unauthorized external download host/i,
        )
      } finally {
        process.env.NODE_ENV = origEnv
      }
    })

    it("19. Real uninstall removes instanceRoot securely and blocks paths outside appData", async () => {
      const mod = path.join(instanceRoot, "mods", "installed.jar")
      await fsp.mkdir(path.dirname(mod), { recursive: true })
      await fsp.writeFile(mod, "jar", "utf8")

      const res = await uninstallGame(instanceRoot, appDataRoot)
      expect(res.success).toBe(true)
      expect(fs.existsSync(instanceRoot)).toBe(false)

      await expect(uninstallGame(tempDir, appDataRoot)).rejects.toThrow(/Security violation/i)
      await expect(uninstallGame("C:\\", appDataRoot)).rejects.toThrow(/Security violation/i)
    })

    it("20. getEffectiveApiBaseUrl returns local backend (http://127.0.0.1:8787) in development and production default in production", () => {
      const origEnv = process.env.NODE_ENV
      const origHikatApi = process.env.HIKAT_API_URL
      const origViteApi = process.env.VITE_API_URL
      delete process.env.HIKAT_API_URL
      delete process.env.VITE_API_URL

      try {
        process.env.NODE_ENV = "development"
        expect(getEffectiveApiBaseUrl()).toBe("http://127.0.0.1:8787")

        process.env.NODE_ENV = "production"
        expect(getEffectiveApiBaseUrl()).toBe("https://api.apparatia.net/api/v1")

        // Override takes precedence
        process.env.HIKAT_API_URL = "http://localhost:9999"
        expect(getEffectiveApiBaseUrl()).toBe("http://localhost:9999")
      } finally {
        process.env.NODE_ENV = origEnv
        if (origHikatApi) process.env.HIKAT_API_URL = origHikatApi
        else delete process.env.HIKAT_API_URL
        if (origViteApi) process.env.VITE_API_URL = origViteApi
        else delete process.env.VITE_API_URL
      }
    })

    it("21. resolveAndValidateDownloadUrl resolves relative manifest paths to local backend in development", () => {
      const origEnv = process.env.NODE_ENV
      delete process.env.HIKAT_API_URL
      delete process.env.VITE_API_URL
      process.env.NODE_ENV = "development"

      try {
        const resolved = resolveAndValidateDownloadUrl("/game/download/file-mod-123")
        expect(resolved).toBe("http://127.0.0.1:8787/game/download/file-mod-123")
      } finally {
        process.env.NODE_ENV = origEnv
      }
    })

    it("22. Full smoke integration: relative manifest download URLs are downloaded against the specified local serverBaseUrl", async () => {
      const modContent = "Content for smoke-mod"
      const modSha = computeSha(modContent)
      const task = {
        path: "mods/smoke-mod.jar",
        sha256: modSha,
        sizeBytes: Buffer.byteLength(modContent),
        policy: "NO_MODIFICABLE",
        downloadUrl: "/files/smoke-mod", // Relative download URL from manifest
      }


      const res = await executeSync({
        instanceRoot,
        clientFiles: [task],
        modpackVersion: "1.0.0",
        apiBaseUrl: serverBaseUrl,
      })

      expect(res.success).toBe(true)
      expect(res.downloadedCount).toBe(1)
      const installedFile = path.join(instanceRoot, "mods", "smoke-mod.jar")
      expect(fs.existsSync(installedFile)).toBe(true)
      const content = await fsp.readFile(installedFile, "utf8")
      expect(content).toBe("Content for smoke-mod")
    })
  })
})

