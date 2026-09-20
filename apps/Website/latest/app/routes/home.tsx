import React from "react";
import type { Route } from "./+types/home";
import { getWebsiteContent } from "../content";
import { Header } from "../components/layout/Header";
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
      {/* Top Floating Glass Header */}
      <Header content={content.header} />

      {/* Main Landing Sections */}
      <main className="w-full">
        {/* 1. Hero Section (Image 1) */}
        <HeroSection content={content.hero} />

        {/* 2. Journey Section - Comienza tu aventura (Image 2 Top) */}
        <JourneySection content={content.journey} />

        {/* 3. News & Community Grid Section (Image 2 Bottom) */}
        <section id="novedades" className="py-12 sm:py-16">
          <Container>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
              <NewsSection content={content.news} />
              <div id="comunidad">
                <CommunitySection content={content.community} />
              </div>
            </div>
          </Container>
        </section>

        {/* 4. Features Section - ¿Qué puedes hacer en HiKAT? (Image 3) */}
        <FeaturesSection content={content.features} />
      </main>

      {/* Minimalist Footer (Image 3 Bottom) */}
      <Footer content={content.footer} />
    </div>
  );
}
