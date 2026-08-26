import { eq, sql, desc } from "drizzle-orm"
import { Database, schema } from "@hikat/database"
import type { AdminDashboardSummaryGql, ServerStatusGql } from "@hikat/graphql"
import type { Env } from "../types"
import { getServerStatus } from "./pterodactyl/serverAdministrationService"

export async function getAdminDashboard(
  db: Database,
  env: Env,
): Promise<AdminDashboardSummaryGql> {
  // 1. Resilient Server Status Check (survives Pterodactyl / DNS / network errors)
  let serverStatus: ServerStatusGql = "UNKNOWN"
  try {
    const pterodactylStatus = await getServerStatus(env)
    if (pterodactylStatus?.status) {
      serverStatus = pterodactylStatus.status
    }
  } catch {
    serverStatus = "UNKNOWN"
  }


  // 2. News Aggregation from D1
  const newsRows = await db
    .select({
      status: schema.news.status,
      count: sql<number>`count(*)`,
    })
    .from(schema.news)
    .groupBy(schema.news.status)
    .all()

  let newsPublishedCount = 0
  let newsDraftCount = 0
  for (const row of newsRows) {
    if (row.status === "PUBLISHED") {
      newsPublishedCount = Number(row.count) || 0
    } else if (row.status === "DRAFT") {
      newsDraftCount = Number(row.count) || 0
    }
  }

  // 3. Skins Aggregation from D1
  const skinRows = await db
    .select({
      status: schema.skins.status,
      count: sql<number>`count(*)`,
    })
    .from(schema.skins)
    .groupBy(schema.skins.status)
    .all()

  let skinsTotalCount = 0
  let skinsAvailableCount = 0
  for (const row of skinRows) {
    const c = Number(row.count) || 0
    skinsTotalCount += c
    if (row.status === "AVAILABLE") {
      skinsAvailableCount = c
    }
  }

  // 4. Game Release Aggregation from D1
  const publishedRelease = await db
    .select()
    .from(schema.gameReleases)
    .where(eq(schema.gameReleases.status, "PUBLISHED"))
    .get()

  const draftRelease = await db
    .select()
    .from(schema.gameReleases)
    .where(eq(schema.gameReleases.status, "DRAFT"))
    .get()

  let pendingChangesCount = 0
  if (draftRelease) {
    const draftFilesCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.gameReleaseFiles)
      .where(eq(schema.gameReleaseFiles.releaseId, draftRelease.id))
      .get()
    pendingChangesCount = Number(draftFilesCount?.count) || 0
  }

  return {
    server: {
      status: serverStatus,
    },
    news: {
      publishedCount: newsPublishedCount,
      draftCount: newsDraftCount,
    },
    skins: {
      totalCount: skinsTotalCount,
      availableCount: skinsAvailableCount,
    },
    game: {
      publishedVersion: publishedRelease?.version || null,
      publishedAt: publishedRelease?.publishedAt || null,
      pendingChangesCount,
    },
  }
}
