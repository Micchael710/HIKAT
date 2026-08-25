export type ThemeMode = "dark" | "light";

export type LauncherScreen = "login" | "home";
export type LauncherView = "home" | "skins" | "settings" | "profile";

export interface UserAccount {
  id: string;
  username: string;
  email?: string;
  avatar?: string;
  lastLogin?: string;
  keepSession?: boolean;
}

export interface UserProfileData {
  username: string;
  rank: string;
  joinedDate: string;
  playtimeHours: number;
  achievementsUnlocked: number;
  achievementsTotal: number;
  serverStatus: "online" | "offline";
  pingMs: number;
}
