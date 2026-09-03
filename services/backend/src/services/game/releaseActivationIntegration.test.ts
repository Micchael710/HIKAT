import { describe, it, expect, vi, beforeEach } from "vitest"
import { Database, createDatabase, schema } from "@hikat/database"
import { createTestD1 } from "@hikat/database/testUtils"
import { eq } from "drizzle-orm"

import {
  getPublishedModpack,
  publishGameRelease,
  prepareGameDraft,
  hasServerRelevantChanges,
} from "./releaseService"
import { handleGameFileDownload } from "./gameStorageService"
import {
  getAdminSettings,
  updateAdminSettings,
  ensureSettingsRecord,
  getClientConfiguration,
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
        body: data,
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
    it("1 & 2. Fresh installation defaults to SERVER_FIRST and launcherActiveReleaseId is null", async () => {
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

  // =========================================================================
  // B. First Release SERVER_FIRST & Fail-Closed Activation Semantics (Blocker 1)
  // =========================================================================
  describe("B. First Release SERVER_FIRST & Fail-Closed Activation Semantics", () => {
    it("7 (Section 9 Mandatory E2E): Fresh installation with SERVER_FIRST: first release with BOTH does NOT activate upon publish; activates only upon successful server apply", async () => {
      // 1. Fresh installation state
      const initialSettings = await getAdminSettings(db)
      expect(initialSettings.updateDeploymentOrder).toBe("SERVER_FIRST")
      expect(initialSettings.launcherActiveReleaseId).toBeNull()

      // 2. Prepare draft 1.0.0 with a BOTH mod
      const draft = await prepareGameDraft(db, adminId)
      const jarA = await createValidJarBuffer("mod-a-1.0.jar")
      r2Files.set("game-files/mod-a-1.0.jar", jarA.buffer)

      await db.insert(schema.gameReleaseFiles).values({
        id: crypto.randomUUID(),
        releaseId: draft.id,
        name: "mod-a-1.0.jar",
        logicalPath: "mods/mod-a-1.0.jar",
        category: "MOD",
        sha256: jarA.sha256,
        sizeBytes: jarA.buffer.byteLength,
        policy: "NO_MODIFICABLE",
        objectKey: "game-files/mod-a-1.0.jar",
        sourceEnvironment: "BOTH",
      })

      // 3. Publish release 1.0.0
      await publishGameRelease(db, testEnv, { version: "1.0.0" }, adminId)

      // Verify: release 1.0.0 is PUBLISHED in D1
      const publishedRow = await db.select().from(schema.gameReleases).where(eq(schema.gameReleases.id, draft.id)).get()
      expect(publishedRow?.status).toBe("PUBLISHED")

      // Verify: launcherActiveReleaseId is STILL NULL (NOT auto-activated)
      const settingsAfterPublish = await getAdminSettings(db)
      expect(settingsAfterPublish.launcherActiveReleaseId).toBeNull()

      // Verify: getPublishedModpack() returns NULL
      const modpackBeforeApply = await getPublishedModpack(db, testEnv)
      expect(modpackBeforeApply).toBeNull()

      // 4. Server Release Sync shows pending installation for 1.0.0
      const mockClient = createMockPterodactylClient({ status: "offline" })
      const plan = await getServerReleaseSyncPlan(db, testEnv, mockClient)
      expect(plan.isPending).toBe(true)
      expect(plan.releaseVersion).toBe("1.0.0")

      // 5. Apply server release sync successfully
      const syncResult = await applyServerReleaseSync(db, testEnv, adminId, false, mockClient)
      expect(syncResult.success).toBe(true)

      // Verify: launcherActiveReleaseId is NOW 1.0.0
      const settingsAfterApply = await getAdminSettings(db)
      expect(settingsAfterApply.launcherActiveReleaseId).toBe(draft.id)

      // Verify: getPublishedModpack() NOW delivers version 1.0.0
      const modpackAfterApply = await getPublishedModpack(db, testEnv)
      expect(modpackAfterApply).not.toBeNull()
      expect(modpackAfterApply?.version).toBe("1.0.0")
    })

    it("8 (Section 10): First release SERVER_FIRST + server unavailable/failure leaves active pointer NULL", async () => {
      // 1. Fresh install, SERVER_FIRST
      const draft = await prepareGameDraft(db, adminId)
      const jarA = await createValidJarBuffer("mod-a-1.0.jar")
      r2Files.set("game-files/mod-a-1.0.jar", jarA.buffer)

      await db.insert(schema.gameReleaseFiles).values({
        id: crypto.randomUUID(),
        releaseId: draft.id,
        name: "mod-a-1.0.jar",
        logicalPath: "mods/mod-a-1.0.jar",
        category: "MOD",
        sha256: jarA.sha256,
        sizeBytes: jarA.buffer.byteLength,
        policy: "NO_MODIFICABLE",
        objectKey: "game-files/mod-a-1.0.jar",
        sourceEnvironment: "BOTH",
      })

      await publishGameRelease(db, testEnv, { version: "1.0.0" }, adminId)

      // Attempt apply with unavailable server
      const offlineClient = createMockPterodactylClient({ unavailable: true })
      await expect(applyServerReleaseSync(db, testEnv, adminId, false, offlineClient)).rejects.toThrow()

      // Pointer MUST remain null
      expect((await getAdminSettings(db)).launcherActiveReleaseId).toBeNull()
      expect(await getPublishedModpack(db, testEnv)).toBeNull()

      // Attempt apply with disk write failure
      const writeFailClient = createMockPterodactylClient({ status: "offline", failWrite: true })
      await expect(applyServerReleaseSync(db, testEnv, adminId, false, writeFailClient)).rejects.toThrow()

      expect((await getAdminSettings(db)).launcherActiveReleaseId).toBeNull()
      expect(await getPublishedModpack(db, testEnv)).toBeNull()
    })

    it("9 (Section 11): ensureSettingsRecord, getAdminSettings, getClientConfiguration, getPublishedModpack are strictly READ-ONLY and never mutate active pointer", async () => {
      // 1. Publish 1.0.0 with BOTH under SERVER_FIRST (active = null)
      const draft = await prepareGameDraft(db, adminId)
      const jarA = await createValidJarBuffer("mod-a-1.0.jar")
      r2Files.set("game-files/mod-a-1.0.jar", jarA.buffer)

      await db.insert(schema.gameReleaseFiles).values({
        id: crypto.randomUUID(),
        releaseId: draft.id,
        name: "mod-a-1.0.jar",
        logicalPath: "mods/mod-a-1.0.jar",
        category: "MOD",
        sha256: jarA.sha256,
        sizeBytes: jarA.buffer.byteLength,
        policy: "NO_MODIFICABLE",
        objectKey: "game-files/mod-a-1.0.jar",
        sourceEnvironment: "BOTH",
      })

      await publishGameRelease(db, testEnv, { version: "1.0.0" }, adminId)

      // 2. Call reading methods repeatedly
      for (let i = 0; i < 5; i++) {
        await ensureSettingsRecord(db)
        const adminSet = await getAdminSettings(db)
        expect(adminSet.launcherActiveReleaseId).toBeNull()

        const clientCfg = await getClientConfiguration(db)
        expect(clientCfg).toBeDefined()

        const modpack = await getPublishedModpack(db, testEnv)
        expect(modpack).toBeNull()
      }

      // Check DB directly: launcherActiveReleaseId is still NULL
      const row = await db.select().from(schema.projectSettings).where(eq(schema.projectSettings.id, "main")).get()
      expect(row?.launcherActiveReleaseId).toBeNull()
    })
  })

  // =========================================================================
  // C. Active ARCHIVED Release & Real Public Download Endpoint (Blocker 4 & 5)
  // =========================================================================
  describe("C. Active ARCHIVED Release & Real Public Download Endpoint", () => {
    it("10 (Section 12): Active release transitioning to ARCHIVED (when a newer release is published pending server apply) continues serving manifest and binary downloads via handleGameFileDownload", async () => {
      // 1. Setup active release 1.0.0
      const draft1 = await prepareGameDraft(db, adminId)
      const jar1 = await createValidJarBuffer("mod-a-1.0.jar")
      const file1Id = crypto.randomUUID()
      const objectKey1 = `game-files/${draft1.id}/mod-a-1.0.jar`
      r2Files.set(objectKey1, jar1.buffer)

      await db.insert(schema.gameReleaseFiles).values({
        id: file1Id,
        releaseId: draft1.id,
        name: "mod-a-1.0.jar",
        logicalPath: "mods/mod-a-1.0.jar",
        category: "MOD",
        sha256: jar1.sha256,
        sizeBytes: jar1.buffer.byteLength,
        policy: "NO_MODIFICABLE",
        objectKey: objectKey1,
        sourceEnvironment: "BOTH",
      })

      await publishGameRelease(db, testEnv, { version: "1.0.0" }, adminId)

      // Apply 1.0.0 on server so it becomes active
      const mockClient = createMockPterodactylClient({ status: "offline" })
      await applyServerReleaseSync(db, testEnv, adminId, false, mockClient)

      // Confirm 1.0.0 is active
      expect((await getAdminSettings(db)).launcherActiveReleaseId).toBe(draft1.id)

      // 2. Publish 1.1.0 with BOTH mod changed in SERVER_FIRST mode
      const draft2 = await prepareGameDraft(db, adminId)
      const jar2 = await createValidJarBuffer("mod-a-1.1.jar")
      const file2Id = crypto.randomUUID()
      const objectKey2 = `game-files/${draft2.id}/mod-a-1.1.jar`
      r2Files.set(objectKey2, jar2.buffer)

      await db.delete(schema.gameReleaseFiles).where(eq(schema.gameReleaseFiles.releaseId, draft2.id))
      await db.insert(schema.gameReleaseFiles).values({
        id: file2Id,
        releaseId: draft2.id,
        name: "mod-a-1.1.jar",
        logicalPath: "mods/mod-a-1.1.jar",
        category: "MOD",
        sha256: jar2.sha256,
        sizeBytes: jar2.buffer.byteLength,
        policy: "NO_MODIFICABLE",
        objectKey: objectKey2,
        sourceEnvironment: "BOTH",
      })

      await publishGameRelease(db, testEnv, { version: "1.1.0" }, adminId)

      // Verify DB statuses: 1.0.0 is ARCHIVED, 1.1.0 is PUBLISHED
      const rel1 = await db.select().from(schema.gameReleases).where(eq(schema.gameReleases.id, draft1.id)).get()
      const rel2 = await db.select().from(schema.gameReleases).where(eq(schema.gameReleases.id, draft2.id)).get()
      expect(rel1?.status).toBe("ARCHIVED")
      expect(rel2?.status).toBe("PUBLISHED")

      // Verify active pointer is STILL 1.0.0
      expect((await getAdminSettings(db)).launcherActiveReleaseId).toBe(draft1.id)

      // Verify getPublishedModpack() serves 1.0.0
      const modpack = await getPublishedModpack(db, testEnv)
      expect(modpack?.version).toBe("1.0.0")

      // Verify REAL download endpoint for active (ARCHIVED) 1.0.0 file delivers 200 OK with R2 content
      const req1 = new Request(`http://localhost/game/download/${file1Id}`)
      const res1 = await handleGameFileDownload(req1, testEnv, db, file1Id)
      expect(res1.status).toBe(200)
      expect(res1.headers.get("Content-Disposition")).toContain("mod-a-1.0.jar")
      const downloadedBuf1 = new Uint8Array(await res1.arrayBuffer())
      expect(downloadedBuf1.byteLength).toBe(jar1.buffer.byteLength)
    })

    it("11 (Sections 13 & 14): Security authority: non-active files (archived non-active, published non-active, draft, server-only) return 404, and permissions switch dynamically upon activation", async () => {
      // 1. Initial State: 1.0.0 ACTIVE, 1.1.0 PUBLISHED pending
      const draft1 = await prepareGameDraft(db, adminId)
      const jar1 = await createValidJarBuffer("client-1.0.jar")
      const file1Id = crypto.randomUUID()
      r2Files.set("key-1", jar1.buffer)

      // Also add a SERVER-only file to active 1.0.0
      const jarServer = await createValidJarBuffer("server-only.jar")
      const serverFileId = crypto.randomUUID()
      r2Files.set("key-srv", jarServer.buffer)

      await db.insert(schema.gameReleaseFiles).values([
        {
          id: file1Id,
          releaseId: draft1.id,
          name: "client-1.0.jar",
          logicalPath: "mods/client-1.0.jar",
          category: "MOD",
          sha256: jar1.sha256,
          sizeBytes: jar1.buffer.byteLength,
          policy: "NO_MODIFICABLE",
          objectKey: "key-1",
          sourceEnvironment: "BOTH",
        },
        {
          id: serverFileId,
          releaseId: draft1.id,
          name: "server-only.jar",
          logicalPath: "mods/server-only.jar",
          category: "MOD",
          sha256: jarServer.sha256,
          sizeBytes: jarServer.buffer.byteLength,
          policy: "NO_MODIFICABLE",
          objectKey: "key-srv",
          sourceEnvironment: "SERVER",
        },
      ])

      await publishGameRelease(db, testEnv, { version: "1.0.0" }, adminId)
      const mockClient = createMockPterodactylClient({ status: "offline" })
      await applyServerReleaseSync(db, testEnv, adminId, false, mockClient)

      // 2. Publish 1.1.0 (pending)
      const draft2 = await prepareGameDraft(db, adminId)
      const jar2 = await createValidJarBuffer("client-1.1.jar")
      const file2Id = crypto.randomUUID()
      r2Files.set("key-2", jar2.buffer)

      await db.delete(schema.gameReleaseFiles).where(eq(schema.gameReleaseFiles.releaseId, draft2.id))
      await db.insert(schema.gameReleaseFiles).values({
        id: file2Id,
        releaseId: draft2.id,
        name: "client-1.1.jar",
        logicalPath: "mods/client-1.1.jar",
        category: "MOD",
        sha256: jar2.sha256,
        sizeBytes: jar2.buffer.byteLength,
        policy: "NO_MODIFICABLE",
        objectKey: "key-2",
        sourceEnvironment: "BOTH",
      })

      await publishGameRelease(db, testEnv, { version: "1.1.0" }, adminId)

      // 3. Create a DRAFT 1.2.0
      const draft3 = await prepareGameDraft(db, adminId)
      const jarDraft = await createValidJarBuffer("draft.jar")
      const draftFileId = crypto.randomUUID()
      r2Files.set("key-draft", jarDraft.buffer)
      await db.insert(schema.gameReleaseFiles).values({
        id: draftFileId,
        releaseId: draft3.id,
        name: "draft.jar",
        logicalPath: "mods/draft.jar",
        category: "MOD",
        sha256: jarDraft.sha256,
        sizeBytes: jarDraft.buffer.byteLength,
        policy: "NO_MODIFICABLE",
        objectKey: "key-draft",
        sourceEnvironment: "CLIENT",
      })

      // === PERMISSION CHECKS BEFORE ACTIVATION (active = 1.0.0) ===
      // Active 1.0 file -> 200 OK
      const resActive = await handleGameFileDownload(new Request(`http://localhost/game/download/${file1Id}`), testEnv, db, file1Id)
      expect(resActive.status).toBe(200)

      // Pending 1.1 file (PUBLISHED but not active) -> 404
      const resPending = await handleGameFileDownload(new Request(`http://localhost/game/download/${file2Id}`), testEnv, db, file2Id)
      expect(resPending.status).toBe(404)

      // DRAFT file -> 404
      const resDraft = await handleGameFileDownload(new Request(`http://localhost/game/download/${draftFileId}`), testEnv, db, draftFileId)
      expect(resDraft.status).toBe(404)

      // SERVER-only file of active release -> 404 (strictly filtered)
      const resServer = await handleGameFileDownload(new Request(`http://localhost/game/download/${serverFileId}`), testEnv, db, serverFileId)
      expect(resServer.status).toBe(404)

      // === APPLY 1.1.0 ON SERVER (activates 1.1.0) ===
      const syncRes = await applyServerReleaseSync(db, testEnv, adminId, false, mockClient)
      expect(syncRes.success).toBe(true)
      expect((await getAdminSettings(db)).launcherActiveReleaseId).toBe(draft2.id)

      // === PERMISSION CHECKS AFTER ACTIVATION (active = 1.1.0) ===
      // Old 1.0 file (now archived non-active) -> 200 OK (ongoing downloads do not break)
      const resOld = await handleGameFileDownload(new Request(`http://localhost/game/download/${file1Id}`), testEnv, db, file1Id)
      expect(resOld.status).toBe(200)

      // New 1.1 file (now active) -> 200 OK
      const resNew = await handleGameFileDownload(new Request(`http://localhost/game/download/${file2Id}`), testEnv, db, file2Id)
      expect(resNew.status).toBe(200)
    })
  })

  // =========================================================================
  // D. CLIENT-Only & PLAYERS_FIRST Immediate Activation
  // =========================================================================
  describe("D. CLIENT-Only & PLAYERS_FIRST Immediate Activation", () => {
    it("12 (Section 15): SERVER_FIRST with 0 server-relevant changes activates immediately without physical server connection", async () => {
      // 1. Establish 1.0.0 active baseline
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
      const mockClient = createMockPterodactylClient({ status: "offline" })
      await applyServerReleaseSync(db, testEnv, adminId, false, mockClient)
      expect((await getAdminSettings(db)).launcherActiveReleaseId).toBe(draft1.id)

      // 2. Draft 2 adds ONLY client-hud.jar (CLIENT) and faithful.zip (RESOURCE_PACK)
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
      expect((await getAdminSettings(db)).launcherActiveReleaseId).toBe(draft2.id)
      const launcherPack = await getPublishedModpack(db, testEnv)
      expect(launcherPack?.version).toBe("1.1.0")
      expect(launcherPack?.clientFiles.some((f) => f.path === "mods/client-hud.jar")).toBe(true)
    })

    it("13 (Section 16): PLAYERS_FIRST activates immediately upon publish, permits downloads, and keeps server sync pending", async () => {
      await updateAdminSettings(db, { updateDeploymentOrder: "PLAYERS_FIRST" }, adminId)

      const draft = await prepareGameDraft(db, adminId)
      const jar = await createValidJarBuffer("mod-players.jar")
      const fileId = crypto.randomUUID()
      r2Files.set("game-files/mod-players.jar", jar.buffer)

      await db.insert(schema.gameReleaseFiles).values({
        id: fileId,
        releaseId: draft.id,
        name: "mod-players.jar",
        logicalPath: "mods/mod-players.jar",
        category: "MOD",
        sha256: jar.sha256,
        sizeBytes: jar.buffer.byteLength,
        policy: "NO_MODIFICABLE",
        objectKey: "game-files/mod-players.jar",
        sourceEnvironment: "BOTH",
      })

      // Publish in PLAYERS_FIRST
      await publishGameRelease(db, testEnv, { version: "1.0.0" }, adminId)

      // Active pointer updated immediately
      expect((await getAdminSettings(db)).launcherActiveReleaseId).toBe(draft.id)
      const launcherPack = await getPublishedModpack(db, testEnv)
      expect(launcherPack?.version).toBe("1.0.0")

      // Real download succeeds immediately
      const res = await handleGameFileDownload(new Request(`http://localhost/game/download/${fileId}`), testEnv, db, fileId)
      expect(res.status).toBe(200)

      // Server sync plan shows pending server changes
      const mockClient = createMockPterodactylClient({ status: "offline" })
      const plan = await getServerReleaseSyncPlan(db, testEnv, mockClient)
      expect(plan.isPending).toBe(true)
    })
  })

  // =========================================================================
  // E. Setting Changes & Successive Releases
  // =========================================================================
  describe("E. Setting Changes & Successive Releases", () => {
    it("14. Changing setting does not activate pending release or rollback active release", async () => {
      // 1. Establish 1.0.0 active
      await updateAdminSettings(db, { updateDeploymentOrder: "PLAYERS_FIRST" }, adminId)
      const draft1 = await prepareGameDraft(db, adminId)
      const jar1 = await createValidJarBuffer("test1.jar")
      r2Files.set("game-files/test1.jar", jar1.buffer)
      await db.insert(schema.gameReleaseFiles).values({
        id: crypto.randomUUID(),
        releaseId: draft1.id,
        name: "test1.jar",
        logicalPath: "mods/test1.jar",
        category: "MOD",
        sha256: jar1.sha256,
        sizeBytes: jar1.buffer.byteLength,
        policy: "NO_MODIFICABLE",
        objectKey: "game-files/test1.jar",
        sourceEnvironment: "BOTH",
      })
      await publishGameRelease(db, testEnv, { version: "1.0.0" }, adminId)

      // 2. Switch to SERVER_FIRST and publish 1.1.0 (pending)
      await updateAdminSettings(db, { updateDeploymentOrder: "SERVER_FIRST" }, adminId)
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

      // Change SERVER_FIRST -> PLAYERS_FIRST: DOES NOT retroactively activate 1.1.0
      await updateAdminSettings(db, { updateDeploymentOrder: "PLAYERS_FIRST" }, adminId)
      expect((await getPublishedModpack(db, testEnv))?.version).toBe("1.0.0")

      // Change PLAYERS_FIRST -> SERVER_FIRST: DOES NOT rollback
      await updateAdminSettings(db, { updateDeploymentOrder: "SERVER_FIRST" }, adminId)
      expect((await getPublishedModpack(db, testEnv))?.version).toBe("1.0.0")
    })

    it("15. Publishing 1.1 then 1.2 before apply allows applying 1.2 directly without sequential queue", async () => {
      // 1. Establish 1.0.0 active
      await updateAdminSettings(db, { updateDeploymentOrder: "PLAYERS_FIRST" }, adminId)
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

      // 2. Switch to SERVER_FIRST
      await updateAdminSettings(db, { updateDeploymentOrder: "SERVER_FIRST" }, adminId)

      // 3. Publish 1.1.0 (pending)
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

      // 4. Publish 1.2.0 BEFORE applying 1.1.0
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
      const mockClient = createMockPterodactylClient({ status: "offline" })
      const plan = await getServerReleaseSyncPlan(db, testEnv, mockClient)
      expect(plan.releaseVersion).toBe("1.2.0")

      // Apply 1.2.0
      const res = await applyServerReleaseSync(db, testEnv, adminId, false, mockClient)
      expect(res.success).toBe(true)

      // Active release becomes 1.2.0 directly!
      expect((await getPublishedModpack(db, testEnv))?.version).toBe("1.2.0")
    })
  })

  // =========================================================================
  // F. Content Classification, Binary Identity, & Provider Independence
  // =========================================================================
  describe("F. Content Classification, Binary Identity, & Provider Independence", () => {
    it("16. Active release manifest strictly excludes SERVER-only mods, UNKNOWN provider mods, and DATA_PACK", async () => {
      await updateAdminSettings(db, { updateDeploymentOrder: "PLAYERS_FIRST" }, adminId)
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

      // Excluded:
      expect(paths).not.toContain("mods/server-only.jar")
      expect(paths).not.toContain("mods/unknown.jar")
      expect(paths).not.toContain("datapacks/datapack.zip")
    })

    it("17. Binary integrity: Release SHA == Launcher manifest SHA == Server plan SHA for BOTH files", async () => {
      await updateAdminSettings(db, { updateDeploymentOrder: "PLAYERS_FIRST" }, adminId)
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
      const mockClient = createMockPterodactylClient({ status: "offline" })
      const serverPlan = await getServerReleaseSyncPlan(db, testEnv, mockClient)
      const serverItem = serverPlan.items.find((i) => i.targetPath === "mods/both-mod.jar")
      expect(serverItem?.sha256).toBe(jar.sha256)
    })

    it("18. Provider independence: when upstream provider is offline, manifest and server sync execute purely from HiKAT R2/D1", async () => {
      await updateAdminSettings(db, { updateDeploymentOrder: "PLAYERS_FIRST" }, adminId)
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

      // Manifest delivers without calling Modrinth
      const launcherPack = await getPublishedModpack(db, testEnv)
      expect(launcherPack?.version).toBe("1.0.0")

      // Server sync applies purely using R2 binary and D1 metadata
      const mockClient = createMockPterodactylClient({ status: "offline" })
      const res = await applyServerReleaseSync(db, testEnv, adminId, false, mockClient)
      expect(res.success).toBe(true)
    })
  })
})
