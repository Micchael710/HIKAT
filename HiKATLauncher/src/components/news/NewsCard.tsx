import React, { useState, useEffect } from "react";
import { ThemeMode, NewsCardItem } from "../../types";
import { hexToRGB } from "../../theme/tokens";

interface NewsCardProps {
  card: NewsCardItem;
  CARD_W: number;
  CARD_H: number;
  onClick: () => void;
  theme?: ThemeMode;
}

export default function NewsCard({
  card,
  CARD_W,
  CARD_H,
  onClick,
  theme = "dark",
}: NewsCardProps) {
  const isDark = theme === "dark";
  const [accent, setAccent] = useState(() =>
    hexToRGB(card.accentColor || "#e8a840"),
  );

  /* Saturated dominant color extraction */
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      try {
        const W = 48;
        const H = 48;
        const canvas = document.createElement("canvas");
        canvas.width = W;
        canvas.height = H;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(img, 0, 0, W, H);
          const data = ctx.getImageData(0, 0, W, H).data;
          let bestSaturation = -1;
          let bestR = 232;
          let bestG = 168;
          let bestB = 64;
          for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            const a = data[i + 3];
            if (a > 120) {
              const max = Math.max(r, g, b);
              const min = Math.min(r, g, b);
              const sat = max === 0 ? 0 : (max - min) / max;
              const lum = (max + min) / 2;
              if (sat > bestSaturation && lum > 35 && lum < 225) {
                bestSaturation = sat;
                bestR = r;
                bestG = g;
                bestB = b;
              }
            }
          }
          setAccent({
            r: bestR,
            g: bestG,
            b: bestB,
            css: `${bestR}, ${bestG}, ${bestB}`,
          });
        }
      } catch (_) {
        /* keep fallback */
      }
    };
    img.src = card.img;
  }, [card.img]);

  return (
    <div
      onClick={onClick}
      className="news-card-item"
      style={{
        width: CARD_W,
        height: CARD_H,
        borderRadius: 18,
        position: "relative",
        overflow: "hidden",
        cursor: "pointer",
        userSelect: "none",
        flexShrink: 0,
        isolation: "isolate",
        transform: "translate3d(0, 0, 0)",
        willChange: "transform",
        ["--card-border-color" as any]: `rgba(${accent.css}, 0.85)`,
        ["--card-glow-color" as any]: `rgba(${accent.css}, 0.28)`,
      }}
    >
      {/* Full-bleed background thumbnail image */}
      <img
        src={card.img}
        alt={card.title}
        draggable={false}
        className="news-thumbnail-img"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          display: "block",
          transition: "transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)",
          pointerEvents: "none",
        }}
      />

      {/* Dynamic bottom accent glow wash */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `linear-gradient(to top, rgba(${accent.css}, 0.42) 0%, rgba(${accent.css}, 0.12) 35%, transparent 65%)`,
          pointerEvents: "none",
        }}
      />

      {/* Deep black gradient overlay for crisp text readability */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(to top, rgba(8, 12, 16, 0.95) 0%, rgba(8, 12, 16, 0.65) 42%, rgba(8, 12, 16, 0.1) 75%, transparent 100%)",
          pointerEvents: "none",
        }}
      />

      {/* Bottom Title Container */}
      <div
        style={{
          position: "absolute",
          left: 18,
          right: 18,
          bottom: 16,
          display: "flex",
          flexDirection: "column",
          gap: 4,
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            color: "#ffffff",
            fontFamily: "Inter, sans-serif",
            fontWeight: 800,
            fontSize: 20,
            lineHeight: 1.25,
            letterSpacing: "-0.015em",
            textShadow: "0 2px 10px rgba(0, 0, 0, 0.9)",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {card.title}
        </div>
      </div>
    </div>
  );
}
