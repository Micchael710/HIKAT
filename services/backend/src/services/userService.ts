/**
 * HiKAT Backend User Service
 * Retrieves user profiles from D1 persistence layer.
 */

import { eq } from "drizzle-orm"
import { Database, users } from "@hikat/database"
import type { UserGql } from "@hikat/graphql"

/**
 * Retrieves a user profile by unique ID from D1 database.
 * Returns only non-sensitive account fields.
 */
export async function getUserById(
  db: Database,
  userId: string,
): Promise<UserGql | null> {
  const [user] = await db
    .select({
      id: users.id,
      role: users.role,
      displayName: users.displayName,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  if (!user) {
    return null
  }

  return {
    id: user.id,
    role: user.role,
    displayName: user.displayName,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  }
}
