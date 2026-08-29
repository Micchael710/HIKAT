import { graphqlClient } from "./apiClient"
import { resolveApiAssetUrl } from "../config/api"
import type { NewsCardItem } from "../types"

export interface NewsResult {
  items: NewsCardItem[]
  isCached?: boolean
  error?: boolean
}

const TYPE_ACCENT_COLORS: Record<string, string> = {
  UPDATE: "#3ec4c0",
  ANNOUNCEMENT: "#e8a840",
  MAINTENANCE: "#ef4444",
  NEWS: "#10b981",
}

interface NewsItemResponse {
  id: string
  title: string
  content: string
  type: string
  image?: {
    url: string
  } | null
  publishedAt?: string | null
  createdAt: string
}

export const newsService = {
  /**
   * Fetch published news articles from Backend GraphQL newsFeed query
   * with automatic offline caching of real seen articles.
   * If offline and no previous articles exist in cache, returns empty list with error flag.
   */
  async getNewsArticles(_lang?: string): Promise<NewsResult> {
    const query = /* GraphQL */ `
      query LauncherNewsFeed($first: Int) {
        newsFeed(first: $first) {
          items {
            id
            title
            content
            type
            image {
              url
            }
            publishedAt
            createdAt
          }
          totalCount
        }
      }
    `

    const res = await graphqlClient<{
      newsFeed: {
        items: NewsItemResponse[]
        totalCount: number
      }
    }>(query, { first: 20 })

    if (res.success && res.data?.newsFeed) {
      const items = res.data.newsFeed.items || []
      const formattedItems: NewsCardItem[] = items.map((item) => {
        const snippet = item.content
          ? item.content.length > 150
            ? `${item.content.slice(0, 150)}...`
            : item.content
          : ""

        return {
          id: item.id,
          img: resolveApiAssetUrl(item.image?.url),
          title: item.title,
          desc: snippet,
          content: item.content || "",
          accentColor: TYPE_ACCENT_COLORS[item.type] || "#e8a840",
          date: item.publishedAt || item.createdAt,
        }
      })

      if (formattedItems.length > 0) {
        try {
          localStorage.setItem("hikat_cached_news", JSON.stringify(formattedItems))
        } catch (_) {}
      }

      return { items: formattedItems, isCached: false }
    }

    // Fallback: Check if the player previously saw news stored in localStorage
    try {
      const cached = localStorage.getItem("hikat_cached_news")
      if (cached) {
        const parsed = JSON.parse(cached)
        if (Array.isArray(parsed) && parsed.length > 0) {
          return { items: parsed, isCached: true }
        }
      }
    } catch (_) {}

    // No fake hardcoded news - return empty state with error flag
    return { items: [], error: true }
  },
}
