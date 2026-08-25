import { apiClient } from "./apiClient";

export type GameButtonState =
  "unavailable" | "download" | "update" | "play" | "downloading" | "paused";

export interface GameManifest {
  version: string;
  latestVersion: string;
  totalSizeGB: number;
  hasUpdate: boolean;
  downloadUrl?: string;
  installed: boolean;
}

export interface DownloadProgressPayload {
  progress: number; // 0 to 100
  downloadedGB: number;
  totalGB: number;
  speedMBs: number;
  remainingMinutes: number;
}

export const gameService = {
  /**
   * Check game version, local installation status and available updates from Backend / Manifest.
   * Returns null if server is unreachable and no local installation exists.
   */
  async checkGameManifest(): Promise<GameManifest | null> {
    const res = await apiClient<GameManifest>("/game/manifest");
    if (res.success && res.data) {
      try {
        localStorage.setItem("hikat_game_manifest", JSON.stringify(res.data));
      } catch (_) {}
      return res.data;
    }

    try {
      const cached = localStorage.getItem("hikat_game_manifest");
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && typeof parsed === "object") return parsed;
      }
    } catch (_) {}

    return null;
  },

  /**
   * Check if local client has game files installed
   */
  isGameInstalled(): boolean {
    try {
      return localStorage.getItem("hikat_game_installed") === "true";
    } catch (_) {
      return false;
    }
  },

  setGameInstalled(installed: boolean): void {
    try {
      localStorage.setItem("hikat_game_installed", String(installed));
    } catch (_) {}
  },

  uninstallGame(): void {
    try {
      localStorage.removeItem("hikat_game_installed");
      localStorage.removeItem("hikat_game_manifest");
    } catch (_) {}
    window.electronAPI?.uninstallGame?.();
  },

  repairGame(): void {
    window.electronAPI?.repairGame?.();
  },
};
