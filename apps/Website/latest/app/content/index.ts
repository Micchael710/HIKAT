import { previewWebsiteContent } from "./preview-content";
import type { WebsiteContent } from "./types";

export * from "./types";
export * from "./preview-content";

export function getWebsiteContent(): WebsiteContent {
  // In the future this can fetch from backend / SSR loader
  return previewWebsiteContent;
}
