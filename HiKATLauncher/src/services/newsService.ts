import { apiClient } from "./apiClient";
import { NewsCardItem } from "../types";

export interface NewsResult {
  items: NewsCardItem[];
  isCached?: boolean;
  error?: boolean;
}

export const newsService = {
  /**
   * Fetch published news articles from Backoffice API with automatic offline caching of real seen articles.
   * If offline and no previous articles exist in cache, returns empty list with error flag.
   */
  async getNewsArticles(lang?: string): Promise<NewsResult> {
    const endpoint = lang ? `/news?lang=${lang}` : "/news";
    const res = await apiClient<NewsCardItem[]>(endpoint);

    if (res.success && Array.isArray(res.data) && res.data.length > 0) {
      try {
        localStorage.setItem("hikat_cached_news", JSON.stringify(res.data));
      } catch (_) {}
      return { items: res.data, isCached: false };
    }

    // Fallback: Check if the player previously saw news stored in localStorage
    try {
      const cached = localStorage.getItem("hikat_cached_news");
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return { items: parsed, isCached: true };
        }
      }
    } catch (_) {}

    // No fake hardcoded news - return empty state
    return { items: [], error: true };
  },
};
