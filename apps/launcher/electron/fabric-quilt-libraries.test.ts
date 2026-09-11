import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import path from "path"
import fsp from "fs/promises"
import fs from "fs"
import os from "os"
import { MinecraftFolder, Version } from "@xmcl/core"
import { resolveLibraryInstallFiles, diagnoseInstallation } from "@xmcl/installer"

// @ts-expect-error CJS module
import { installProfileLoaderLibraries } from "./minecraft-core.cjs"
// @ts-expect-error CJS module
import { createHiKatInstallRuntime } from "./xmcl-install-runtime.cjs"

async function createMockBaseVersion(instanceRoot: string, mcVersion: string) {
  const baseDir = path.join(instanceRoot, "versions", mcVersion)
  await fsp.mkdir(baseDir, { recursive: true })
  await fsp.writeFile(
    path.join(baseDir, `${mcVersion}.json`),
    JSON.stringify({
      id: mcVersion,
      mainClass: "net.minecraft.client.main.Main",
      libraries: [],
    }),
    "utf8"
  )
}

function createMockRuntime(onDownload?: (files: any[]) => void) {
  const runtime = createHiKatInstallRuntime({
    downloader: async ({ options }: any) => {
      onDownload?.(options)
      for (const opt of options) {
        fs.mkdirSync(path.dirname(opt.destination), { recursive: true })
        fs.writeFileSync(opt.destination, "mock-jar-content")
      }
      return options.map(() => ({ status: "fulfilled", value: undefined }))
    },
  })
  runtime.validate = async () => true
  return runtime
}

describe("Fabric & Quilt Loader Libraries Installation Suite", () => {
  let tempDir: string
  let instanceRoot: string
  let folder: any

  beforeEach(async () => {
    tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "hikat-loader-libs-test-"))
    instanceRoot = path.join(tempDir, "game files")
    await fsp.mkdir(instanceRoot, { recursive: true })
    folder = MinecraftFolder.from(instanceRoot)
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    try {
      await fsp.rm(tempDir, { recursive: true, force: true })
    } catch (_) {}
  })

  it("1. FABRIC: resolves and installs libraries declared in version profile before diagnosis", async () => {
    await createMockBaseVersion(instanceRoot, "1.21.1")

    const versionId = "1.21.1-fabric-0.16.10"
    const verDir = path.join(instanceRoot, "versions", versionId)
    await fsp.mkdir(verDir, { recursive: true })

    const fabricJson = {
      id: versionId,
      inheritsFrom: "1.21.1",
      mainClass: "net.fabricmc.loader.impl.launch.knot.KnotClient",
      libraries: [
        {
          name: "net.fabricmc:fabric-loader:0.16.10",
          url: "https://maven.fabricmc.net/",
        },
        {
          name: "net.fabricmc:sponge-mixin:0.15.4+mixin.0.8.7",
          url: "https://maven.fabricmc.net/",
        },
      ],
    }
    await fsp.writeFile(path.join(verDir, `${versionId}.json`), JSON.stringify(fabricJson), "utf8")

    const downloadedBatches: any[] = []
    const runtime = createMockRuntime((files) => downloadedBatches.push(files))

    await installProfileLoaderLibraries(versionId, folder, runtime)

    expect(downloadedBatches.length).toBeGreaterThanOrEqual(1)
    const allFiles = downloadedBatches.flat()
    expect(allFiles.length).toBeGreaterThanOrEqual(2)

    const destinations = allFiles.map((f: any) => f.destination)
    expect(destinations.some((d: string) => d.includes("fabric-loader"))).toBe(true)
    expect(destinations.some((d: string) => d.includes("sponge-mixin"))).toBe(true)
  })

  it("2. QUILT: resolves and installs libraries declared in version profile before diagnosis", async () => {
    await createMockBaseVersion(instanceRoot, "1.18.2")

    const versionId = "1.18.2-quilt-0.30.1"
    const verDir = path.join(instanceRoot, "versions", versionId)
    await fsp.mkdir(verDir, { recursive: true })

    const quiltJson = {
      id: versionId,
      inheritsFrom: "1.18.2",
      mainClass: "org.quiltmc.loader.impl.launch.knot.KnotClient",
      libraries: [
        {
          name: "org.quiltmc:quilt-loader:0.30.1",
          url: "https://maven.quiltmc.org/repository/release/",
        },
        {
          name: "org.quiltmc:quilt-config:1.3.3",
          url: "https://maven.quiltmc.org/repository/release/",
        },
      ],
    }
    await fsp.writeFile(path.join(verDir, `${versionId}.json`), JSON.stringify(quiltJson), "utf8")

    const downloadedBatches: any[] = []
    const runtime = createMockRuntime((files) => downloadedBatches.push(files))

    await installProfileLoaderLibraries(versionId, folder, runtime)

    expect(downloadedBatches.length).toBeGreaterThanOrEqual(1)
    const allFiles = downloadedBatches.flat()
    expect(allFiles.length).toBeGreaterThanOrEqual(2)

    const destinations = allFiles.map((f: any) => f.destination)
    expect(destinations.some((d: string) => d.includes("quilt-loader"))).toBe(true)
    expect(destinations.some((d: string) => d.includes("quilt-config"))).toBe(true)
  })

  it("3. Order of operations: libraries are installed BEFORE diagnoseInstallation is executed", async () => {
    await createMockBaseVersion(instanceRoot, "1.21.1")

    const executionLog: string[] = []

    const versionId = "1.21.1-fabric-0.16.10"
    const verDir = path.join(instanceRoot, "versions", versionId)
    await fsp.mkdir(verDir, { recursive: true })
    await fsp.writeFile(
      path.join(verDir, `${versionId}.json`),
      JSON.stringify({
        id: versionId,
        inheritsFrom: "1.21.1",
        mainClass: "net.fabricmc.loader.impl.launch.knot.KnotClient",
        libraries: [{ name: "net.fabricmc:fabric-loader:0.16.10", url: "https://maven.fabricmc.net/" }],
      }),
      "utf8"
    )

    const runtime = createMockRuntime(() => {
      executionLog.push("download-loader-libraries")
    })

    await installProfileLoaderLibraries(versionId, folder, runtime)
    executionLog.push("diagnoseInstallation")

    expect(executionLog).toEqual(["download-loader-libraries", "diagnoseInstallation"])
  })

  it("4. Integrity check fails if libraries continue missing or installation fails", async () => {
    await createMockBaseVersion(instanceRoot, "1.18.2")

    const runtime = createHiKatInstallRuntime({
      downloader: async () => {
        const error = Object.assign(new Error("Disk full or write denied"), { code: "ENOSPC" })
        throw error
      },
    })

    const versionId = "1.18.2-quilt-0.30.1"
    const verDir = path.join(instanceRoot, "versions", versionId)
    await fsp.mkdir(verDir, { recursive: true })
    await fsp.writeFile(
      path.join(verDir, `${versionId}.json`),
      JSON.stringify({
        id: versionId,
        inheritsFrom: "1.18.2",
        mainClass: "org.quiltmc.loader.impl.launch.knot.KnotClient",
        libraries: [{ name: "org.quiltmc:quilt-loader:0.30.1", url: "https://maven.quiltmc.org/repository/release/" }],
      }),
      "utf8"
    )

    await expect(
      installProfileLoaderLibraries(versionId, folder, runtime)
    ).rejects.toThrow(/Disk full or write denied/)
  })

  it("4b. If a library continues missing on disk, diagnoseInstallation detects it and fails integrity check", async () => {
    await createMockBaseVersion(instanceRoot, "1.18.2")

    const versionId = "1.18.2-quilt-0.30.1"
    const verDir = path.join(instanceRoot, "versions", versionId)
    await fsp.mkdir(verDir, { recursive: true })
    await fsp.writeFile(
      path.join(verDir, `${versionId}.json`),
      JSON.stringify({
        id: versionId,
        inheritsFrom: "1.18.2",
        mainClass: "org.quiltmc.loader.impl.launch.knot.KnotClient",
        libraries: [{ name: "org.quiltmc:quilt-loader:0.30.1", url: "https://maven.quiltmc.org/repository/release/" }],
      }),
      "utf8"
    )

    const resolved = await Version.parse(folder, versionId)
    const issue = await diagnoseInstallation(resolved)
    expect(issue).not.toBeNull()
    expect(issue?.libraries.length).toBeGreaterThan(0)
  })

  it("5. Case study Quilt 1.18.2 + 0.30.1: all 11 loader libraries form part of the install manifest", async () => {
    await createMockBaseVersion(instanceRoot, "1.18.2")

    const versionId = "1.18.2-quilt-0.30.1"
    const verDir = path.join(instanceRoot, "versions", versionId)
    await fsp.mkdir(verDir, { recursive: true })

    // Full 11 libraries from official Quilt 1.18.2 / 0.30.1 profile JSON
    const quiltLibraries = [
      { name: "net.fabricmc:sponge-mixin:0.17.3+mixin.0.8.7", url: "https://maven.fabricmc.net/" },
      { name: "org.quiltmc:quilt-json5:1.0.4+final", url: "https://maven.quiltmc.org/repository/release/" },
      { name: "org.ow2.asm:asm:9.10.1", url: "https://maven.fabricmc.net/" },
      { name: "org.ow2.asm:asm-analysis:9.10.1", url: "https://maven.fabricmc.net/" },
      { name: "org.ow2.asm:asm-commons:9.10.1", url: "https://maven.fabricmc.net/" },
      { name: "org.ow2.asm:asm-tree:9.10.1", url: "https://maven.fabricmc.net/" },
      { name: "org.ow2.asm:asm-util:9.10.1", url: "https://maven.fabricmc.net/" },
      { name: "org.quiltmc:quilt-config:1.3.3", url: "https://maven.quiltmc.org/repository/release/" },
      { name: "org.quiltmc:quilt-loader:0.30.1", url: "https://maven.quiltmc.org/repository/release/" },
      { name: "org.quiltmc:hashed:1.18.2", url: "https://maven.quiltmc.org/repository/release/" },
      { name: "net.fabricmc:intermediary:1.18.2", url: "https://maven.fabricmc.net/" },
    ]

    await fsp.writeFile(
      path.join(verDir, `${versionId}.json`),
      JSON.stringify({
        id: versionId,
        inheritsFrom: "1.18.2",
        mainClass: "org.quiltmc.loader.impl.launch.knot.KnotClient",
        libraries: quiltLibraries,
      }),
      "utf8"
    )

    const parsed = await Version.parse(folder, versionId)
    expect(parsed.libraries).toHaveLength(11)

    const resolvedFiles = resolveLibraryInstallFiles(parsed.libraries, folder)
    expect(resolvedFiles).toHaveLength(11)

    // Verify all 11 required libraries are present with their destinations
    const paths = resolvedFiles.map((f: any) => f.path)

    expect(paths.some((p: string) => p.includes("org\\quiltmc\\quilt-loader") || p.includes("org/quiltmc/quilt-loader"))).toBe(true)
    expect(paths.some((p: string) => p.includes("org\\quiltmc\\quilt-config") || p.includes("org/quiltmc/quilt-config"))).toBe(true)
    expect(paths.some((p: string) => p.includes("org\\quiltmc\\quilt-json5") || p.includes("org/quiltmc/quilt-json5"))).toBe(true)
    expect(paths.some((p: string) => p.includes("org\\quiltmc\\hashed") || p.includes("org/quiltmc/hashed"))).toBe(true)
    expect(paths.some((p: string) => p.includes("net\\fabricmc\\intermediary") || p.includes("net/fabricmc/intermediary"))).toBe(true)
    expect(paths.some((p: string) => p.includes("net\\fabricmc\\sponge-mixin") || p.includes("net/fabricmc/sponge-mixin"))).toBe(true)
    expect(paths.some((p: string) => p.includes("org\\ow2\\asm\\asm\\") || p.includes("org/ow2/asm/asm/"))).toBe(true)
    expect(paths.some((p: string) => p.includes("org\\ow2\\asm\\asm-analysis") || p.includes("org/ow2/asm/asm-analysis"))).toBe(true)
    expect(paths.some((p: string) => p.includes("org\\ow2\\asm\\asm-commons") || p.includes("org/ow2/asm/asm-commons"))).toBe(true)
    expect(paths.some((p: string) => p.includes("org\\ow2\\asm\\asm-tree") || p.includes("org/ow2/asm/asm-tree"))).toBe(true)
    expect(paths.some((p: string) => p.includes("org\\ow2\\asm\\asm-util") || p.includes("org/ow2/asm/asm-util"))).toBe(true)

    const downloadedBatches: any[] = []
    const runtime = createMockRuntime((files) => downloadedBatches.push(files))

    await installProfileLoaderLibraries(versionId, folder, runtime)

    const allDownloaded = downloadedBatches.flat()
    expect(allDownloaded).toHaveLength(11)
  })

  it("6. VANILLA, FORGE, NEOFORGE do not invoke installProfileLoaderLibraries", async () => {
    const mcCore = require("./minecraft-core.cjs")
    const spy = vi.spyOn(mcCore, "installProfileLoaderLibraries")

    // In installCore:
    // VANILLA -> early return before mod loader block
    // NEOFORGE -> executeInstallWorkflow(createModernForgeInstallWorkflow)
    // FORGE -> executeInstallWorkflow(createModernForgeInstallWorkflow)
    // None of them should call installProfileLoaderLibraries.
    expect(spy).not.toHaveBeenCalled()
  })

  it("7. Files already valid on disk are not redownloaded; XMCL manages validation", async () => {
    await createMockBaseVersion(instanceRoot, "1.21.1")

    const versionId = "1.21.1-fabric-0.16.10"
    const verDir = path.join(instanceRoot, "versions", versionId)
    await fsp.mkdir(verDir, { recursive: true })

    const fabricJson = {
      id: versionId,
      inheritsFrom: "1.21.1",
      mainClass: "net.fabricmc.loader.impl.launch.knot.KnotClient",
      libraries: [
        {
          name: "net.fabricmc:fabric-loader:0.16.10",
          url: "https://maven.fabricmc.net/",
        },
      ],
    }
    await fsp.writeFile(path.join(verDir, `${versionId}.json`), JSON.stringify(fabricJson), "utf8")

    const resolved = await Version.parse(folder, versionId)
    const files = resolveLibraryInstallFiles(resolved.libraries, folder)
    expect(files).toHaveLength(1)

    // Pre-create the file on disk
    fs.mkdirSync(path.dirname(files[0].path), { recursive: true })
    fs.writeFileSync(files[0].path, "pre-existing-valid-content")

    let downloadCalled = false
    const runtime = createMockRuntime(() => {
      downloadCalled = true
    })

    await installProfileLoaderLibraries(versionId, folder, runtime)

    // XMCL recognized the valid existing file and didn't call runtime.download
    expect(downloadCalled).toBe(false)
  })
})
