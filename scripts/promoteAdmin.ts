/**
 * HiKAT Remote User Admin Promotion Tool
 *
 * Promotes an existing user (registered via PASSWORD, GOOGLE, or DISCORD) to ADMIN
 * strictly in the remote Cloudflare D1 database (hikat-d1).
 *
 * Safety:
 * - Operates ONLY on remote Cloudflare D1 (--remote).
 * - Refuses to create nonexistent users or credentials.
 * - Refuses to mutate passwords, names, skins, or OAuth linkages.
 * - Prevents ambiguous promotion if conflicting user IDs match the same email.
 */

import { execSync } from "node:child_process"
import readline from "node:readline/promises"
import { stdin as input, stdout as output } from "node:process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.resolve(__dirname, "..")

function executeRemoteD1Sql(sql: string, jsonOutput = true): any {
  const jsonFlag = jsonOutput ? "--json" : ""
  // Escape double quotes inside sql for shell execution
  const escapedSql = sql.replace(/"/g, '""')
  const cmd = `pnpm --filter @hikat/backend-service exec wrangler d1 execute hikat-d1 --remote --command "${escapedSql}" ${jsonFlag}`

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
    throw new Error(`D1 Remote Execution error: ${stderr}`)
  }
}

export async function promoteUserToAdmin(targetEmail?: string) {
  let email = (targetEmail || process.env.HIKAT_PROMOTE_EMAIL || process.argv[2] || "").trim().toLowerCase()

  if (!email) {
    const rl = readline.createInterface({ input, output })
    try {
      email = (await rl.question("Correo del usuario a promover a ADMIN: ")).trim().toLowerCase()
    } finally {
      rl.close()
    }
  }

  if (!email || !email.includes("@")) {
    console.error("❌ ERROR: Debes proporcionar un correo electrónico válido.")
    process.exit(1)
  }

  const escapedEmail = email.replace(/'/g, "''")
  console.log(`\n🔍 Buscando cuenta para "${email}" en D1 Remoto (hikat-d1)...`)

  // 1. Check password credentials
  const passwordResult = executeRemoteD1Sql(
    `SELECT user_id, email, 'PASSWORD' as method FROM password_credentials WHERE lower(email) = '${escapedEmail}';`,
  )
  const passwordRows: Array<{ user_id: string; email: string; method: string }> =
    passwordResult?.[0]?.results || []

  // 2. Check external OAuth accounts
  const oauthResult = executeRemoteD1Sql(
    `SELECT user_id, email, provider as method FROM external_accounts WHERE lower(email) = '${escapedEmail}';`,
  )
  const oauthRows: Array<{ user_id: string; email: string; method: string }> =
    oauthResult?.[0]?.results || []

  const allFound = [...passwordRows, ...oauthRows]

  // 3. Validation: If no account exists
  if (allFound.length === 0) {
    console.error(`\n❌ No se encontró ninguna cuenta asociada a "${email}".`)
    console.error("   El usuario debe iniciar sesión o registrarse en HiKAT al menos una vez antes de poder promoverlo.\n")
    process.exit(1)
  }

  // 4. Validation: Check for ambiguous/conflicting user_ids
  const uniqueUserIds = Array.from(new Set(allFound.map((r) => r.user_id)))
  if (uniqueUserIds.length > 1) {
    console.error(`\n❌ ERROR: Inconsistencia detectada. Se encontraron ${uniqueUserIds.length} user_id distintos para el correo "${email}".`)
    console.error("   Operación abortada para evitar promociones ambiguas.\n")
    process.exit(1)
  }

  const userId = uniqueUserIds[0]!
  const matchedMethods = Array.from(new Set(allFound.map((r) => r.method))).join(", ")

  // 5. Query current user record
  const userResult = executeRemoteD1Sql(
    `SELECT id, role, display_name FROM users WHERE id = '${userId}';`,
  )
  const userRows = userResult?.[0]?.results || []
  if (userRows.length === 0) {
    console.error(`\n❌ ERROR: El registro de usuario con ID "${userId}" no existe en la tabla users.\n`)
    process.exit(1)
  }

  const currentUser = userRows[0]
  const currentRole = currentUser.role || "PLAYER"

  if (currentRole === "ADMIN") {
    console.log("\n==================================================")
    console.log("  ℹ️  El usuario ya cuenta con rol ADMIN           ")
    console.log("==================================================")
    console.log(`  Target:      Cloudflare D1 (Remote: hikat-d1)`)
    console.log(`  Email:       ${email}`)
    console.log(`  User ID:     ${userId}`)
    console.log(`  DisplayName: ${currentUser.display_name || "(sin nombre)"}`)
    console.log(`  Auth Method: ${matchedMethods}`)
    console.log(`  Role:        ADMIN`)
    console.log("==================================================\n")
    return
  }

  // 6. Update user role to ADMIN
  const nowIso = new Date().toISOString()
  executeRemoteD1Sql(
    `UPDATE users SET role = 'ADMIN', updated_at = '${nowIso}' WHERE id = '${userId}';`,
    false,
  )

  console.log("\n==================================================")
  console.log("  ✨ Usuario promovido a ADMIN exitosamente       ")
  console.log("==================================================")
  console.log(`  Target:      Cloudflare D1 (Remote: hikat-d1)`)
  console.log(`  Email:       ${email}`)
  console.log(`  User ID:     ${userId}`)
  console.log(`  DisplayName: ${currentUser.display_name || "(sin nombre)"}`)
  console.log(`  Auth Method: ${matchedMethods}`)
  console.log(`  Prev Role:   ${currentRole}`)
  console.log(`  New Role:    ADMIN`)
  console.log(`  Updated At:  ${nowIso}`)
  console.log("==================================================\n")
}

// Run directly if invoked from CLI
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  promoteUserToAdmin().catch((err) => {
    console.error("Error al promover usuario:", err)
    process.exit(1)
  })
}
