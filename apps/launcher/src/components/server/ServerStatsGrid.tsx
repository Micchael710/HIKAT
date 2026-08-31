import React, { useState, useEffect } from "react"
import { ThemeMode, ServerSpecs } from "../../types"
import { useTranslation } from "../../context/LanguageContext"
import { serverService } from "../../services/serverService"

interface ServerStatsGridProps {
  theme?: ThemeMode
  stats?: Partial<ServerSpecs>
  isActive?: boolean
}

export default function ServerStatsGrid({
  theme = "dark",
  stats,
  isActive = true,
}: ServerStatsGridProps) {
  const { t } = useTranslation()
  const isDark = theme === "dark"

  const [serverData, setServerData] = useState<{
    online: boolean
    playersOnline: number
    maxPlayers: number
    latencyMs: number
    playtimeHours: number | null
    unlockedAchievements: number | null
    totalAchievements: number | null
  }>(() => {
    if (stats) {
      return {
        online:
          stats.status === "online" ||
          (stats.playersOnline !== undefined && stats.playersOnline > 0),
        playersOnline: stats.playersOnline ?? 0,
        maxPlayers: stats.maxPlayers ?? 0,
        latencyMs: stats.latencyMs ?? 0,
        playtimeHours: stats.totalPlaytimeHours ?? null,
        unlockedAchievements: stats.unlockedAchievements ?? null,
        totalAchievements: stats.totalAchievements ?? 52,
      }
    }
    try {
      const cached = localStorage.getItem("hikat_cached_server_status")
      if (cached) {
        const parsed = JSON.parse(cached)
        if (parsed && typeof parsed === "object") {
          return {
            online: Boolean(parsed.online),
            playersOnline: parsed.playersOnline ?? 0,
            maxPlayers: parsed.maxPlayers ?? 0,
            latencyMs: parsed.latencyMs ?? 0,
            playtimeHours: null,
            unlockedAchievements: null,
            totalAchievements: 52,
          }
        }
      }
    } catch (_) {}
    return {
      online: false,
      playersOnline: 0,
      maxPlayers: 0,
      latencyMs: 0,
      playtimeHours: null,
      unlockedAchievements: null,
      totalAchievements: 52,
    }
  })

  useEffect(() => {
    if (!isActive || stats) return
    let isMounted = true
    serverService
      .getServerStatus()
      .then((res) => {
        if (!isMounted) return
        if (res && res.online) {
          setServerData((prev) => ({
            ...prev,
            online: true,
            playersOnline: res.playersOnline,
            maxPlayers: res.maxPlayers,
            latencyMs: res.latencyMs,
          }))
        } else {
          setServerData((prev) => ({ ...prev, online: false }))
        }
      })
      .catch(() => {
        if (!isMounted) return
        setServerData((prev) => ({ ...prev, online: false }))
      })
    return () => {
      isMounted = false
    }
  }, [stats, isActive])

  const serverName = stats?.name ?? "Apparatia"
  const isOnline = serverData.online
  const playersOnline = serverData.playersOnline
  const maxPlayers = serverData.maxPlayers
  const latency = serverData.latencyMs
  const playtime = serverData.playtimeHours
  const achievements = serverData.unlockedAchievements
  const totalAchievements = serverData.totalAchievements ?? 52

  return (
    <div style={{ display: "flex", gap: 48 }}>
      {/* Left Category Header */}
      <div style={{ width: 320, flexShrink: 0 }}>
        <div
          style={{
            fontSize: 28,
            fontWeight: 800,
            color: isDark ? "white" : "#111822",
            letterSpacing: "-0.02em",
            marginBottom: 8,
          }}
        >
          {t("serverStats.title")}
        </div>
        <div
          style={{
            fontSize: 17,
            fontWeight: 400,
            color: isDark ? "#8899aa" : "#556677",
            lineHeight: 1.55,
          }}
        >
          {t("serverStats.subtitle")}
        </div>
      </div>

      {/* Right Cards Grid */}
      <div
        style={{
          flex: 1,
          display: "grid",
          gridTemplateColumns: "1.3fr 1fr 1fr",
          gap: 18,
        }}
      >
        {/* Card 1: Apparatia Server Card */}
        <div
          className="settings-card"
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
          }}
        >
          <div>
            <div style={{ marginBottom: 16 }}>
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 800,
                  color: isDark ? "white" : "#111822",
                  marginBottom: 4,
                }}
              >
                {serverName}
              </div>
              <div
                style={{
                  fontSize: 14.5,
                  fontWeight: 600,
                  color: isOnline ? "#22c55e" : isDark ? "#f87171" : "#dc2626",
                }}
              >
                {isOnline
                  ? t("serverStats.serverOnline")
                  : t("serverStats.serverOffline")}
              </div>
            </div>

            {/* Jugadores conectados */}
            <div>
              <div
                style={{
                  fontSize: 13.5,
                  fontWeight: 800,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  color: isDark ? "#657788" : "#778899",
                  marginBottom: isOnline ? 8 : 4,
                }}
              >
                {t("serverStats.onlinePlayers")}
              </div>
              {isOnline ? (
                <>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "flex-end",
                      marginBottom: 8,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 17,
                        fontWeight: 700,
                        color: isDark ? "white" : "#111822",
                      }}
                    >
                      {playersOnline}{" "}
                      <span
                        style={{
                          color: isDark ? "#8899aa" : "#556677",
                          fontWeight: 500,
                        }}
                      >
                        / {maxPlayers}
                      </span>
                    </span>
                  </div>
                  <div
                    style={{
                      height: 7,
                      width: "100%",
                      background: isDark ? "#0d1217" : "#e6ebf0",
                      borderRadius: 4,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        width:
                          maxPlayers > 0
                            ? `${Math.min(100, (playersOnline / maxPlayers) * 100)}%`
                            : "0%",
                        background:
                          "linear-gradient(90deg, #efc436 0%, #f59e0b 100%)",
                        borderRadius: 4,
                      }}
                    />
                  </div>
                </>
              ) : (
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: 8,
                    marginTop: 4,
                  }}
                >
                  <span
                    style={{
                      fontSize: 34,
                      fontWeight: 800,
                      color: isDark ? "#556677" : "#8899aa",
                      letterSpacing: "-0.03em",
                    }}
                  >
                    --
                  </span>
                  <span
                    style={{
                      fontSize: 13.5,
                      fontWeight: 600,
                      color: isDark ? "#657788" : "#8899aa",
                    }}
                  >
                    {t("serverStats.noConnection")}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Bottom Latency */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              color: isDark ? "#8899aa" : "#556677",
              fontSize: 15.5,
              fontWeight: 600,
              paddingTop: 14,
              borderTop: isDark
                ? "1px solid rgba(255, 255, 255, 0.06)"
                : "1px solid rgba(0, 0, 0, 0.06)",
            }}
          >
            <svg
              width={16}
              height={16}
              viewBox="0 0 24 24"
              fill="none"
              stroke={isOnline ? "#efc436" : isDark ? "#556677" : "#99aabb"}
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
            </svg>
            <span>
              {t("serverStats.latency")}{" "}
              <strong
                style={{
                  color: isOnline
                    ? isDark
                      ? "white"
                      : "#111822"
                    : isDark
                      ? "#8899aa"
                      : "#778899",
                }}
              >
                {isOnline ? `${latency} ms` : "-- ms"}
              </strong>
            </span>
          </div>
        </div>

        {/* Card 2: Total Playtime */}
        <div
          className="settings-card"
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
          }}
        >
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 14,
              background: isDark ? "#0d1217" : "#f0f3f7",
              border: isDark
                ? "1.5px solid rgba(255, 255, 255, 0.08)"
                : "1.5px solid rgba(0, 0, 0, 0.08)",
              color:
                playtime !== null ? "#efc436" : isDark ? "#556677" : "#99aabb",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 16,
            }}
          >
            <svg
              width={21}
              height={21}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </div>

          <div>
            <div
              style={{
                fontSize: 13.5,
                fontWeight: 800,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: isDark ? "#657788" : "#778899",
                marginBottom: 4,
              }}
            >
              {t("serverStats.playtimeTitle")}
            </div>
            {playtime !== null && playtime !== undefined ? (
              <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
                <span
                  style={{
                    fontSize: 36,
                    fontWeight: 800,
                    color: isDark ? "white" : "#111822",
                    letterSpacing: "-0.03em",
                  }}
                >
                  {playtime}
                </span>
                <span
                  style={{
                    fontSize: 17,
                    fontWeight: 600,
                    color: isDark ? "#8899aa" : "#556677",
                  }}
                >
                  {t("serverStats.hours")}
                </span>
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span
                  style={{
                    fontSize: 34,
                    fontWeight: 800,
                    color: isDark ? "#556677" : "#8899aa",
                    letterSpacing: "-0.03em",
                  }}
                >
                  --
                </span>
                <span
                  style={{
                    fontSize: 13.5,
                    fontWeight: 600,
                    color: isDark ? "#657788" : "#8899aa",
                  }}
                >
                  {t("serverStats.noConnection")}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Card 3: Achievements */}
        <div
          className="settings-card"
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
          }}
        >
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 14,
              background: isDark ? "#0d1217" : "#f0f3f7",
              border: isDark
                ? "1.5px solid rgba(255, 255, 255, 0.08)"
                : "1.5px solid rgba(0, 0, 0, 0.08)",
              color:
                achievements !== null
                  ? "#efc436"
                  : isDark
                    ? "#556677"
                    : "#99aabb",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 16,
            }}
          >
            <svg
              width={21}
              height={21}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
              <polyline points="17 6 23 6 23 12" />
            </svg>
          </div>

          <div>
            <div
              style={{
                fontSize: 13.5,
                fontWeight: 800,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: isDark ? "#657788" : "#778899",
                marginBottom: 4,
              }}
            >
              {t("serverStats.achievementsTitle")}
            </div>
            {achievements !== null && achievements !== undefined ? (
              <>
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: 7,
                    marginBottom: 12,
                  }}
                >
                  <span
                    style={{
                      fontSize: 36,
                      fontWeight: 800,
                      color: isDark ? "white" : "#111822",
                      letterSpacing: "-0.03em",
                    }}
                  >
                    {achievements}
                  </span>
                  <span
                    style={{
                      fontSize: 17,
                      fontWeight: 600,
                      color: isDark ? "#8899aa" : "#556677",
                    }}
                  >
                    / {totalAchievements}
                  </span>
                </div>
                <div
                  style={{
                    height: 7,
                    width: "100%",
                    background: isDark ? "#0d1217" : "#e6ebf0",
                    borderRadius: 4,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width:
                        totalAchievements > 0
                          ? `${(achievements / totalAchievements) * 100}%`
                          : "0%",
                      background:
                        "linear-gradient(90deg, #efc436 0%, #f59e0b 100%)",
                      borderRadius: 4,
                    }}
                  />
                </div>
              </>
            ) : (
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 8,
                }}
              >
                <span
                  style={{
                    fontSize: 34,
                    fontWeight: 800,
                    color: isDark ? "#556677" : "#8899aa",
                    letterSpacing: "-0.03em",
                  }}
                >
                  --
                </span>
                <span
                  style={{
                    fontSize: 13.5,
                    fontWeight: 600,
                    color: isDark ? "#657788" : "#8899aa",
                  }}
                >
                  {t("serverStats.noConnection")}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
