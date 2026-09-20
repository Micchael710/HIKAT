import React, { useEffect, useRef } from "react";
import type { HeroContent, HeroCard as HeroCardType, HeaderContent } from "../content/types";
import { Container } from "../components/ui/Container";
import { ButtonLink } from "../components/ui/Button";
import { Header } from "../components/layout/Header";
import {
  IconDownload,
  IconPlay,
  IconArrowRight,
  DynamicBadgeIcon,
  IconMouseScroll,
} from "../components/ui/Icons";

export interface HeroSectionProps {
  content: HeroContent;
  headerContent: HeaderContent;
}

const HeroCardItem: React.FC<{ card: HeroCardType }> = ({ card }) => {
  const getBadgeStyle = (type: string) => {
    switch (type) {
      case "launcher":
        return "bg-gradient-to-br from-amber-500/20 to-orange-600/30 border-orange-500/40 shadow-[0_0_16px_rgba(245,158,11,0.2)]";
      case "skins":
        return "bg-gradient-to-br from-cyan-500/20 to-blue-600/30 border-cyan-500/40 shadow-[0_0_16px_rgba(6,182,212,0.2)]";
      case "server":
        return "bg-gradient-to-br from-purple-500/20 to-indigo-600/30 border-purple-500/40 shadow-[0_0_16px_rgba(168,85,247,0.2)]";
      default:
        return "bg-white/10 border-white/20";
    }
  };

  return (
    <a
      href={card.href}
      className="p-5 sm:p-6 group flex items-center justify-between gap-4 rounded-[22px] border border-white/[0.09] bg-[#121a22]/75 hover:bg-[#121a22]/90 hover:border-white/25 backdrop-blur-xl shadow-[0_8px_30px_rgba(0,0,0,0.45)] transition-all cursor-pointer select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
    >
      <div className="flex items-center gap-4 min-w-0 flex-1">
        <div
          className={`w-14 h-14 rounded-2xl border flex items-center justify-center flex-shrink-0 transition-transform duration-200 group-hover:scale-105 ${getBadgeStyle(
            card.badgeType
          )}`}
        >
          <DynamicBadgeIcon type={card.badgeType} size={28} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-base sm:text-lg font-bold text-white tracking-tight group-hover:text-white transition-colors truncate">
            {card.title}
          </h3>
          <p className="text-xs sm:text-sm text-[#8899aa] leading-snug line-clamp-2 mt-0.5 font-normal">
            {card.description}
          </p>
        </div>
      </div>

      <div className="flex-shrink-0">
        <span
          className="w-9 h-9 rounded-full bg-white/[0.06] border border-white/[0.1] flex items-center justify-center text-[#8899aa] group-hover:text-white group-hover:bg-white/[0.12] group-hover:border-white/25 transition-all shadow-sm"
          aria-hidden="true"
        >
          <IconArrowRight size={16} />
        </span>
      </div>
    </a>
  );
};

export const HeroSection: React.FC<HeroSectionProps> = ({ content, headerContent }) => {
  const bgRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Respect prefers-reduced-motion
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (mediaQuery.matches) {
      return;
    }

    let rafId: number | null = null;

    const handleScroll = () => {
      if (rafId !== null) return;

      rafId = requestAnimationFrame(() => {
        rafId = null;
        const scrollY = window.scrollY || window.pageYOffset;
        // Only calculate parallax when Hero is in viewport
        if (scrollY < 1200 && bgRef.current) {
          const offsetY = scrollY * 0.22;
          bgRef.current.style.transform = `translate3d(0, ${offsetY}px, 0) scale(1.12)`;
        }
      });
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", handleScroll);
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
    };
  }, []);

  return (
    <section
      id="hero"
      className="relative min-h-[95vh] lg:min-h-screen flex flex-col justify-between pb-8"
    >
      {/* Background layer with dedicated overflow clipping so sticky header is preserved */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none select-none">
        <div
          ref={bgRef}
          className="absolute inset-0 bg-cover bg-no-repeat will-change-transform scale-[1.12]"
          style={{
            backgroundImage: `url(${content.backgroundImage})`,
            backgroundPosition: content.backgroundPosition || "center 30%",
            transform: "translate3d(0, 0, 0) scale(1.12)",
          }}
        />
        {/* Balanced contrast overlays: deep readability on left, clear illumination for castle and scenery */}
        <div className="absolute inset-0 bg-gradient-to-r from-[#090d12]/92 via-[#090d12]/60 via-45% to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#090d12]/95 via-[#090d12]/30 via-35% to-transparent" />
        <div className="absolute inset-0 bg-radial from-transparent via-[#090d12]/15 to-[#090d12]/80" />
      </div>

      {/* Top Sticky Header (Stays sticky strictly during Hero, scrolls away with Hero geometry) */}
      <div className="sticky top-0 z-50 w-full pointer-events-none">
        <Header content={headerContent} />
      </div>

      {/* Main Hero Content */}
      <Container className="relative z-10 my-auto pt-6 sm:pt-8 pb-8 !max-w-[1520px]">
        <div className="max-w-2xl lg:max-w-3xl space-y-6">
          {/* Server Identity / Logo */}
          <div className="flex items-center gap-4">
            {content.serverLogoUrl ? (
              <img
                src={content.serverLogoUrl}
                alt={content.serverName}
                className="h-14 sm:h-20 object-contain drop-shadow-[0_8px_20px_rgba(0,0,0,0.8)]"
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
              />
            ) : (
              <h2 className="text-3xl sm:text-5xl font-black tracking-wider uppercase text-transparent bg-clip-text bg-gradient-to-r from-amber-400 via-orange-500 to-amber-600 drop-shadow-[0_4px_16px_rgba(245,158,11,0.5)]">
                {content.serverName}
              </h2>
            )}
          </div>

          {/* Heading */}
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black text-white tracking-tight leading-[1.1] drop-shadow-[0_4px_24px_rgba(0,0,0,0.7)]">
            {content.title}
          </h1>

          {/* Description */}
          <p className="text-base sm:text-lg lg:text-xl text-[#8899aa] leading-relaxed max-w-2xl font-normal drop-shadow-[0_2px_10px_rgba(0,0,0,0.8)]">
            {content.description}
          </p>

          {/* CTA Buttons */}
          <div className="flex flex-wrap items-center gap-4 pt-2">
            <ButtonLink
              variant="primary"
              href={content.primaryCta.href}
              icon={<IconDownload size={20} />}
              className="!px-7 !py-3.5 !text-base !rounded-xl"
            >
              {content.primaryCta.label}
            </ButtonLink>

            <ButtonLink
              variant="secondary"
              href={content.secondaryCta.href}
              icon={<IconPlay size={18} />}
              className="!px-6 !py-3.5 !text-base !rounded-xl"
            >
              {content.secondaryCta.label}
            </ButtonLink>
          </div>
        </div>
      </Container>

      {/* Bottom Hero Cards & Centered Scroll Indicator */}
      <Container className="relative z-10 mt-6 sm:mt-10 !max-w-[1520px]">
        {/* 3 Bottom Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 lg:gap-6 mb-6">
          {content.cards.map((card) => (
            <HeroCardItem key={card.id} card={card} />
          ))}
        </div>

        {/* Centered Scroll Indicator linking directly to #novedades */}
        <div className="flex items-center justify-center pt-2 text-[#8899aa] select-none">
          <a
            href="#novedades"
            aria-label="Desplazarse hacia novedades"
            className="flex flex-col items-center gap-1 hover:text-white transition-colors cursor-pointer"
          >
            <IconMouseScroll size={22} />
          </a>
        </div>
      </Container>
    </section>
  );
};
