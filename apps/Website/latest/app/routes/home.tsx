import React from "react";
import type { Route } from "./+types/home";
import { getWebsiteContent } from "../content";
import { Footer } from "../components/layout/Footer";
import { Container } from "../components/ui/Container";
import { HeroSection } from "../sections/HeroSection";
import { JourneySection } from "../sections/JourneySection";
import { NewsSection } from "../sections/NewsSection";
import { CommunitySection } from "../sections/CommunitySection";
import { FeaturesSection } from "../sections/FeaturesSection";
import { ScrollReveal } from "../components/ui/ScrollReveal";

export function meta({}: Route.MetaArgs) {
  const content = getWebsiteContent();
  return [
    { title: `${content.header.brandName} - ${content.hero.title}` },
    { name: "description", content: content.hero.description },
    { name: "theme-color", content: "#090d12" },
    { property: "og:title", content: `${content.header.brandName} - ${content.hero.title}` },
    { property: "og:description", content: content.hero.description },
    { property: "og:type", content: "website" },
  ];
}

export default function Home() {
  const content = getWebsiteContent();

  return (
    <div className="min-h-screen bg-[#090d12] text-white selection:bg-orange-500/30 selection:text-orange-200">
      {/* Main Landing Flow */}
      <main className="w-full">
        {/* 1. Hero Section with Top Header (Image 1) */}
        <HeroSection content={content.hero} headerContent={content.header} />

        {/* 2. Unified Composition: Journey + News + Community (Image 2) */}
        <section
          id="novedades"
          className="relative py-14 sm:py-20 overflow-hidden"
          aria-label="Aventura y Novedades"
        >
          {/* Dual-layer background: Blurred atmospheric full scene + Sharp feathered HiKAT focus in top-right */}
          <div className="absolute inset-0 overflow-hidden pointer-events-none select-none">
            {/* CAPA 1: Full Background with Strong Atmospheric Blur */}
            {content.journey.sectionBackgroundImage && (
              <div
                className="absolute inset-0 bg-cover bg-no-repeat scale-110 filter blur-[12px] opacity-60 transition-all"
                style={{
                  backgroundImage: `url(${content.journey.sectionBackgroundImage})`,
                  backgroundPosition: content.journey.sectionBackgroundPosition || "right 5% top",
                }}
              />
            )}

            {/* Dark atmospheric base gradients for readability */}
            <div className="absolute inset-0 bg-gradient-to-r from-[#090d12]/98 via-[#090d12]/75 via-50% to-[#090d12]/30" />
            <div className="absolute inset-0 bg-radial from-transparent via-[#090d12]/20 to-[#090d12]/80" />

            {/* CAPA 2: Sharp HiKAT building, gear, banners & character detail in top-right (Image 3 reference) */}
            {content.journey.sectionBackgroundImage && (
              <div
                className="absolute top-0 right-0 w-full sm:w-[90%] md:w-[80%] lg:w-[70%] xl:w-[62%] h-[480px] sm:h-[540px] md:h-[600px] lg:h-[660px] pointer-events-none overflow-hidden"
                style={{
                  maskImage:
                    content.journey.sectionFocusMask ||
                    "radial-gradient(ellipse 75% 70% at 70% 36%, black 30%, rgba(0,0,0,0.85) 55%, rgba(0,0,0,0.2) 75%, transparent 92%)",
                  WebkitMaskImage:
                    content.journey.sectionFocusMask ||
                    "radial-gradient(ellipse 75% 70% at 70% 36%, black 30%, rgba(0,0,0,0.85) 55%, rgba(0,0,0,0.2) 75%, transparent 92%)",
                }}
              >
                <div
                  className="w-full h-full bg-no-repeat opacity-95 transition-all"
                  style={{
                    backgroundImage: `url(${content.journey.sectionBackgroundImage})`,
                    backgroundPosition:
                      content.journey.sectionFocusPosition ||
                      content.journey.sectionBackgroundPosition ||
                      "right 6% top",
                    backgroundSize: content.journey.sectionFocusSize || "cover",
                    transform:
                      content.journey.sectionFocusScale ||
                      content.journey.sectionFocusTranslateX ||
                      content.journey.sectionFocusTranslateY
                        ? `scale(${content.journey.sectionFocusScale || 1}) translate(${
                            content.journey.sectionFocusTranslateX || "0px"
                          }, ${content.journey.sectionFocusTranslateY || "0px"})`
                        : undefined,
                  }}
                />
                {/* Smooth progressive feathering overlays on left and bottom edges */}
                <div className="absolute inset-0 bg-gradient-to-r from-[#090d12]/95 via-[#090d12]/30 via-30% to-transparent" />
                <div className="absolute inset-0 bg-gradient-to-t from-[#090d12] via-transparent via-50% to-transparent" />
              </div>
            )}

            {/* Smooth gradient fades for seamless transitions with Hero above and Features below */}
            <div className="absolute top-0 left-0 right-0 h-32 bg-gradient-to-b from-[#090d12] via-[#090d12]/80 to-transparent" />
            <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-[#090d12] via-[#090d12]/80 to-transparent" />
          </div>

          {/* Unified Section Content */}
          <div className="relative z-10 space-y-10 sm:space-y-12">
            {/* Top part: Comienza tu aventura */}
            <JourneySection content={content.journey} />

            {/* Bottom part: Novedades & Comunidad Grid */}
            <Container className="!max-w-[1520px]">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
                <ScrollReveal delay={0} className="h-full">
                  <NewsSection content={content.news} />
                </ScrollReveal>
                <ScrollReveal delay={100} className="h-full">
                  <div className="h-full">
                    <CommunitySection content={content.community} />
                  </div>
                </ScrollReveal>
              </div>
            </Container>
          </div>
        </section>

        {/* 3. Features Section - ¿Qué puedes hacer en HiKAT? (Image 3) */}
        <FeaturesSection content={content.features} />
      </main>

      {/* Minimalist Footer (Image 3 Bottom) */}
      <Footer content={content.footer} />
    </div>
  );
}
