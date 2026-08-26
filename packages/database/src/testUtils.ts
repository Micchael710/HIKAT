import { DatabaseSync } from "node:sqlite"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

export function createTestD1(): D1Database & { _sqlite: DatabaseSync } {
  const sqlite = new DatabaseSync(":memory:")
  sqlite.exec("PRAGMA foreign_keys = ON;")

  // Apply all migrations in order
  const migrationsDir = join(__dirname, "../migrations")
  const sqlFiles = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort()

  for (const file of sqlFiles) {
    const sqlContent = readFileSync(join(migrationsDir, file), "utf-8")
    const statements = sqlContent.split("--> statement-breakpoint")
    for (const statement of statements) {
      const trimmed = statement.trim()
      if (trimmed) {
        sqlite.exec(trimmed)
      }
    }
  }

  const d1Mock = {
    _sqlite: sqlite,
    prepare(query: string) {
      let boundParams: any[] = []
      return {
        _query: query,
        bind(...params: any[]) {
          boundParams = params.map((p) => {
            if (p === undefined) return null
            if (typeof p === "boolean") return p ? 1 : 0
            return p
          })
          return this
        },
        async first<T = unknown>(colName?: string): Promise<T | null> {
          const stmt = sqlite.prepare(query)
          const row = (stmt.get as any)(...boundParams) as Record<string, unknown> | undefined
          if (!row) return null
          return (colName ? row[colName] : row) as T
        },
        async all<T = unknown>(): Promise<D1Result<T>> {
          const stmt = sqlite.prepare(query)
          const results = (stmt.all as any)(...boundParams) as T[]
          return {
            results,
            success: true,
            meta: {
              served_by: "test-d1",
              duration: 0,
              changes: 0,
              last_row_id: 0,
              changed_db: false,
              size_after: 0,
              rows_read: results.length,
              rows_written: 0,
            },
          }
        },
        async run(): Promise<D1Response> {
          const stmt = sqlite.prepare(query)
          const res = (stmt.run as any)(...boundParams)
          return {
            success: true,
            meta: {
              served_by: "test-d1",
              duration: 0,
              changes: Number(res.changes),
              last_row_id: Number(res.lastInsertRowid),
              changed_db: Number(res.changes) > 0,
              size_after: 0,
              rows_read: 0,
              rows_written: Number(res.changes),
            },
          }
        },
        async raw<T = unknown>(): Promise<T[]> {
          const stmt = sqlite.prepare(query)
          const rows = (stmt.all as any)(...boundParams) as Record<string, unknown>[]
          return rows.map((r) => Object.values(r)) as T[]
        },
      } as unknown as D1PreparedStatement
    },
    async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
      const results: D1Result<T>[] = []
      for (const stmt of statements) {
        results.push(await stmt.all<T>())
      }
      return results
    },
    async exec(query: string): Promise<D1ExecResult> {
      sqlite.exec(query)
      return { count: 0, duration: 0 }
    },
    dump(): Promise<ArrayBuffer> {
      throw new Error("Not implemented in test mock")
    },
  } as unknown as D1Database & { _sqlite: DatabaseSync }

  return d1Mock
}
