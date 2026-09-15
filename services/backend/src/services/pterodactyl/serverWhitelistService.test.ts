import { describe, it, expect, vi, beforeEach } from "vitest"
import { createDatabase, schema } from "@hikat/database"
import { createTestD1 } from "@hikat/database/testUtils"
import {
  isHiKatModInstalled,
  getServerWhitelist,
  setServerWhitelistEnabled,
  addServerWhitelistPlayer,
  removeServerWhitelistPlayer,
  getHikatWhitelistCandidates,
} from "./serverWhitelistService"

function createMockD1() {
  const d1 = createTestD1()
  const db = createDatabase(d1)
  return { db, d1 }
}

describe("Server Whitelist Service Tests", () => {
  let db: any
  let d1: any
  const env: any = {
    PTERODACTYL_BASE_URL: "https://panel.hikat.net",
    PTERODACTYL_API_KEY: "secret-key",
    PTERODACTYL_SERVER_ID: "srv-mc-01",
  }

  beforeEach(async () => {
    const mock = createMockD1()
    db = mock.db
    d1 = mock.d1

    const nowIso = new Date().toISOString()
    await db.insert(schema.users).values([
      {
        id: "usr_vbrayan",
        displayName: "vBrayan06",
        role: "PLAYER",
        createdAt: nowIso,
        updatedAt: nowIso,
      },
      {
        id: "usr_steve",
        displayName: "Steve",
        role: "PLAYER",
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    ])
  })

  it("1. Detects HiKAT mode if a hikat*.jar exists in /mods (case-insensitive), otherwise MINECRAFT_NATIVE", async () => {
    const hikatClient: any = {
      listDirectory: vi.fn().mockResolvedValue({
        object: "list",
        data: [
          { attributes: { name: "fabric-api.jar" } },
          { attributes: { name: "HiKat-1.0.0.jar" } },
        ],
      }),
    }
    const nativeClient: any = {
      listDirectory: vi.fn().mockResolvedValue({
        object: "list",
        data: [{ attributes: { name: "sodium.jar" } }],
      }),
    }
    const failingClient: any = {
      listDirectory: vi.fn().mockRejectedValue(new Error("directory not found")),
    }

    expect(await isHiKatModInstalled(hikatClient)).toBe(true)
    expect(await isHiKatModInstalled(nativeClient)).toBe(false)
    expect(await isHiKatModInstalled(failingClient)).toBe(false)
  })

  it("2. HiKAT ONLINE sends commands for on, off, add, remove", async () => {
    const commandsSent: string[] = []
    const mockClient: any = {
      listDirectory: vi.fn().mockResolvedValue({
        object: "list",
        data: [{ attributes: { name: "hikat-mod.jar" } }],
      }),
      getServerResources: vi.fn().mockResolvedValue({
        attributes: { current_state: "running", resources: {} },
      }),
      getServerDetails: vi.fn().mockResolvedValue({
        attributes: { limits: {} },
      }),
      sendCommand: vi.fn().mockImplementation(async (cmd) => {
        commandsSent.push(cmd)
      }),
      getFileContents: vi.fn().mockResolvedValue(
        JSON.stringify({ enabled: false, entries: [] }),
      ),
    }

    // Toggle on
    await setServerWhitelistEnabled(db, env, true, null, mockClient)
    expect(commandsSent).toContain("hikat whitelist on")

    // Toggle off
    await setServerWhitelistEnabled(db, env, false, null, mockClient)
    expect(commandsSent).toContain("hikat whitelist off")

    // Add player by name
    const addResult = await addServerWhitelistPlayer(db, env, "vbrayan06", null, mockClient)
    expect(commandsSent).toContain('hikat whitelist add "vBrayan06"')
    expect(addResult.entries.some((e) => e.name === "vBrayan06")).toBe(true)

    // Remove player
    await removeServerWhitelistPlayer(db, env, "vBrayan06", null, mockClient)
    expect(commandsSent).toContain('hikat whitelist remove "vBrayan06"')
  })

  it("3. HiKAT OFFLINE reads and modifies /hikat/whitelist.json preserving entries and addedAt", async () => {
    const fileStore: Record<string, string> = {
      "/hikat/whitelist.json": JSON.stringify({
        enabled: false,
        entries: [
          {
            userId: "usr_legacy",
            displayName: "LegacyUser",
            addedAt: "2026-01-01T00:00:00Z",
          },
        ],
      }),
    }

    const mockClient: any = {
      listDirectory: vi.fn().mockResolvedValue({
        object: "list",
        data: [{ attributes: { name: "hikat.jar" } }],
      }),
      getServerResources: vi.fn().mockResolvedValue({
        attributes: { current_state: "offline", resources: {} },
      }),
      getServerDetails: vi.fn().mockResolvedValue({
        attributes: { limits: {} },
      }),
      getFileContents: vi.fn().mockImplementation(async (path) => {
        if (fileStore[path]) return fileStore[path]
        throw new Error("File not found")
      }),
      writeFile: vi.fn().mockImplementation(async (path, content) => {
        fileStore[path] = String(content)
      }),
      createFolder: vi.fn().mockResolvedValue(undefined),
    }

    // Read initial state
    const initial = await getServerWhitelist(db, env, null, mockClient)
    expect(initial.enabled).toBe(false)
    expect(initial.mode).toBe("HIKAT")
    expect(initial.entries.length).toBe(1)
    expect(initial.entries[0]?.name).toBe("LegacyUser")
    expect(initial.entries[0]?.addedAt).toBe("2026-01-01T00:00:00Z")

    // Toggle on
    await setServerWhitelistEnabled(db, env, true, null, mockClient)
    let parsed = JSON.parse(fileStore["/hikat/whitelist.json"]!)
    expect(parsed.enabled).toBe(true)
    expect(parsed.entries.length).toBe(1) // preserved!

    // Add player with case-insensitive search in D1 (input: "VBRAYAN06" -> canonical: "vBrayan06")
    await addServerWhitelistPlayer(db, env, "VBRAYAN06", null, mockClient)
    parsed = JSON.parse(fileStore["/hikat/whitelist.json"]!)
    expect(parsed.entries.length).toBe(2)
    const newEntry = parsed.entries.find((e: any) => e.displayName === "vBrayan06")
    expect(newEntry).toBeDefined()
    expect(newEntry.userId).toBe("usr_vbrayan")

    // Turning OFF never deletes entries
    await setServerWhitelistEnabled(db, env, false, null, mockClient)
    parsed = JSON.parse(fileStore["/hikat/whitelist.json"]!)
    expect(parsed.enabled).toBe(false)
    expect(parsed.entries.length).toBe(2)

    // Remove player case-insensitive
    await removeServerWhitelistPlayer(db, env, "vbrayan06", null, mockClient)
    parsed = JSON.parse(fileStore["/hikat/whitelist.json"]!)
    expect(parsed.entries.length).toBe(1)
    expect(parsed.entries[0].displayName).toBe("LegacyUser")
  })

  it("4. Native Minecraft ONLINE sends vanilla commands", async () => {
    const commandsSent: string[] = []
    const mockClient: any = {
      listDirectory: vi.fn().mockResolvedValue({
        object: "list",
        data: [], // No hikat jar
      }),
      getServerResources: vi.fn().mockResolvedValue({
        attributes: { current_state: "running", resources: {} },
      }),
      getServerDetails: vi.fn().mockResolvedValue({
        attributes: { limits: {} },
      }),
      sendCommand: vi.fn().mockImplementation(async (cmd) => {
        commandsSent.push(cmd)
      }),
      getFileContents: vi.fn().mockImplementation(async (path) => {
        if (path === "server.properties") return "white-list=false\n"
        if (path === "whitelist.json") return "[]"
        throw new Error("File not found")
      }),
    }

    await setServerWhitelistEnabled(db, env, true, null, mockClient)
    expect(commandsSent).toContain("whitelist on")

    await setServerWhitelistEnabled(db, env, false, null, mockClient)
    expect(commandsSent).toContain("whitelist off")

    await addServerWhitelistPlayer(db, env, "Alex", null, mockClient)
    expect(commandsSent).toContain("whitelist add Alex")

    await removeServerWhitelistPlayer(db, env, "Alex", null, mockClient)
    expect(commandsSent).toContain("whitelist remove Alex")
  })

  it("5. Native Minecraft OFFLINE modifies server.properties and whitelist.json", async () => {
    const fileStore: Record<string, string> = {
      "server.properties": "difficulty=hard\nwhite-list=false\nmotd=A Minecraft Server\n",
      "whitelist.json": "[]",
    }

    const mockClient: any = {
      listDirectory: vi.fn().mockResolvedValue({
        object: "list",
        data: [],
      }),
      getServerResources: vi.fn().mockResolvedValue({
        attributes: { current_state: "offline", resources: {} },
      }),
      getServerDetails: vi.fn().mockResolvedValue({
        attributes: { limits: {} },
      }),
      getFileContents: vi.fn().mockImplementation(async (path) => {
        if (fileStore[path] !== undefined) return fileStore[path]
        throw new Error("File not found")
      }),
      writeFile: vi.fn().mockImplementation(async (path, content) => {
        fileStore[path] = String(content)
      }),
    }

    // Toggle on modifies server.properties
    await setServerWhitelistEnabled(db, env, true, null, mockClient)
    expect(fileStore["server.properties"]).toContain("white-list=true")

    // Add player resolves UUID and updates whitelist.json
    await addServerWhitelistPlayer(db, env, "Steve", null, mockClient)
    const whitelistJson = JSON.parse(fileStore["whitelist.json"]!)
    expect(whitelistJson.length).toBe(1)
    expect(whitelistJson[0].name).toBe("Steve")
    expect(whitelistJson[0].uuid).toBeDefined()

    // Turning off preserves whitelist.json players
    await setServerWhitelistEnabled(db, env, false, null, mockClient)
    expect(fileStore["server.properties"]).toContain("white-list=false")
    expect(JSON.parse(fileStore["whitelist.json"]!).length).toBe(1)

    // Remove player
    await removeServerWhitelistPlayer(db, env, "Steve", null, mockClient)
    expect(JSON.parse(fileStore["whitelist.json"]!).length).toBe(0)
  })

  it("6. In HiKAT mode, adding an unknown player throws a friendly error", async () => {
    const mockClient: any = {
      listDirectory: vi.fn().mockResolvedValue({
        object: "list",
        data: [{ attributes: { name: "hikat.jar" } }],
      }),
      getServerResources: vi.fn().mockResolvedValue({
        attributes: { current_state: "offline", resources: {} },
      }),
      getServerDetails: vi.fn().mockResolvedValue({
        attributes: { limits: {} },
      }),
    }

    await expect(
      addServerWhitelistPlayer(db, env, "non_existent_player", null, mockClient),
    ).rejects.toThrow('El jugador "non_existent_player" no existe en HiKAT')
  })

  it("7. getHikatWhitelistCandidates resolves users, skin URLs, and null fallbacks in a single query", async () => {
    const nowIso = new Date().toISOString()
    // Add media records
    await db.insert(schema.contentMedia).values([
      {
        id: "media_custom_1",
        objectKey: "skins/custom1.png",
        mediaType: "IMAGE",
        mimeType: "image/png",
        sizeBytes: 1024,
        createdBy: "usr_vbrayan",
        createdAt: nowIso,
      },
      {
        id: "media_global_1",
        objectKey: "skins/global1.png",
        mediaType: "IMAGE",
        mimeType: "image/png",
        sizeBytes: 2048,
        createdBy: "usr_steve",
        createdAt: nowIso,
      },
    ])

    // User 1 has custom skin and selection = CUSTOM
    await db.insert(schema.playerSkins).values({
      id: "pskin_1",
      userId: "usr_vbrayan",
      mediaId: "media_custom_1",
      createdAt: nowIso,
      updatedAt: nowIso,
    })
    await db.insert(schema.playerSkinSelections).values({
      userId: "usr_vbrayan",
      type: "CUSTOM",
      skinId: null,
      updatedAt: nowIso,
    })

    // User 2 (Steve) has no skin at all -> should be null
    // Add User 3 with an active global skin
    await db.insert(schema.users).values({
      id: "usr_alex",
      displayName: "Alex",
      role: "PLAYER",
      createdAt: nowIso,
      updatedAt: nowIso,
    })
    await db.insert(schema.skins).values({
      id: "skin_global_1",
      name: "Global Knight",
      mediaId: "media_global_1",
      status: "AVAILABLE",
      createdBy: "usr_steve",
      createdAt: nowIso,
      updatedAt: nowIso,
    })
    await db.insert(schema.playerSkinSelections).values({
      userId: "usr_alex",
      type: "GLOBAL",
      skinId: "skin_global_1",
      updatedAt: nowIso,
    })

    const candidates = await getHikatWhitelistCandidates(db)

    // Ordered alphabetically by displayName: Alex, Steve, vBrayan06
    expect(candidates).toHaveLength(3)
    expect(candidates[0]!.displayName).toBe("Alex")
    expect(candidates[0]!.skinImageUrl).toBe("/media/content/media_global_1")

    expect(candidates[1]!.displayName).toBe("Steve")
    expect(candidates[1]!.skinImageUrl).toBeNull()

    expect(candidates[2]!.displayName).toBe("vBrayan06")
    expect(candidates[2]!.skinImageUrl).toBe("/media/content/media_custom_1")
  })
})

