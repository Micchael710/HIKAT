import React from "react";
import type { FeaturesSectionContent, FeatureItem as FeatureItemType } from "../content/types";
import { Container } from "../components/ui/Container";
import { SectionHeading } from "../components/ui/SectionHeading";
import { Card } from "../components/ui/Card";
import { ButtonLink } from "../components/ui/Button";
import { IconDownload, IconArrowRight } from "../components/ui/Icons";
import { ScrollReveal } from "../components/ui/ScrollReveal";
import { useCardMotion } from "../hooks/useCardMotion";

export interface FeaturesSectionProps {
  content: FeaturesSectionContent;
}

const SecondaryFeatureCard: React.FC<{ item: FeatureItemType }> = ({ item }) => {
  const motionRef = useCardMotion<HTMLAnchorElement>({
    enableTilt: true,
    maxTilt: 1.0,
    enableSpotlight: true,
  });

  return (
    <a
      ref={motionRef}
      href={item.href}
      className="has-micro-tilt relative overflow-hidden flex-1 p-5 sm:p-6 flex items-center justify-between gap-4 sm:gap-5 rounded-[22px] border border-white/[0.09] bg-[#121a22]/75 hover:bg-[#121a22]/90 hover:border-white/25 backdrop-blur-xl shadow-[0_8px_30px_rgba(0,0,0,0.45)] transition-all group focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 cursor-pointer select-none"
    >
      {/* Spotlight and luminous border */}
      <div className="card-spotlight-layer" aria-hidden="true" />
      <div className="card-spotlight-border" aria-hidden="true" />

      <div className="relative z-10 flex items-center gap-4 sm:gap-5 min-w-0 flex-1">
        {/* Large square thumbnail with clean rounded corners and isolated overflow */}
        <div className="w-20 h-20 sm:w-24 sm:h-24 md:w-28 md:h-28 rounded-2xl overflow-hidden bg-[#090d12] flex-shrink-0 border border-white/[0.08] relative isolate">
          <img
            src={item.imageUrl}
            alt={item.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            onError={(e) => {
              e.currentTarget.style.opacity = "0.4";
            }}
          />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <h4 className="text-base sm:text-lg font-bold text-white tracking-tight group-hover:text-white transition-colors truncate">
            {item.title}
          </h4>
          <p className="text-xs sm:text-sm text-[#8899aa] leading-relaxed line-clamp-2 font-normal">
            {item.description}
          </p>
        </div>
      </div>

      <div className="relative z-10 flex-shrink-0">
        <span
          className="w-10 h-10 rounded-full bg-white/[0.06] border border-white/[0.1] flex items-center justify-center text-[#8899aa] group-hover:text-white group-hover:bg-white/[0.12] group-hover:border-white/25 transition-all shadow-sm"
          aria-hidden="true"
        >
          <IconArrowRight size={16} />
        </span>
      </div>
    </a>
  );
};

export const FeaturesSection: React.FC<FeaturesSectionProps> = ({ content }) => {
  const { featured, secondaryItems } = content;

  return (
    <section id="comunidad" className="relative pt-12 sm:pt-16 pb-16 sm:pb-24 overflow-hidden">
      {/* Atmospheric deep cyan / navy glow background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none select-none">
        <div className="absolute inset-0 bg-[#090d12]" />
        {/* Soft atmospheric ambient glow */}
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[1200px] h-[550px] bg-gradient-to-b from-[#0e2a40]/30 via-[#0a1c2c]/15 to-transparent rounded-full filter blur-3xl opacity-80" />
        <div className="absolute bottom-0 left-0 right-0 h-40 bg-gradient-to-t from-[#090d12] via-[#090d12]/60 to-transparent" />
      </div>

      <Container className="relative z-10 !max-w-[1520px]">
        {/* Section Heading with seamlessly aligned View All CTA */}
        <ScrollReveal delay={0}>
          <SectionHeading
            title={content.title}
            description={content.description}
            action={content.viewAllAction}
            className="!mb-8 sm:!mb-10"
          />
        </ScrollReveal>

        {/* 2-Column Split: Dominant Featured Card on Left (7 cols), 3 Stacked Secondary Cards on Right (5 cols) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
          {/* Featured Dominant Card on Left */}
          <ScrollReveal delay={0} className="lg:col-span-7 flex">
            <Card
              interactive
              enableTilt
              enableSpotlight
              className="relative w-full min-h-[500px] sm:min-h-[560px] lg:min-h-[600px] p-7 sm:p-10 flex flex-col justify-end overflow-hidden rounded-[26px] border border-white/[0.1] bg-[#121a22]/85 backdrop-blur-xl shadow-[0_12px_40px_rgba(0,0,0,0.5)]"
            >
              {/* Absolute internal media layer with rounded-[inherit] preventing any border clipping */}
              {featured.backgroundImage && (
                <div className="absolute inset-0 overflow-hidden pointer-events-none select-none rounded-[inherit]">
                  <img
                    src={featured.backgroundImage}
                    alt=""
                    className="w-full h-full object-cover object-[center_35%]"
                  />
                  {/* Smooth vignette and text protection gradients */}
                  <div className="absolute inset-0 bg-gradient-to-t from-[#090d12]/98 via-[#090d12]/60 via-40% to-transparent" />
                  <div className="absolute inset-0 bg-gradient-to-r from-[#090d12]/70 via-transparent via-50% to-transparent" />
                </div>
              )}

              {/* Bottom text & CTA */}
              <div className="relative z-10 space-y-4 max-w-xl">
                {featured.serverLogoUrl ? (
                  <img
                    src={featured.serverLogoUrl}
                    alt={featured.serverName}
                    className="h-10 sm:h-12 w-auto object-contain drop-shadow-[0_4px_16px_rgba(0,0,0,0.8)]"
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
                    }}
                  />
                ) : (
                  <span className="text-xl sm:text-2xl font-black uppercase tracking-wider text-amber-400 drop-shadow-[0_2px_10px_rgba(245,158,11,0.5)]">
                    {featured.serverName}
                  </span>
                )}

                <h3 className="text-2xl sm:text-3xl lg:text-[34px] font-black text-white tracking-tight leading-tight drop-shadow-[0_2px_10px_rgba(0,0,0,0.8)]">
                  {featured.title}
                </h3>

                <p className="text-xs sm:text-sm text-[#8899aa] leading-relaxed font-normal drop-shadow-[0_1px_6px_rgba(0,0,0,0.8)]">
                  {featured.description}
                </p>

                <div className="pt-2">
                  <ButtonLink
                    variant="primary"
                    href={featured.ctaAction.href}
                    icon={<IconDownload size={18} />}
                    className="!px-7 !py-3.5 !text-sm !rounded-xl"
                  >
                    {featured.ctaAction.label}
                  </ButtonLink>
                </div>
              </div>
            </Card>
          </ScrollReveal>

          {/* 3 Secondary Stacked Cards on Right */}
          <div className="lg:col-span-5 flex flex-col justify-between gap-4 sm:gap-5">
            {secondaryItems.map((item, index) => (
              <ScrollReveal key={item.id} delay={index * 60} className="flex-1 flex">
                <SecondaryFeatureCard item={item} />
              </ScrollReveal>
            ))}
          </div>
        </div>
      </Container>
    </section>
  );
};
