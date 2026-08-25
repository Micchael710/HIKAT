import { drizzle, DrizzleD1Database } from "drizzle-orm/d1"
import * as schema from "./schema"

export function createDatabase(
  d1: D1Database,
): DrizzleD1Database<typeof schema> {
  return drizzle(d1, { schema })
}

export type Database = DrizzleD1Database<typeof schema>
