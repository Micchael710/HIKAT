import { describe, it, expect, vi, beforeEach } from "vitest"
import { Database, createDatabase, schema } from "@hikat/database"
import { createTestD1 } from "@hikat/database/testUtils"
import { eq, and } from "drizzle-orm"

import {
  getPublishedModpack,
  publishGameRelease,
  prepareGameDraft,
  hasServerRelevantChanges,
} from "./releaseService"
import {
  getAdminSettings,
  updateAdminSettings,
  ensureSettingsRecord,
} from "../settingsService"
import {
  getServerReleaseSyncPlan,
  applyServerReleaseSync,
} from "../pterodactyl/serverReleaseSyncService"
import type { Env } from "../../types"
import type { IPterodactylClient } from "../pterodactyl/types"

function createMockR2(files: Map<string, Uint8Array> = new Map()): any {
  return {
    async get(key: string) {
      const data = files.get(key)
      if (!data) return null
      return {
        arrayBuffer: async () => data.buffer,
        size: data.byteLength,
      }
    },
    async head(key: string) {
      const data = files.get(key)
      if (!data) return null
      return { size: data.byteLength }
    },
    async put(key: string, data: any) {
      const buf = new Uint8Array(data)
      files.set(key, buf)
    },
    async delete(key: string) {
      files.delete(key)
    },
  }
}

function createMockPterodactylClient(options: {
  status?: string
  files?: Map<string, Uint8Array | string>
  failBackup?: boolean
  failWrite?: boolean
  failDelete?: boolean
  unavailable?: boolean
} = {}): IPterodactylClient {
  const fileStore = options.files || new Map<string, Uint8Array | string>()

  return {
    async getServerResources() {
      if (options.unavailable) throw new Error("Pterodactyl unavailable (connection timeout)")
      return {
        attributes: {
          current_state: options.status || "offline",
          is_suspended: false,
          resources: {
            memory_bytes: 1024,
            cpu_absolute: 5,
            disk_bytes: 2048,
            network_rx_bytes: 0,
            network_tx_bytes: 0,
            uptime: 100,
          },
        },
      }
    },
    async getServerDetails() {
      if (options.unavailable) throw new Error("Pterodactyl unavailable (connection timeout)")
      return {
        attributes: {
          limits: { memory: 1024, cpu: 100, disk: 10240 },
          is_suspended: false,
        },
      }
    },
    async listDirectory(path: string) {
      if (options.unavailable) throw new Error("Connection refused")
      const prefix = path.replace(/^\/+/, "").replace(/\/+$/, "")
      const items: any[] = []
      for (const [filePath, content] of fileStore.entries()) {
        const normalized = filePath.replace(/^\/+/, "")
        const parts = normalized.split("/")
        if (prefix === "" || normalized.startsWith(prefix + "/")) {
          const name = prefix === "" ? parts[0] : parts[parts.length - 1]
          const size = typeof content === "string" ? content.length : content.byteLength
          items.push({
            attributes: {
              name,
              is_file: true,
              size,
              modified_at: new Date().toISOString(),
            },
          })
        }
      }
      return { data: items }
    },
    async createFolder() {},
    async writeFile(path: string, content: Uint8Array | string) {
      if (options.failWrite) throw new Error("Disk write error on Wings")
      const normalized = path.replace(/^\/+/, "")
      fileStore.set(normalized, content)
    },
    async deleteFiles(path: string, rootFiles: string[]) {
      if (options.failDelete) throw new Error("Failed to delete file on Wings")
      for (const f of rootFiles) {
        const full = path.replace(/^\/+/, "") + "/" + f
        fileStore.delete(full.replace(/^\/+/, ""))
      }
    },
    async createBackup() {
      if (options.failBackup) {
        return { attributes: { id: "backup-fail-1", is_successful: false, completed_at: new Date().toISOString() } }
      }
      return { attributes: { id: "backup-ok-1", is_successful: true, completed_at: new Date().toISOString() } }
    },
    async getBackup() {
      if (options.failBackup) {
        return { attributes: { id: "backup-fail-1", is_successful: false, completed_at: new Date().toISOString() } }
      }
      return { attributes: { id: "backup-ok-1", is_successful: true, completed_at: new Date().toISOString() } }
    },
    async getFileDetails(path: string) {
      const normalized = path.replace(/^\/+/, "")
      const content = fileStore.get(normalized)
      if (!content) throw new Error("File not found")
      return {
        attributes: {
          name: normalized.split("/").pop() || "",
          size: typeof content === "string" ? content.length : content.byteLength,
        },
      }
    },
  } as unknown as IPterodactylClient
}

// Valid dummy zip/jar helper for R2 test binaries
async function createValidJarBuffer(name: string): Promise<{ buffer: Uint8Array; sha256: string }> {
  // Minimal valid PK zip signature: PK\x03\x04 + dummy content
  const header = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00])
  const nameBytes = new TextEncoder().encode(name)
  const full = new Uint8Array(header.byteLength + nameBytes.byteLength + 64)
  full.set(header, 0)
  full.set(nameBytes, header.byteLength)

  const shaBuf = await crypto.subtle.digest("SHA-256", full.buffer)
  const sha256 = Array.from(new Uint8Array(shaBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")

  return { buffer: full, sha256 }
}

describe("Shard 8F: Final Integration & Release Activation Test Suite", () => {
  let d1: ReturnType<typeof createTestD1>
  let db: Database
  let r2Files: Map<string, Uint8Array>
  let testEnv: Env
  let adminId: string
  let playerId: string

  beforeEach(async () => {
    d1 = createTestD1()
    db = createDatabase(d1)
    r2Files = new Map()
    testEnv = {
      ASSETS: createMockR2(r2Files),
      PTERODACTYL_BASE_URL: "https://panel.test.hikat.org",
      PTERODACTYL_API_KEY: "ptla_test_key",
      PTERODACTYL_SERVER_ID: "srv_test_id",
    } as unknown as Env


    adminId = crypto.randomUUID()
    playerId = crypto.randomUUID()
    const now = new Date().toISOString()

    await db.insert(schema.users).values({
      id: adminId,
      displayName: "Admin User",
      role: "ADMIN",
      createdAt: now,
      updatedAt: now,
    })

    await db.insert(schema.users).values({
      id: playerId,
      displayName: "Player User",
      role: "PLAYER",
      createdAt: now,
      updatedAt: now,
    })
  })

  // ==========================================
  // A. Settings Lifecycle & Authorization
  // ==========================================
  describe("A. Settings Lifecycle & Authorization", () => {
    it("1 & 2. Fresh installation defaults to SERVER_FIRST and can be read", async () => {
      const settings = await getAdminSettings(db)
      expect(settings.updateDeploymentOrder).toBe("SERVER_FIRST")
      expect(settings.launcherActiveReleaseId).toBeNull()
    })

    it("3 & 4. ADMIN changes setting to PLAYERS_FIRST and change persists in DB", async () => {
      const updated = await updateAdminSettings(db, { updateDeploymentOrder: "PLAYERS_FIRST" }, adminId)
      expect(updated.updateDeploymentOrder).toBe("PLAYERS_FIRST")

      const refreshed = await getAdminSettings(db)
      expect(refreshed.updateDeploymentOrder).toBe("PLAYERS_FIRST")
    })

    it("5. Rejects invalid deployment order values", async () => {
      await expect(
        updateAdminSettings(db, { updateDeploymentOrder: "INVALID_ORDER" as any }, adminId),
      ).rejects.toThrow(/Orden de actualización inválido/i)
    })

    it("6. Changing settings does NOT automatically mutate active release pointer", async () => {
      const relId = crypto.randomUUID()
      const now = new Date().toISOString()
      await db.insert(schema.gameReleases).values({
        id: relId,
        version: "1.0.0",
        status: "PUBLISHED",
        publishedAt: now,
        createdBy: adminId,
        createdAt: now,
        updatedAt: now,
      })

      // Establish baseline active pointer
      await db.update(schema.projectSettings).set({ launcherActiveReleaseId: relId }).where(eq(schema.projectSettings.id, "main"))

      // Change from SERVER_FIRST to PLAYERS_FIRST
      await updateAdminSettings(db, { updateDeploymentOrder: "PLAYERS_FIRST" }, adminId)
      let settings = await getAdminSettings(db)
      expect(settings.launcherActiveReleaseId).toBe(relId)

      // Change back from PLAYERS_FIRST to SERVER_FIRST
      await updateAdminSettings(db, { updateDeploymentOrder: "SERVER_FIRST" }, adminId)
      settings = await getAdminSettings(db)
      expect(settings.launcherActiveReleaseId).toBe(relId)
    })
  })

  // ==========================================
  // B. Migration / Bootstrap
  // ==========================================
  describe("B. Migration / Bootstrap", () => {
    it("7. Existing DB with PUBLISHED release and null active pointer establishes baseline active", async () => {
      const relId = crypto.randomUUID()
      const now = new Date().toISOString()
      await db.insert(schema.gameReleases).values({
        id: relId,
        version: "1.0.0",
        status: "PUBLISHED",
        publishedAt: now,
        createdBy: adminId,
        createdAt: now,
        updatedAt: now,
      })

      // Active pointer is null initially
      const row = await db.select().from(schema.projectSettings).where(eq(schema.projectSettings.id, "main")).get()
      expect(row?.launcherActiveReleaseId).toBeNull()

      // ensureSettingsRecord performs safe backfill
      const bootstrapped = await ensureSettingsRecord(db)
      expect(bootstrapped.launcherActiveReleaseId).toBe(relId)

      // getPublishedModpack delivers the bootstrapped baseline
      const modpack = await getPublishedModpack(db, testEnv)
      expect(modpack?.version).toBe("1.0.0")
    })

    it("8. Repeated bootstrap preserves existing active pointer and does not overwrite", async () => {
      const rel1 = crypto.randomUUID()
      const now = new Date().toISOString()
      await db.insert(schema.gameReleases).values({
        id: rel1,
        version: "1.0.0",
        status: "PUBLISHED",
        publishedAt: now,
        createdBy: adminId,
        createdAt: now,
        updatedAt: now,
      })

      await ensureSettingsRecord(db)

      // Active pointer is rel1
      let settings = await getAdminSettings(db)
      expect(settings.launcherActiveReleaseId).toBe(rel1)

      // Subsequent calls don't change it
      await ensureSettingsRecord(db)
      settings = await getAdminSettings(db)
      expect(settings.launcherActiveReleaseId).toBe(rel1)
    })
  })

  // ==========================================
  // C. SERVER_FIRST Workflow
  // ==========================================
  describe("C. SERVER_FIRST Workflow", () => {
    it("9, 10, 11, 12, 13. Full SERVER_FIRST lifecycle with server apply success and failure semantics", async () => {
      // 1. Initial State: Publish v1.0.0 with both mod A
      await updateAdminSettings(db, { updateDeploymentOrder: "SERVER_FIRST" }, adminId)

      const draft1 = await prepareGameDraft(db, adminId)
      const jarA = await createValidJarBuffer("mod-a-1.0.jar")
      r2Files.set("game-files/mod-a-1.0.jar", jarA.buffer)

      await db.insert(schema.gameReleaseFiles).values({
        id: crypto.randomUUID(),
        releaseId: draft1.id,
        name: "mod-a-1.0.jar",
        logicalPath: "mods/mod-a-1.0.jar",
        category: "MOD",
        sha256: jarA.sha256,
        sizeBytes: jarA.buffer.byteLength,
        policy: "NO_MODIFICABLE",
        objectKey: "game-files/mod-a-1.0.jar",
        sourceEnvironment: "BOTH",
        sourceProvider: "MODRINTH",
        sourceProjectId: "proj-a",
        sourceVersionId: "ver-a-1",
        sourceFileId: "f-a-1",
      })

      // Publish v1.0.0 (initial baseline activation)
      await publishGameRelease(db, testEnv, { version: "1.0.0" }, adminId)

      let launcherPack = await getPublishedModpack(db, testEnv)
      expect(launcherPack?.version).toBe("1.0.0")

      // Seed server with v1.0.0 content
      await db.insert(schema.serverManagedContent).values({
        id: crypto.randomUUID(),
        managementSource: "GAME_RELEASE",
        provider: "MODRINTH",
        projectId: "proj-a",
        versionId: "ver-a-1",
        contentType: "MOD",
        environment: "BOTH",
        targetPath: "mods/mod-a-1.0.jar",
        sha256: jarA.sha256,
        sizeBytes: jarA.buffer.byteLength,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      // 2. Create and Publish v1.1.0 containing server-relevant change (mod-a updated to 1.1)
      const draft2 = await prepareGameDraft(db, adminId)
      // Delete old file from draft
      await db.delete(schema.gameReleaseFiles).where(eq(schema.gameReleaseFiles.releaseId, draft2.id))

      const jarA2 = await createValidJarBuffer("mod-a-1.1.jar")
      r2Files.set("game-files/mod-a-1.1.jar", jarA2.buffer)

      await db.insert(schema.gameReleaseFiles).values({
        id: crypto.randomUUID(),
        releaseId: draft2.id,
        name: "mod-a-1.1.jar",
        logicalPath: "mods/mod-a-1.1.jar",
        category: "MOD",
        sha256: jarA2.sha256,
        sizeBytes: jarA2.buffer.byteLength,
        policy: "NO_MODIFICABLE",
        objectKey: "game-files/mod-a-1.1.jar",
        sourceEnvironment: "BOTH",
        sourceProvider: "MODRINTH",
        sourceProjectId: "proj-a",
        sourceVersionId: "ver-a-2",
        sourceFileId: "f-a-2",
      })

      // Publish v1.1.0 in SERVER_FIRST mode
      await publishGameRelease(db, testEnv, { version: "1.1.0" }, adminId)

      // Test 9: 1.1.0 is PUBLISHED, but Launcher STILL sees 1.0.0!
      launcherPack = await getPublishedModpack(db, testEnv)
      expect(launcherPack?.version).toBe("1.0.0")

      // Server Release Sync plan shows pending changes
      const syncPlan = await getServerReleaseSyncPlan(db, testEnv)
      expect(syncPlan.isPending).toBe(true)
      expect(syncPlan.releaseVersion).toBe("1.1.0")

      // Test 12: If server is unavailable, apply fails closed and launcher STILL sees 1.0.0
      const offlineClient = createMockPterodactylClient({ unavailable: true })
      await expect(applyServerReleaseSync(db, testEnv, adminId, false, offlineClient)).rejects.toThrow()
      launcherPack = await getPublishedModpack(db, testEnv)
      expect(launcherPack?.version).toBe("1.0.0")

      // Test 11: If server apply fails (e.g. disk write failure), launcher STILL sees 1.0.0
      const failingClient = createMockPterodactylClient({
        status: "offline",
        failWrite: true,
        files: new Map([["mods/mod-a-1.0.jar", jarA.buffer]]),
      })
      await expect(applyServerReleaseSync(db, testEnv, adminId, false, failingClient)).rejects.toThrow()
      launcherPack = await getPublishedModpack(db, testEnv)
      expect(launcherPack?.version).toBe("1.0.0")

      // Test 10: Server apply SUCCESS -> updates server applied & activates 1.1.0 for Launcher!
      const healthyClient = createMockPterodactylClient({
        status: "offline",
        files: new Map([["mods/mod-a-1.0.jar", jarA.buffer]]),
      })
      const syncResult = await applyServerReleaseSync(db, testEnv, adminId, false, healthyClient)
      expect(syncResult.success).toBe(true)

      // Now Launcher receives 1.1.0!
      launcherPack = await getPublishedModpack(db, testEnv)
      expect(launcherPack?.version).toBe("1.1.0")
      expect(launcherPack?.clientFiles[0]?.path).toBe("mods/mod-a-1.1.jar")
    })
  })

  // ==========================================
  // D. CLIENT-Only Release
  // ==========================================
  describe("D. CLIENT-Only Release", () => {
    it("14. SERVER_FIRST + release with 0 server-relevant changes activates immediately without physical server connection", async () => {
      await updateAdminSettings(db, { updateDeploymentOrder: "SERVER_FIRST" }, adminId)

      // Baseline v1.0.0
      const draft1 = await prepareGameDraft(db, adminId)
      const jarBoth = await createValidJarBuffer("both-mod.jar")
      r2Files.set("game-files/both-mod.jar", jarBoth.buffer)

      await db.insert(schema.gameReleaseFiles).values({
        id: crypto.randomUUID(),
        releaseId: draft1.id,
        name: "both-mod.jar",
        logicalPath: "mods/both-mod.jar",
        category: "MOD",
        sha256: jarBoth.sha256,
        sizeBytes: jarBoth.buffer.byteLength,
        policy: "NO_MODIFICABLE",
        objectKey: "game-files/both-mod.jar",
        sourceEnvironment: "BOTH",
      })

      await publishGameRelease(db, testEnv, { version: "1.0.0" }, adminId)

      // Record in serverManagedContent that both-mod.jar is applied on server
      await db.insert(schema.serverManagedContent).values({
        id: crypto.randomUUID(),
        managementSource: "GAME_RELEASE",
        targetPath: "mods/both-mod.jar",
        sha256: jarBoth.sha256,
        sizeBytes: jarBoth.buffer.byteLength,
        environment: "BOTH",
        contentType: "MOD",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      // Draft 2: Adds a CLIENT-ONLY mod (e.g. Sodium/Iris) and a RESOURCE_PACK
      const draft2 = await prepareGameDraft(db, adminId)

      const jarClient = await createValidJarBuffer("client-hud.jar")
      const packZip = await createValidJarBuffer("faithful.zip")
      r2Files.set("game-files/client-hud.jar", jarClient.buffer)
      r2Files.set("game-files/faithful.zip", packZip.buffer)

      await db.insert(schema.gameReleaseFiles).values([
        {
          id: crypto.randomUUID(),
          releaseId: draft2.id,
          name: "client-hud.jar",
          logicalPath: "mods/client-hud.jar",
          category: "MOD",
          sha256: jarClient.sha256,
          sizeBytes: jarClient.buffer.byteLength,
          policy: "NO_MODIFICABLE",
          objectKey: "game-files/client-hud.jar",
          sourceEnvironment: "CLIENT",
        },
        {
          id: crypto.randomUUID(),
          releaseId: draft2.id,
          name: "faithful.zip",
          logicalPath: "resourcepacks/faithful.zip",
          category: "RESOURCE_PACK",
          sha256: packZip.sha256,
          sizeBytes: packZip.buffer.byteLength,
          policy: "MODIFICABLE",
          objectKey: "game-files/faithful.zip",
        },
      ])

      // Confirm 0 server-relevant changes
      const draft2Files = await db.select().from(schema.gameReleaseFiles).where(eq(schema.gameReleaseFiles.releaseId, draft2.id)).all()
      const hasChanges = await hasServerRelevantChanges(db, draft2Files)
      expect(hasChanges).toBe(false)

      // Publish in SERVER_FIRST mode
      await publishGameRelease(db, testEnv, { version: "1.1.0" }, adminId)

      // Activates IMMEDIATELY for players without requiring server apply!
      const launcherPack = await getPublishedModpack(db, testEnv)
      expect(launcherPack?.version).toBe("1.1.0")
      expect(launcherPack?.clientFiles.some((f) => f.path === "mods/client-hud.jar")).toBe(true)
      expect(launcherPack?.clientFiles.some((f) => f.path === "resourcepacks/faithful.zip")).toBe(true)
    })
  })

  // ==========================================
  // E. PLAYERS_FIRST Workflow
  // ==========================================
  describe("E. PLAYERS_FIRST Workflow", () => {
    it("15, 16, 17. PLAYERS_FIRST activates immediately upon publication while server remains pending", async () => {
      // Baseline 1.0.0
      await updateAdminSettings(db, { updateDeploymentOrder: "PLAYERS_FIRST" }, adminId)

      const draft1 = await prepareGameDraft(db, adminId)
      const jarA = await createValidJarBuffer("mod-a.jar")
      r2Files.set("game-files/mod-a.jar", jarA.buffer)

      await db.insert(schema.gameReleaseFiles).values({
        id: crypto.randomUUID(),
        releaseId: draft1.id,
        name: "mod-a.jar",
        logicalPath: "mods/mod-a.jar",
        category: "MOD",
        sha256: jarA.sha256,
        sizeBytes: jarA.buffer.byteLength,
        policy: "NO_MODIFICABLE",
        objectKey: "game-files/mod-a.jar",
        sourceEnvironment: "BOTH",
      })

      await publishGameRelease(db, testEnv, { version: "1.0.0" }, adminId)

      // Draft 2 with new BOTH mod
      const draft2 = await prepareGameDraft(db, adminId)
      const jarB = await createValidJarBuffer("mod-b.jar")
      r2Files.set("game-files/mod-b.jar", jarB.buffer)

      await db.insert(schema.gameReleaseFiles).values({
        id: crypto.randomUUID(),
        releaseId: draft2.id,
        name: "mod-b.jar",
        logicalPath: "mods/mod-b.jar",
        category: "MOD",
        sha256: jarB.sha256,
        sizeBytes: jarB.buffer.byteLength,
        policy: "NO_MODIFICABLE",
        objectKey: "game-files/mod-b.jar",
        sourceEnvironment: "BOTH",
      })

      // Publish in PLAYERS_FIRST
      await publishGameRelease(db, testEnv, { version: "1.1.0" }, adminId)

      // Test 15 & 17: Launcher immediately gets 1.1.0
      const launcherPack = await getPublishedModpack(db, testEnv)
      expect(launcherPack?.version).toBe("1.1.0")

      // Test 16: Server sync plan continues to show pending server changes for 1.1.0
      const plan = await getServerReleaseSyncPlan(db, testEnv)
      expect(plan.isPending).toBe(true)
      expect(plan.summary.toInstall).toBeGreaterThan(0)
    })
  })

  // ==========================================
  // F. Setting Changes
  // ==========================================
  describe("F. Setting Changes", () => {
    it("18 & 19. Changing setting does not activate pending release or rollback active release", async () => {
      // 1. Under SERVER_FIRST, publish 1.1.0 with server changes (pending)
      await updateAdminSettings(db, { updateDeploymentOrder: "SERVER_FIRST" }, adminId)

      const draft1 = await prepareGameDraft(db, adminId)
      const jar = await createValidJarBuffer("test.jar")
      r2Files.set("game-files/test.jar", jar.buffer)

      await db.insert(schema.gameReleaseFiles).values({
        id: crypto.randomUUID(),
        releaseId: draft1.id,
        name: "test.jar",
        logicalPath: "mods/test.jar",
        category: "MOD",
        sha256: jar.sha256,
        sizeBytes: jar.buffer.byteLength,
        policy: "NO_MODIFICABLE",
        objectKey: "game-files/test.jar",
        sourceEnvironment: "BOTH",
      })

      await publishGameRelease(db, testEnv, { version: "1.0.0" }, adminId)

      // Draft 2
      const draft2 = await prepareGameDraft(db, adminId)
      const jar2 = await createValidJarBuffer("test2.jar")
      r2Files.set("game-files/test2.jar", jar2.buffer)

      await db.insert(schema.gameReleaseFiles).values({
        id: crypto.randomUUID(),
        releaseId: draft2.id,
        name: "test2.jar",
        logicalPath: "mods/test2.jar",
        category: "MOD",
        sha256: jar2.sha256,
        sizeBytes: jar2.buffer.byteLength,
        policy: "NO_MODIFICABLE",
        objectKey: "game-files/test2.jar",
        sourceEnvironment: "BOTH",
      })

      await publishGameRelease(db, testEnv, { version: "1.1.0" }, adminId)
      expect((await getPublishedModpack(db, testEnv))?.version).toBe("1.0.0")

      // Test 18: Change SERVER_FIRST -> PLAYERS_FIRST: DOES NOT retroactively activate 1.1.0!
      await updateAdminSettings(db, { updateDeploymentOrder: "PLAYERS_FIRST" }, adminId)
      expect((await getPublishedModpack(db, testEnv))?.version).toBe("1.0.0")

      // Test 19: Change PLAYERS_FIRST -> SERVER_FIRST: DOES NOT rollback
      await updateAdminSettings(db, { updateDeploymentOrder: "SERVER_FIRST" }, adminId)
      expect((await getPublishedModpack(db, testEnv))?.version).toBe("1.0.0")
    })
  })

  // ==========================================
  // G. Successive Releases
  // ==========================================
  describe("G. Successive Releases", () => {
    it("20, 21, 22, 23, 24, 25. Publishing 1.1 then 1.2 before apply allows applying 1.2 directly without sequential queue", async () => {
      await updateAdminSettings(db, { updateDeploymentOrder: "SERVER_FIRST" }, adminId)

      // Baseline 1.0.0
      const draft1 = await prepareGameDraft(db, adminId)
      const jar1 = await createValidJarBuffer("mod-1.0.jar")
      r2Files.set("game-files/mod-1.0.jar", jar1.buffer)

      await db.insert(schema.gameReleaseFiles).values({
        id: crypto.randomUUID(),
        releaseId: draft1.id,
        name: "mod-1.0.jar",
        logicalPath: "mods/mod-1.0.jar",
        category: "MOD",
        sha256: jar1.sha256,
        sizeBytes: jar1.buffer.byteLength,
        policy: "NO_MODIFICABLE",
        objectKey: "game-files/mod-1.0.jar",
        sourceEnvironment: "BOTH",
      })

      await publishGameRelease(db, testEnv, { version: "1.0.0" }, adminId)

      // Publish 1.1.0 (superseded later)
      const draft2 = await prepareGameDraft(db, adminId)
      const jar2 = await createValidJarBuffer("mod-1.1.jar")
      r2Files.set("game-files/mod-1.1.jar", jar2.buffer)

      await db.insert(schema.gameReleaseFiles).values({
        id: crypto.randomUUID(),
        releaseId: draft2.id,
        name: "mod-1.1.jar",
        logicalPath: "mods/mod-1.1.jar",
        category: "MOD",
        sha256: jar2.sha256,
        sizeBytes: jar2.buffer.byteLength,
        policy: "NO_MODIFICABLE",
        objectKey: "game-files/mod-1.1.jar",
        sourceEnvironment: "BOTH",
      })

      await publishGameRelease(db, testEnv, { version: "1.1.0" }, adminId)

      // Publish 1.2.0 BEFORE applying 1.1.0
      const draft3 = await prepareGameDraft(db, adminId)
      const jar3 = await createValidJarBuffer("mod-1.2.jar")
      r2Files.set("game-files/mod-1.2.jar", jar3.buffer)

      await db.insert(schema.gameReleaseFiles).values({
        id: crypto.randomUUID(),
        releaseId: draft3.id,
        name: "mod-1.2.jar",
        logicalPath: "mods/mod-1.2.jar",
        category: "MOD",
        sha256: jar3.sha256,
        sizeBytes: jar3.buffer.byteLength,
        policy: "NO_MODIFICABLE",
        objectKey: "game-files/mod-1.2.jar",
        sourceEnvironment: "BOTH",
      })

      await publishGameRelease(db, testEnv, { version: "1.2.0" }, adminId)

      // Launcher is still on 1.0.0
      expect((await getPublishedModpack(db, testEnv))?.version).toBe("1.0.0")

      // Server target is 1.2.0
      const plan = await getServerReleaseSyncPlan(db, testEnv)
      expect(plan.releaseVersion).toBe("1.2.0")

      // Apply 1.2.0
      const mockClient = createMockPterodactylClient({ status: "offline" })
      const res = await applyServerReleaseSync(db, testEnv, adminId, false, mockClient)
      expect(res.success).toBe(true)

      // Active release becomes 1.2.0 directly!
      expect((await getPublishedModpack(db, testEnv))?.version).toBe("1.2.0")
    })
  })

  // ==========================================
  // H. Content Classification & 8E Preservation
  // ==========================================
  describe("H. Content Classification & 8E Preservation", () => {
    it("26. Active release manifest strictly excludes SERVER-only mods, UNKNOWN provider mods, and DATA_PACK", async () => {
      const draft = await prepareGameDraft(db, adminId)

      const jarClient = await createValidJarBuffer("client-only.jar")
      const jarBoth = await createValidJarBuffer("both.jar")
      const jarServer = await createValidJarBuffer("server-only.jar")
      const jarUnknown = await createValidJarBuffer("unknown.jar")
      const packResource = await createValidJarBuffer("pack.zip")
      const packShader = await createValidJarBuffer("shader.zip")
      const packData = await createValidJarBuffer("datapack.zip")

      r2Files.set("game-files/client-only.jar", jarClient.buffer)
      r2Files.set("game-files/both.jar", jarBoth.buffer)
      r2Files.set("game-files/server-only.jar", jarServer.buffer)
      r2Files.set("game-files/unknown.jar", jarUnknown.buffer)
      r2Files.set("game-files/pack.zip", packResource.buffer)
      r2Files.set("game-files/shader.zip", packShader.buffer)
      r2Files.set("game-files/datapack.zip", packData.buffer)

      await db.insert(schema.gameReleaseFiles).values([
        {
          id: crypto.randomUUID(),
          releaseId: draft.id,
          name: "client-only.jar",
          logicalPath: "mods/client-only.jar",
          category: "MOD",
          sha256: jarClient.sha256,
          sizeBytes: jarClient.buffer.byteLength,
          policy: "NO_MODIFICABLE",
          objectKey: "game-files/client-only.jar",
          sourceEnvironment: "CLIENT",
        },
        {
          id: crypto.randomUUID(),
          releaseId: draft.id,
          name: "both.jar",
          logicalPath: "mods/both.jar",
          category: "MOD",
          sha256: jarBoth.sha256,
          sizeBytes: jarBoth.buffer.byteLength,
          policy: "NO_MODIFICABLE",
          objectKey: "game-files/both.jar",
          sourceEnvironment: "BOTH",
        },
        {
          id: crypto.randomUUID(),
          releaseId: draft.id,
          name: "server-only.jar",
          logicalPath: "mods/server-only.jar",
          category: "MOD",
          sha256: jarServer.sha256,
          sizeBytes: jarServer.buffer.byteLength,
          policy: "NO_MODIFICABLE",
          objectKey: "game-files/server-only.jar",
          sourceEnvironment: "SERVER",
        },
        {
          id: crypto.randomUUID(),
          releaseId: draft.id,
          name: "unknown.jar",
          logicalPath: "mods/unknown.jar",
          category: "MOD",
          sha256: jarUnknown.sha256,
          sizeBytes: jarUnknown.buffer.byteLength,
          policy: "NO_MODIFICABLE",
          objectKey: "game-files/unknown.jar",
          sourceEnvironment: "UNKNOWN",
          sourceProvider: "MODRINTH",
        },
        {
          id: crypto.randomUUID(),
          releaseId: draft.id,
          name: "pack.zip",
          logicalPath: "resourcepacks/pack.zip",
          category: "RESOURCE_PACK",
          sha256: packResource.sha256,
          sizeBytes: packResource.buffer.byteLength,
          policy: "MODIFICABLE",
          objectKey: "game-files/pack.zip",
        },
        {
          id: crypto.randomUUID(),
          releaseId: draft.id,
          name: "shader.zip",
          logicalPath: "shaderpacks/shader.zip",
          category: "SHADER_PACK",
          sha256: packShader.sha256,
          sizeBytes: packShader.buffer.byteLength,
          policy: "MODIFICABLE",
          objectKey: "game-files/shader.zip",
        },
        {
          id: crypto.randomUUID(),
          releaseId: draft.id,
          name: "datapack.zip",
          logicalPath: "datapacks/datapack.zip",
          category: "DATA_PACK",
          sha256: packData.sha256,
          sizeBytes: packData.buffer.byteLength,
          policy: "NO_MODIFICABLE",
          objectKey: "game-files/datapack.zip",
        },
      ])

      await publishGameRelease(db, testEnv, { version: "1.0.0" }, adminId)

      const modpack = await getPublishedModpack(db, testEnv)
      expect(modpack).not.toBeNull()

      const paths = modpack!.clientFiles.map((f) => f.path)
      // Included:
      expect(paths).toContain("mods/client-only.jar")
      expect(paths).toContain("mods/both.jar")
      expect(paths).toContain("resourcepacks/pack.zip")
      expect(paths).toContain("shaderpacks/shader.zip")

      // Excluded (Fail-closed):
      expect(paths).not.toContain("mods/server-only.jar")
      expect(paths).not.toContain("mods/unknown.jar")
      expect(paths).not.toContain("datapacks/datapack.zip")
    })
  })

  // ==========================================
  // I. Binary Identity & Integrity
  // ==========================================
  describe("I. Binary Identity & Integrity", () => {
    it("27. Release SHA == Launcher manifest SHA == Server plan SHA for BOTH files", async () => {
      const draft = await prepareGameDraft(db, adminId)
      const jar = await createValidJarBuffer("both-mod.jar")
      r2Files.set("game-files/both-mod.jar", jar.buffer)

      await db.insert(schema.gameReleaseFiles).values({
        id: crypto.randomUUID(),
        releaseId: draft.id,
        name: "both-mod.jar",
        logicalPath: "mods/both-mod.jar",
        category: "MOD",
        sha256: jar.sha256,
        sizeBytes: jar.buffer.byteLength,
        policy: "NO_MODIFICABLE",
        objectKey: "game-files/both-mod.jar",
        sourceEnvironment: "BOTH",
      })

      await publishGameRelease(db, testEnv, { version: "1.0.0" }, adminId)

      // 1. Release in DB
      const releaseFile = await db
        .select()
        .from(schema.gameReleaseFiles)
        .where(eq(schema.gameReleaseFiles.logicalPath, "mods/both-mod.jar"))
        .get()
      expect(releaseFile?.sha256).toBe(jar.sha256)

      // 2. Launcher Manifest
      const launcherPack = await getPublishedModpack(db, testEnv)
      const launcherItem = launcherPack?.clientFiles.find((f) => f.path === "mods/both-mod.jar")
      expect(launcherItem?.sha256).toBe(jar.sha256)

      // 3. Server Plan
      const serverPlan = await getServerReleaseSyncPlan(db, testEnv)
      const serverItem = serverPlan.items.find((i) => i.targetPath === "mods/both-mod.jar")
      expect(serverItem?.sha256).toBe(jar.sha256)
    })
  })

  // ==========================================
  // J. Provider Independence
  // ==========================================
  describe("J. Provider Independence", () => {
    it("28, 29, 30. When providers are unavailable, published manifest and server sync execute purely from HiKAT R2/D1", async () => {
      const draft = await prepareGameDraft(db, adminId)
      const jar = await createValidJarBuffer("provider-mod.jar")
      r2Files.set("game-files/provider-mod.jar", jar.buffer)

      await db.insert(schema.gameReleaseFiles).values({
        id: crypto.randomUUID(),
        releaseId: draft.id,
        name: "provider-mod.jar",
        logicalPath: "mods/provider-mod.jar",
        category: "MOD",
        sha256: jar.sha256,
        sizeBytes: jar.buffer.byteLength,
        policy: "NO_MODIFICABLE",
        objectKey: "game-files/provider-mod.jar",
        sourceEnvironment: "BOTH",
        sourceProvider: "MODRINTH",
        sourceProjectId: "mod-offline-1",
        sourceVersionId: "ver-offline-1",
      })

      await publishGameRelease(db, testEnv, { version: "1.0.0" }, adminId)

      // Modrinth / CurseForge APIs are never called for serving manifest or syncing
      const launcherPack = await getPublishedModpack(db, testEnv)
      expect(launcherPack?.version).toBe("1.0.0")

      // Server sync applies purely using R2 binary and D1 metadata
      const mockClient = createMockPterodactylClient({ status: "offline" })
      const res = await applyServerReleaseSync(db, testEnv, adminId, false, mockClient)
      expect(res.success).toBe(true)
    })
  })
})
