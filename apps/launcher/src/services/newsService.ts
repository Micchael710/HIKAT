import { graphqlClient } from "./apiClient"
import { resolveApiAssetUrl } from "../config/api"
import { heroHomeBg } from "../assets"
import type { NewsCardItem } from "../types"

export interface NewsResult {
  items: NewsCardItem[]
  isCached?: boolean
  error?: boolean
}

interface NewsItemResponse {
  id: string
  title: string
  content: string
  type: string
  image?: {
    url: string
    mimeType?: string
    mediaType?: string
  } | null
  youtubeVideoId?: string | null
  youtubeUrl?: string | null
  video?: {
    url: string
    mimeType?: string
    mediaType?: string
  } | null
  publishedAt?: string | null
  createdAt: string
}

/**
 * Resolves the preview image for a news card according to the strict canonical hierarchy:
 * 1. Explicit cover image
 * 2. YouTube official thumbnail (via youtubeVideoId)
 * 3. Uploaded video asset URL
 * 4. Neutral fallback launcher artwork
 */
export function resolveNewsPreview(item: NewsItemResponse): string {
  if (item.image?.url) {
    return resolveApiAssetUrl(item.image.url)
  }
  if (item.youtubeVideoId) {
    return `https://img.youtube.com/vi/${encodeURIComponent(item.youtubeVideoId)}/hqdefault.jpg`
  }
  if (item.video?.url) {
    return resolveApiAssetUrl(item.video.url)
  }
  return heroHomeBg
}

export const newsService = {
  /**
   * Fetch published news articles from Backend GraphQL newsFeed query
   * with multimedia metadata (YouTube, video, cover image) and automatic offline caching.
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
              mimeType
              mediaType
            }
            youtubeVideoId
            youtubeUrl
            video {
              url
              mimeType
              mediaType
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
          img: resolveNewsPreview(item),
          title: item.title,
          desc: snippet,
          content: item.content || "",
          type: item.type,
          accentColor: "#38bdf8",
          date: item.publishedAt || item.createdAt,
          youtubeVideoId: item.youtubeVideoId || null,
          youtubeUrl: item.youtubeUrl || null,
          videoUrl: item.video?.url ? resolveApiAssetUrl(item.video.url) : null,
          videoMimeType: item.video?.mimeType || null,
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
