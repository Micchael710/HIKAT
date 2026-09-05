/**
 * HiKAT Local Admin Account Provisioner (Local Development ONLY)
 *
 * Provisions or updates an ADMIN user in the shared local D1 database using Wrangler D1 CLI.
 * Uses the exact same PBKDF2-HMAC-SHA512 (100k iterations) hashing as Auth Worker.
 *
 * Safety:
 * - Refuses to execute in production environments.
 * - Never writes plaintext passwords to files or git.
 * - Displays generated temporary credentials ONCE to stdout.
 */

import crypto from "node:crypto"
import { execSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.resolve(__dirname, "..")

// --- Password Hashing (identical to services/auth/src/crypto/password.ts) ---
const DEFAULT_PBKDF2_ITERATIONS = 100000
const SALT_BYTE_LENGTH = 32
const KEY_BYTE_LENGTH = 64

function bufferToBase64Url(buffer: ArrayBuffer | Uint8Array | Buffer): string {
  return Buffer.from(buffer).toString("base64url")
}

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(SALT_BYTE_LENGTH)
  const derivedKey = crypto.pbkdf2Sync(
    password,
    salt,
    DEFAULT_PBKDF2_ITERATIONS,
    KEY_BYTE_LENGTH,
    "sha512",
  )

  const saltB64 = bufferToBase64Url(salt)
  const hashB64 = bufferToBase64Url(derivedKey)

  return `$pbkdf2-sha512$i=${DEFAULT_PBKDF2_ITERATIONS}$${saltB64}$${hashB64}`
}

function generateSecurePassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*"
  const randomBytes = crypto.randomBytes(20)
  let password = ""
  for (let i = 0; i < 20; i++) {
    const byte = randomBytes[i] ?? 0
    password += chars[byte % chars.length]
  }
  return password
}

function executeD1Sql(sql: string, jsonOutput = true): any {
  const jsonFlag = jsonOutput ? "--json" : ""
  // Escape double quotes inside sql for shell execution
  const escapedSql = sql.replace(/"/g, '""')
  const cmd = `pnpm --filter @hikat/backend-service exec wrangler d1 execute hikat-d1 --local --persist-to ../../.wrangler/state --command "${escapedSql}" ${jsonFlag}`

  try {
    const stdout = execSync(cmd, {
      cwd: ROOT_DIR,
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf-8",
    })

    if (!jsonOutput) return stdout

    const match = stdout.match(/\[[\s\S]*\]/)
    if (match) {
      return JSON.parse(match[0])
    }
    return JSON.parse(stdout)
  } catch (err: any) {
    const stderr = err.stderr ? err.stderr.toString() : err.message
    throw new Error(`D1 Execution error: ${stderr}`)
  }
}

export async function createOrUpdateAdmin() {
  if (process.env.ENVIRONMENT === "production" || process.env.NODE_ENV === "production") {
    console.error("❌ ERROR: create-admin is restricted strictly to local development!")
    process.exit(1)
  }

  const email = (process.env.HIKAT_LOCAL_ADMIN_EMAIL || "admin@hikat.local").trim().toLowerCase()
  const password = (process.env.HIKAT_LOCAL_ADMIN_PASSWORD || generateSecurePassword()).trim()
  const nowIso = new Date().toISOString()

  // 1. Check if credential already exists by email
  const selectResult = executeD1Sql(
    `SELECT id, user_id, email FROM password_credentials WHERE email = '${email}';`,
  )
  const rows = selectResult?.[0]?.results || []
  const existingCred = rows[0]

  const passwordHash = await hashPassword(password)
  let userId: string

  if (existingCred) {
    userId = existingCred.user_id
    // Update users table: role ADMIN, updated_at
    executeD1Sql(
      `UPDATE users SET role = 'ADMIN', display_name = 'HiKAT Admin', updated_at = '${nowIso}' WHERE id = '${userId}';`,
      false,
    )
    // Update password_credentials table: new passwordHash, email_verified_at, updated_at
    executeD1Sql(
      `UPDATE password_credentials SET password_hash = '${passwordHash}', email_verified_at = '${nowIso}', updated_at = '${nowIso}' WHERE user_id = '${userId}';`,
      false,
    )
  } else {
    userId = crypto.randomUUID()
    const credId = crypto.randomUUID()

    executeD1Sql(
      `INSERT INTO users (id, role, display_name, created_at, updated_at) VALUES ('${userId}', 'ADMIN', 'HiKAT Admin', '${nowIso}', '${nowIso}');`,
      false,
    )
    executeD1Sql(
      `INSERT INTO password_credentials (id, user_id, email, password_hash, email_verified_at, created_at, updated_at) VALUES ('${credId}', '${userId}', '${email}', '${passwordHash}', '${nowIso}', '${nowIso}', '${nowIso}');`,
      false,
    )
  }

  console.log("\n==================================================")
  console.log("  ✨ HiKAT Local Admin Account Ready (D1 Local)   ")
  console.log("==================================================")
  console.log(`  Persistence: .wrangler/state/v3/d1 (Shared)`)
  console.log(`  Email:       ${email}`)
  console.log(`  Password:    ${password}`)
  console.log(`  Role:        ADMIN`)
  console.log(`  Verified:    Yes`)
  console.log("==================================================\n")
}

// Run directly if invoked from CLI
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  createOrUpdateAdmin().catch((err) => {
    console.error("Failed to provision admin:", err)
    process.exit(1)
  })
}
