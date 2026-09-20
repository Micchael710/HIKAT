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
          {/* Atmospheric Minecraft/Hytale background layer with controlled blur & smooth section fades */}
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            {content.journey.sectionBackgroundImage && (
              <div
                className="absolute inset-0 bg-cover bg-center bg-no-repeat scale-105 filter blur-[6px] opacity-40"
                style={{
                  backgroundImage: `url(${content.journey.sectionBackgroundImage})`,
                }}
              />
            )}
            {/* Deep dark slate atmospheric overlay */}
            <div className="absolute inset-0 bg-[#090d12]/75" />
            <div className="absolute inset-0 bg-radial from-transparent via-[#090d12]/35 to-[#090d12]/95" />

            {/* Smooth gradient fades for seamless transitions with Hero and Features */}
            <div className="absolute top-0 left-0 right-0 h-36 bg-gradient-to-b from-[#090d12] via-[#090d12]/80 to-transparent" />
            <div className="absolute bottom-0 left-0 right-0 h-36 bg-gradient-to-t from-[#090d12] via-[#090d12]/80 to-transparent" />
          </div>

          {/* Unified Section Content */}
          <div className="relative z-10 space-y-10 sm:space-y-12">
            {/* Top part: Comienza tu aventura */}
            <JourneySection content={content.journey} />

            {/* Bottom part: Novedades & Comunidad Grid */}
            <Container className="!max-w-[1520px]">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
                <NewsSection content={content.news} />
                <div id="comunidad" className="h-full">
                  <CommunitySection content={content.community} />
                </div>
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
