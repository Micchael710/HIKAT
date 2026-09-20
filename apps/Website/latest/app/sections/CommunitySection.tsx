import React from "react";
import type { CommunityContent, CommunityBenefit } from "../content/types";
import { Card } from "../components/ui/Card";
import { ButtonLink } from "../components/ui/Button";
import { IconUsers, IconArrowRight, IconGear, IconBars } from "../components/ui/Icons";

export interface CommunitySectionProps {
  content: CommunityContent;
}

const getBenefitIcon = (iconName: string) => {
  switch (iconName) {
    case "gear":
      return <IconGear size={16} className="text-orange-400" />;
    case "bars":
      return <IconBars size={16} className="text-cyan-400" />;
    case "users":
      return <IconUsers size={16} className="text-purple-400" />;
    default:
      return <IconGear size={16} className="text-orange-400" />;
  }
};

export const CommunitySection: React.FC<CommunitySectionProps> = ({ content }) => {
  return (
    <Card
      className="relative h-full p-6 sm:p-8 flex flex-col justify-between overflow-hidden"
      style={{
        backgroundImage: content.backgroundImage
          ? `url(${content.backgroundImage})`
          : undefined,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      {/* Directional gradient overlay: dark on left for text legibility, clear on right to showcase artwork */}
      <div className="absolute inset-0 bg-gradient-to-r from-[#090d12]/95 via-[#090d12]/65 to-[#090d12]/20 pointer-events-none" />
      <div className="absolute inset-0 bg-gradient-to-t from-[#090d12]/90 via-[#090d12]/30 to-transparent pointer-events-none" />

      {/* Main Content */}
      <div className="relative z-10 space-y-6">
        {/* Eyebrow */}
        <div className="inline-flex items-center gap-2">
          <span className="w-3.5 h-[2.5px] rounded-full bg-orange-500" />
          <span className="text-[11px] font-bold uppercase tracking-widest text-orange-400">
            {content.eyebrow}
          </span>
        </div>

        {/* Heading & Description */}
        <div className="space-y-3">
          <h3 className="text-3xl sm:text-4xl font-black tracking-tight text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.8)]">
            {content.title}
          </h3>
          <p className="text-xs sm:text-sm text-[#8899aa] leading-relaxed max-w-lg drop-shadow-[0_1px_6px_rgba(0,0,0,0.8)] font-normal">
            {content.description}
          </p>
        </div>

        {/* CTA Button */}
        <div>
          <ButtonLink
            variant="primary"
            href={content.ctaAction.href}
            icon={<IconUsers size={18} />}
            className="!px-6 !py-3 !text-sm !rounded-xl"
          >
            <span>{content.ctaAction.label}</span>
            <IconArrowRight size={16} className="ml-1" />
          </ButtonLink>
        </div>
      </div>

      {/* Bottom Benefit Chips */}
      <div className="relative z-10 grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-6 mt-6 border-t border-white/[0.08]">
        {content.benefits.map((benefit: CommunityBenefit) => (
          <div
            key={benefit.id}
            className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-[#090d12]/75 border border-white/[0.1] backdrop-blur-md shadow-sm"
          >
            <span className="flex-shrink-0">{getBenefitIcon(benefit.icon)}</span>
            <span className="text-xs font-semibold text-white/95 leading-tight">
              {benefit.label}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
};
