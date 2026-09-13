import { describe, it, expect, beforeEach, afterEach } from "vitest"
import path from "node:path"
import fs from "node:fs"
import os from "node:os"
import { resolveSafePath } from "./path-validator.cjs"

describe("Path Validator Security & Traversal Tests", () => {
  let tempRoot: string

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hikat-pv-test-"))
  })

  afterEach(() => {
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true })
    } catch {
      // Ignore cleanup error in temp
    }
  })

  it("permits filenames containing '..' as substring (e.g. mods/file..name.jar)", () => {
    const resolved = resolveSafePath(tempRoot, "mods/file..name.jar")
    expect(resolved).toBe(path.resolve(tempRoot, "mods/file..name.jar"))
  })

  it("permits filenames containing '..' as substring (e.g. mods/version..1.jar)", () => {
    const resolved = resolveSafePath(tempRoot, "mods/version..1.jar")
    expect(resolved).toBe(path.resolve(tempRoot, "mods/version..1.jar"))
  })

  it("permits complex mod names with multiple dots (e.g. super_resolution-neoforge-1.21..1.21.1-0.9.1-alpha.2+opengl.jar)", () => {
    const filename = "mods/super_resolution-neoforge-1.21..1.21.1-0.9.1-alpha.2+opengl.jar"
    const resolved = resolveSafePath(tempRoot, filename)
    expect(resolved).toBe(path.resolve(tempRoot, filename))
  })

  it("rejects path traversal starting with ../ (../evil.jar)", () => {
    expect(() => resolveSafePath(tempRoot, "../evil.jar")).toThrow(/path traversal attempt detected/i)
  })

  it("rejects path traversal inside subfolder (mods/../evil.jar)", () => {
    expect(() => resolveSafePath(tempRoot, "mods/../evil.jar")).toThrow(/path traversal attempt detected/i)
  })

  it("rejects multi-level path traversal (mods/sub/../../evil.jar)", () => {
    expect(() => resolveSafePath(tempRoot, "mods/sub/../../evil.jar")).toThrow(/path traversal attempt detected/i)
  })

  it("rejects backslash path traversal (mods\\..\\evil.jar and ..\\evil.jar)", () => {
    expect(() => resolveSafePath(tempRoot, "mods\\..\\evil.jar")).toThrow(/path traversal attempt detected/i)
    expect(() => resolveSafePath(tempRoot, "..\\evil.jar")).toThrow(/path traversal attempt detected/i)
    expect(() => resolveSafePath(tempRoot, "mods\\sub\\..\\..\\evil.jar")).toThrow(/path traversal attempt detected/i)
  })

  it("rejects absolute paths starting with '/' or '\\'", () => {
    expect(() => resolveSafePath(tempRoot, "/evil.jar")).toThrow()
    expect(() => resolveSafePath(tempRoot, "\\evil.jar")).toThrow()
  })

  it("rejects Windows drive absolute paths", () => {
    expect(() => resolveSafePath(tempRoot, "C:/evil.jar")).toThrow(/absolute paths are not permitted/i)
    expect(() => resolveSafePath(tempRoot, "C:\\evil.jar")).toThrow(/absolute paths are not permitted/i)
    expect(() => resolveSafePath(tempRoot, "D:/mods/evil.jar")).toThrow(/absolute paths are not permitted/i)
  })
})
