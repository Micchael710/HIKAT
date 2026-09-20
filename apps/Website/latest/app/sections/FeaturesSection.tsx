import React from "react";
import type { FeaturesSectionContent, FeatureItem as FeatureItemType } from "../content/types";
import { Container } from "../components/ui/Container";
import { SectionHeading } from "../components/ui/SectionHeading";
import { Card } from "../components/ui/Card";
import { ButtonLink } from "../components/ui/Button";
import { IconDownload, IconArrowRight } from "../components/ui/Icons";

export interface FeaturesSectionProps {
  content: FeaturesSectionContent;
}

const SecondaryFeatureCard: React.FC<{ item: FeatureItemType }> = ({ item }) => {
  return (
    <Card
      interactive
      className="p-4 sm:p-5 flex items-center justify-between gap-4 group"
      onClick={() => {
        if (item.href) {
          window.location.href = item.href;
        }
      }}
    >
      <div className="flex items-center gap-4 min-w-0">
        <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl overflow-hidden bg-[#090d12] flex-shrink-0 border border-white/[0.08] p-1 flex items-center justify-center">
          <img
            src={item.imageUrl}
            alt={item.title}
            className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-300"
            onError={(e) => {
              e.currentTarget.style.opacity = "0.4";
            }}
          />
        </div>
        <div className="min-w-0">
          <h4 className="text-base sm:text-lg font-bold text-white tracking-tight group-hover:text-white transition-colors truncate">
            {item.title}
          </h4>
          <p className="text-xs sm:text-sm text-[#8899aa] leading-snug line-clamp-2 mt-1">
            {item.description}
          </p>
        </div>
      </div>

      <div className="flex-shrink-0">
        <span
          className="btn-circle-arrow w-9 h-9 group-hover:bg-white/20 group-hover:border-white/40"
          aria-hidden="true"
        >
          <IconArrowRight size={16} />
        </span>
      </div>
    </Card>
  );
};

export const FeaturesSection: React.FC<FeaturesSectionProps> = ({ content }) => {
  const { featured, secondaryItems } = content;

  return (
    <section id="features" className="py-16 sm:py-24">
      <Container>
        {/* Section Heading with View All CTA */}
        <SectionHeading
          title={content.title}
          description={content.description}
          action={content.viewAllAction}
        />

        {/* 2-Column Split: Large Featured Card on Left, 3 Stacked Cards on Right */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mt-8">
          {/* Featured Large Card */}
          <div className="lg:col-span-7">
            <Card
              className="relative h-full min-h-[460px] p-6 sm:p-10 flex flex-col justify-end overflow-hidden"
              style={{
                backgroundImage: `url(${featured.backgroundImage})`,
                backgroundSize: "cover",
                backgroundPosition: "center 40%",
              }}
            >
              {/* Launcher gradient overlays */}
              <div className="absolute inset-0 bg-gradient-to-t from-[#090d12] via-[#090d12]/60 to-transparent pointer-events-none" />
              <div className="absolute inset-0 bg-radial from-transparent to-[#090d12]/40 pointer-events-none" />

              {/* Bottom text & CTA */}
              <div className="relative z-10 space-y-4 max-w-xl">
                {featured.serverLogoUrl ? (
                  <img
                    src={featured.serverLogoUrl}
                    alt={featured.serverName}
                    className="h-10 sm:h-12 object-contain drop-shadow-[0_4px_16px_rgba(0,0,0,0.8)]"
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
                    }}
                  />
                ) : (
                  <span className="text-xl sm:text-2xl font-black uppercase tracking-wider text-amber-400 drop-shadow-[0_2px_10px_rgba(245,158,11,0.5)]">
                    {featured.serverName}
                  </span>
                )}

                <h3 className="text-2xl sm:text-3xl lg:text-4xl font-black text-white tracking-tight leading-tight">
                  {featured.title}
                </h3>

                <p className="text-xs sm:text-sm text-[#8899aa] leading-relaxed">
                  {featured.description}
                </p>

                <div className="pt-2">
                  <ButtonLink
                    variant="primary"
                    href={featured.ctaAction.href}
                    icon={<IconDownload size={18} />}
                    className="!px-6 !py-3 !text-sm !rounded-xl"
                  >
                    {featured.ctaAction.label}
                  </ButtonLink>
                </div>
              </div>
            </Card>
          </div>

          {/* 3 Secondary Stacked Cards */}
          <div className="lg:col-span-5 flex flex-col justify-between gap-4">
            {secondaryItems.map((item) => (
              <SecondaryFeatureCard key={item.id} item={item} />
            ))}
          </div>
        </div>
      </Container>
    </section>
  );
};
