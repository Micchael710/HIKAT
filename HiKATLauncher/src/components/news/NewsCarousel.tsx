import React, { useState, useRef, useEffect } from "react";
import { ThemeMode, NewsCardItem } from "../../types";
import { getThemeTokens, BASE_FONT } from "../../theme/tokens";
import { IconChevronLeft, IconChevronRight } from "../../theme/icons";
import NewsCard from "./NewsCard";
import NewsModal from "./NewsModal";
import { newsService } from "../../services/newsService";
import { useTranslation } from "../../context/LanguageContext";

interface NewsCarouselProps {
  canvasLeft: number;
  canvasWidth?: number;
  theme?: ThemeMode;
  news?: NewsCardItem[];
}

export default function NewsCarousel({
  canvasLeft,
  theme = "dark",
  news,
}: NewsCarouselProps) {
  const { t, language } = useTranslation();
  const isDark = theme === "dark";
  const tokens = getThemeTokens(theme);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const startX = useRef(0);
  const startScroll = useRef(0);
  const hasDragged = useRef(false);
  const [openCard, setOpenCard] = useState<NewsCardItem | null>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(true);

  const [articles, setArticles] = useState<NewsCardItem[]>(() => {
    if (news && news.length > 0) return news;
    // Read from localStorage cache if available
    try {
      const cached = localStorage.getItem("hikat_cached_news");
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (_) {}
    return [];
  });
  const [isLoading, setIsLoading] = useState(false);

  const fetchNews = async () => {
    if (news && news.length > 0) {
      setArticles(news);
      return;
    }
    setIsLoading(true);
    try {
      const res = await newsService.getNewsArticles(language);
      if (res.items && res.items.length > 0) {
        setArticles(res.items);
      } else {
        setArticles([]);
      }
    } catch (_) {
      setArticles([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (news && news.length > 0) {
      setArticles(news);
    } else {
      fetchNews();
    }
  }, [news, language]);

  const CARD_W = 490;
  const CARD_H = 280;
  const GAP = 22;

  const check = () => {
    const el = scrollRef.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 4);
    setCanRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4);
  };

  const scroll = (dir: "l" | "r") => {
    scrollRef.current?.scrollBy({
      left: dir === "r" ? CARD_W + GAP : -(CARD_W + GAP),
      behavior: "smooth",
    });
  };

  const onMouseDown = (e: React.MouseEvent) => {
    isDragging.current = true;
    hasDragged.current = false;
    startX.current = e.pageX;
    startScroll.current = scrollRef.current?.scrollLeft ?? 0;
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!isDragging.current || !scrollRef.current) return;
    const dx = startX.current - e.pageX;
    if (Math.abs(dx) > 6) {
      hasDragged.current = true;
    }
    scrollRef.current.scrollLeft = startScroll.current + dx;
  };

  const stopDrag = () => {
    if (!isDragging.current) return;
    isDragging.current = false;
    setTimeout(() => {
      hasDragged.current = false;
    }, 60);
  };

  const handleCardClick = (card: NewsCardItem) => {
    if (hasDragged.current) return;
    setOpenCard(card);
  };

  return (
    <>
      {/* Outer container covers full canvas width from left sidebar to right edge */}
      <div style={{ position: "absolute", left: 0, right: 0, top: 0 }}>
        {articles.length === 0 ? (
          /* Offline / Empty State Card */
          <div
            style={{
              position: "absolute",
              left: canvasLeft,
              right: 40,
              top: 16,
              height: CARD_H,
              borderRadius: 20,
              background: isDark
                ? "linear-gradient(135deg, rgba(19, 29, 37, 0.85) 0%, rgba(13, 20, 26, 0.92) 100%)"
                : "linear-gradient(135deg, rgba(255, 255, 255, 0.95) 0%, rgba(240, 244, 248, 0.98) 100%)",
              border: "none",
              backdropFilter: "blur(16px)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              padding: "32px 48px",
              textAlign: "center",
              gap: 12,
            }}
          >
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: "50%",
                background: isDark
                  ? "rgba(255, 255, 255, 0.06)"
                  : "rgba(0, 0, 0, 0.05)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: isDark ? "#8899aa" : "#667788",
                marginBottom: 2,
              }}
            >
              <svg
                width={26}
                height={26}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
                <line x1="2" y1="2" x2="22" y2="22" />
              </svg>
            </div>

            <div
              style={{
                fontSize: 18,
                fontWeight: 700,
                color: isDark ? "#ffffff" : "#111822",
                fontFamily: BASE_FONT,
              }}
            >
              {t("news.offlineTitle")}
            </div>

            <div
              style={{
                fontSize: 14.5,
                color: isDark ? "#8899aa" : "#667788",
                maxWidth: 520,
                lineHeight: 1.5,
                fontFamily: BASE_FONT,
              }}
            >
              {t("news.offlineDesc")}
            </div>

            <button
              type="button"
              onClick={fetchNews}
              disabled={isLoading}
              className="launcher-btn-secondary"
              style={{
                marginTop: 8,
                padding: "8px 24px",
                height: 40,
                borderRadius: 12,
                fontSize: 14,
                fontWeight: 700,
                fontFamily: BASE_FONT,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              {isLoading ? (
                <span>{t("common.loading")}</span>
              ) : (
                <>
                  <svg
                    width={15}
                    height={15}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
                  </svg>
                  <span>{t("news.retry")}</span>
                </>
              )}
            </button>
          </div>
        ) : (
          /* Scrollable area with news cards */
          <div
            ref={scrollRef}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={stopDrag}
            onMouseLeave={stopDrag}
            onScroll={check}
            style={{
              display: "flex",
              gap: GAP,
              overflowX: "auto",
              scrollbarWidth: "none",
              cursor: isDragging.current ? "grabbing" : "grab",
              paddingLeft: canvasLeft,
              paddingRight: 40,
              paddingTop: 16,
              paddingBottom: 54,
              userSelect: "none",
            }}
          >
            {articles.map((card, i) => (
              <NewsCard
                key={i}
                card={card}
                CARD_W={CARD_W}
                CARD_H={CARD_H}
                onClick={() => handleCardClick(card)}
                theme={theme}
              />
            ))}
          </div>
        )}

        {/* ── Left fade ── */}
        {articles.length > 0 && (
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              width: canvasLeft - 10,
              background: `linear-gradient(to right, ${tokens.bgBase} 0%, ${tokens.bgBase} 78%, transparent 100%)`,
              pointerEvents: "none",
              zIndex: 2,
            }}
          />
        )}

        {/* ── Left arrow ── */}
        {articles.length > 0 && canLeft && (
          <button
            type="button"
            onClick={() => scroll("l")}
            className="carousel-nav-btn"
            style={{
              position: "absolute",
              left: Math.max(12, canvasLeft - 60),
              top: CARD_H / 2,
              transform: "translateY(-50%)",
              width: 48,
              height: 48,
              borderRadius: 15,
              background: isDark
                ? "rgba(255, 255, 255, 0.12)"
                : "rgba(255, 255, 255, 0.85)",
              border: isDark
                ? "1.5px solid rgba(255, 255, 255, 0.22)"
                : "1.5px solid rgba(0, 0, 0, 0.12)",
              boxShadow: isDark
                ? "0 8px 24px rgba(0, 0, 0, 0.35)"
                : "0 4px 16px rgba(0, 0, 0, 0.1)",
              color: isDark ? "#ffffff" : "#111822",
              backdropFilter: "blur(10px)",
              WebkitBackdropFilter: "blur(10px)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 3,
            }}
          >
            <IconChevronLeft size={22} />
          </button>
        )}

        {/* ── Right arrow ── */}
        {articles.length > 0 && canRight && (
          <button
            type="button"
            onClick={() => scroll("r")}
            className="carousel-nav-btn"
            style={{
              position: "absolute",
              right: 18,
              top: CARD_H / 2,
              transform: "translateY(-50%)",
              width: 48,
              height: 48,
              borderRadius: 15,
              background: isDark
                ? "rgba(255, 255, 255, 0.12)"
                : "rgba(255, 255, 255, 0.85)",
              border: isDark
                ? "1.5px solid rgba(255, 255, 255, 0.22)"
                : "1.5px solid rgba(0, 0, 0, 0.12)",
              boxShadow: isDark
                ? "0 8px 24px rgba(0, 0, 0, 0.35)"
                : "0 4px 16px rgba(0, 0, 0, 0.1)",
              color: isDark ? "#ffffff" : "#111822",
              backdropFilter: "blur(10px)",
              WebkitBackdropFilter: "blur(10px)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 3,
            }}
          >
            <IconChevronRight size={22} />
          </button>
        )}
      </div>

      {openCard && (
        <NewsModal
          card={openCard}
          onClose={() => setOpenCard(null)}
          theme={theme}
        />
      )}
    </>
  );
}
