import React from "react";
import { ThemeMode } from "../../types";
import { useTranslation } from "../../context/LanguageContext";

interface CommunityHubGridProps {
  theme?: ThemeMode;
  discordUrl?: string;
  websiteUrl?: string;
}

export default function CommunityHubGrid({
  theme = "dark",
  discordUrl = import.meta.env.VITE_DISCORD_URL || "https://discord.gg",
  websiteUrl = import.meta.env.VITE_WEBSITE_URL || "#web",
}: CommunityHubGridProps) {
  const { t } = useTranslation();
  const isDark = theme === "dark";

  const handleOpenLink = (
    e: React.MouseEvent<HTMLAnchorElement>,
    url: string,
  ) => {
    if (url.startsWith("#")) {
      e.preventDefault();
      return;
    }
    if (window.electronAPI?.openExternal && url.startsWith("http")) {
      e.preventDefault();
      window.electronAPI.openExternal(url);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 24,
        paddingTop: 48,
        paddingBottom: 24,
        borderTop: isDark
          ? "1px solid rgba(255, 255, 255, 0.08)"
          : "1px solid rgba(0, 0, 0, 0.08)",
      }}
    >
      {/* Top Header */}
      <div>
        <div
          style={{
            fontSize: 28,
            fontWeight: 800,
            color: isDark ? "white" : "#111822",
            letterSpacing: "-0.02em",
            marginBottom: 8,
          }}
        >
          {t("community.title")}
        </div>
        <div
          style={{
            fontSize: 17,
            fontWeight: 400,
            color: isDark ? "#8899aa" : "#556677",
            lineHeight: 1.55,
          }}
        >
          {t("community.subtitle")}
        </div>
      </div>

      {/* Wide Cards Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
        {/* Card 1: Discord Oficial */}
        <div
          className="settings-card community-hub-card"
          style={{
            display: "grid",
            gridTemplateColumns: "1.2fr 0.8fr",
            gap: 28,
            padding: "48px 46px 44px 46px",
            alignItems: "center",
            minHeight: 460,
            cursor: "default",
            ["--card-border-color" as any]: "#5865F2",
            ["--card-glow-color" as any]: "rgba(88, 101, 242, 0.32)",
          }}
        >
          {/* Left Side: Info & CTA */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              height: "100%",
              minHeight: 360,
            }}
          >
            <div>
              {/* Category Pill Tag */}
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 9,
                  marginBottom: 18,
                  background: isDark
                    ? "rgba(88, 101, 242, 0.16)"
                    : "rgba(88, 101, 242, 0.1)",
                  padding: "6px 14px",
                  borderRadius: 10,
                  border: "1.5px solid rgba(88, 101, 242, 0.35)",
                }}
              >
                <svg width={18} height={18} viewBox="0 0 24 24" fill="#5865F2">
                  <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994.021-.041.001-.09-.041-.106a13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.929 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.894.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.078.078 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
                </svg>
                <span
                  style={{
                    fontSize: 13.5,
                    fontWeight: 800,
                    textTransform: "uppercase",
                    letterSpacing: "0.09em",
                    color: "#5865F2",
                  }}
                >
                  {t("community.discordTag")}
                </span>
              </div>

              <div
                style={{
                  fontSize: 30,
                  fontWeight: 800,
                  color: isDark ? "white" : "#111822",
                  marginBottom: 22,
                  letterSpacing: "-0.025em",
                }}
              >
                {t("community.discordTitle")}
              </div>

              {/* 3 Bullet points */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 16,
                  marginBottom: 36,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    fontSize: 16.5,
                    color: isDark ? "#a8bccf" : "#475569",
                    fontWeight: 500,
                  }}
                >
                  <div
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: 8,
                      background: isDark
                        ? "rgba(88, 101, 242, 0.2)"
                        : "rgba(88, 101, 242, 0.12)",
                      color: "#5865F2",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <svg
                      width={15}
                      height={15}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                    </svg>
                  </div>
                  <span>{t("community.discordBullet1")}</span>
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    fontSize: 16.5,
                    color: isDark ? "#a8bccf" : "#475569",
                    fontWeight: 500,
                  }}
                >
                  <div
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: 8,
                      background: isDark
                        ? "rgba(88, 101, 242, 0.2)"
                        : "rgba(88, 101, 242, 0.12)",
                      color: "#5865F2",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <svg
                      width={15}
                      height={15}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                      <line x1="12" y1="19" x2="12" y2="22" />
                    </svg>
                  </div>
                  <span>{t("community.discordBullet2")}</span>
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    fontSize: 16.5,
                    color: isDark ? "#a8bccf" : "#475569",
                    fontWeight: 500,
                  }}
                >
                  <div
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: 8,
                      background: isDark
                        ? "rgba(88, 101, 242, 0.2)"
                        : "rgba(88, 101, 242, 0.12)",
                      color: "#5865F2",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <svg
                      width={15}
                      height={15}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
                    </svg>
                  </div>
                  <span>{t("community.discordBullet3")}</span>
                </div>
              </div>
            </div>

            {/* Bottom Left Button CTA */}
            <a
              href={discordUrl}
              onClick={(e) => handleOpenLink(e, discordUrl)}
              target="_blank"
              rel="noreferrer"
              className="launcher-btn-secondary"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 12,
                padding: "0 32px",
                height: 52,
                borderRadius: 16,
                fontSize: 16,
                fontWeight: 700,
                textDecoration: "none",
                cursor: "pointer",
                width: "fit-content",
              }}
            >
              <span>{t("community.joinDiscord")}</span>
              <svg
                width={16}
                height={16}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </a>
          </div>

          {/* Right Side: Smooth Floating Discord Logo */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              minHeight: 280,
            }}
          >
            <div
              className="floating-smooth-element"
              style={{
                color: "#5865F2",
                filter: "drop-shadow(0 20px 48px rgba(88, 101, 242, 0.45))",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <svg width={165} height={165} viewBox="0 0 24 24" fill="#5865F2">
                <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994.021-.041.001-.09-.041-.106a13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.929 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.894.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.078.078 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
              </svg>
            </div>
          </div>
        </div>

        {/* Card 2: Página Web Oficial */}
        <div
          className="settings-card community-hub-card"
          style={{
            display: "grid",
            gridTemplateColumns: "1.2fr 0.8fr",
            gap: 28,
            padding: "48px 46px 44px 46px",
            alignItems: "center",
            minHeight: 460,
            cursor: "default",
            ["--card-border-color" as any]: "#efc436",
            ["--card-glow-color" as any]: "rgba(239, 196, 54, 0.32)",
          }}
        >
          {/* Left Side: Info & CTA */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              height: "100%",
              minHeight: 360,
            }}
          >
            <div>
              {/* Category Pill Tag */}
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 9,
                  marginBottom: 18,
                  background: isDark
                    ? "rgba(239, 196, 54, 0.16)"
                    : "rgba(239, 196, 54, 0.1)",
                  padding: "6px 14px",
                  borderRadius: 10,
                  border: "1.5px solid rgba(239, 196, 54, 0.35)",
                }}
              >
                <svg
                  width={18}
                  height={18}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#efc436"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="2" y1="12" x2="22" y2="12" />
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                </svg>
                <span
                  style={{
                    fontSize: 13.5,
                    fontWeight: 800,
                    textTransform: "uppercase",
                    letterSpacing: "0.09em",
                    color: "#efc436",
                  }}
                >
                  {t("community.webTag")}
                </span>
              </div>

              <div
                style={{
                  fontSize: 30,
                  fontWeight: 800,
                  color: isDark ? "white" : "#111822",
                  marginBottom: 22,
                  letterSpacing: "-0.025em",
                }}
              >
                {t("community.webTitle")}
              </div>

              {/* 3 Bullet points */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 16,
                  marginBottom: 36,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    fontSize: 16.5,
                    color: isDark ? "#a8bccf" : "#475569",
                    fontWeight: 500,
                  }}
                >
                  <div
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: 8,
                      background: isDark
                        ? "rgba(239, 196, 54, 0.2)"
                        : "rgba(239, 196, 54, 0.12)",
                      color: "#efc436",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <svg
                      width={15}
                      height={15}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                  </div>
                  <span>{t("community.webBullet1")}</span>
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    fontSize: 16.5,
                    color: isDark ? "#a8bccf" : "#475569",
                    fontWeight: 500,
                  }}
                >
                  <div
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: 8,
                      background: isDark
                        ? "rgba(239, 196, 54, 0.2)"
                        : "rgba(239, 196, 54, 0.12)",
                      color: "#efc436",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <svg
                      width={15}
                      height={15}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                    </svg>
                  </div>
                  <span>{t("community.webBullet2")}</span>
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    fontSize: 16.5,
                    color: isDark ? "#a8bccf" : "#475569",
                    fontWeight: 500,
                  }}
                >
                  <div
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: 8,
                      background: isDark
                        ? "rgba(239, 196, 54, 0.2)"
                        : "rgba(239, 196, 54, 0.12)",
                      color: "#efc436",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <svg
                      width={15}
                      height={15}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                      <circle cx="12" cy="7" r="4" />
                    </svg>
                  </div>
                  <span>{t("community.webBullet3")}</span>
                </div>
              </div>
            </div>

            {/* Bottom Left Button CTA */}
            <a
              href={websiteUrl}
              onClick={(e) => handleOpenLink(e, websiteUrl)}
              target="_blank"
              rel="noreferrer"
              className="launcher-btn-secondary"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 12,
                padding: "0 32px",
                height: 52,
                borderRadius: 16,
                fontSize: 16,
                fontWeight: 700,
                textDecoration: "none",
                cursor: "pointer",
                width: "fit-content",
              }}
            >
              <span>{t("community.visitWeb")}</span>
              <svg
                width={16}
                height={16}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </a>
          </div>

          {/* Right Side: Smooth Floating Globe Logo */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              minHeight: 280,
            }}
          >
            <div
              className="floating-smooth-element"
              style={{
                color: "#efc436",
                filter: "drop-shadow(0 20px 48px rgba(239, 196, 54, 0.45))",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <svg
                width={165}
                height={165}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="2" y1="12" x2="22" y2="12" />
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
