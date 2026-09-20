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
      return <IconGear size={18} className="text-cyan-400" />;
    case "bars":
      return <IconBars size={18} className="text-cyan-400" />;
    case "users":
      return <IconUsers size={18} className="text-cyan-400" />;
    default:
      return <IconGear size={18} className="text-cyan-400" />;
  }
};

export const CommunitySection: React.FC<CommunitySectionProps> = ({ content }) => {
  return (
    <Card
      className="relative h-full p-6 sm:p-8 flex flex-col justify-between overflow-hidden bg-[#121a22]/80 backdrop-blur-xl border-white/[0.1] shadow-[0_8px_30px_rgba(0,0,0,0.45)]"
      style={{
        backgroundImage: content.backgroundImage
          ? `url(${content.backgroundImage})`
          : undefined,
        backgroundSize: "cover",
        backgroundPosition: "right center",
      }}
    >
      {/* Smooth directional gradient overlay: dark text zone on left, smooth fade to showcase forge artwork on right */}
      <div className="absolute inset-0 bg-gradient-to-r from-[#0c1622]/98 via-[#0c1622]/80 via-40% to-transparent pointer-events-none" />
      <div className="absolute inset-0 bg-gradient-to-t from-[#0c1622]/90 via-[#0c1622]/30 via-40% to-transparent pointer-events-none" />

      {/* Main Content */}
      <div className="relative z-10 space-y-5">
        {/* Eyebrow */}
        <div className="inline-flex items-center gap-2">
          <span className="w-3.5 h-[2.5px] rounded-full bg-orange-500" />
          <span className="text-[11px] font-bold uppercase tracking-widest text-orange-400">
            {content.eyebrow}
          </span>
        </div>

        {/* Heading & Description */}
        <div className="space-y-2.5">
          <h3 className="text-3xl sm:text-4xl font-black tracking-tight text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.8)]">
            {content.title}
          </h3>
          <p className="text-xs sm:text-sm text-[#8899aa] leading-relaxed max-w-sm drop-shadow-[0_1px_6px_rgba(0,0,0,0.8)] font-normal">
            {content.description}
          </p>
        </div>

        {/* CTA Button */}
        <div className="pt-1">
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

      {/* Bottom Benefit Chips: Uniform, compact, perfectly aligned 3-column row */}
      <div className="relative z-10 grid grid-cols-3 gap-2.5 sm:gap-3 pt-5 mt-5 border-t border-white/[0.08]">
        {content.benefits.map((benefit: CommunityBenefit) => (
          <div
            key={benefit.id}
            className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-[#090f17]/65 border border-white/[0.08] backdrop-blur-md shadow-sm h-full"
          >
            <span className="flex-shrink-0">{getBenefitIcon(benefit.icon)}</span>
            <span className="text-[11px] sm:text-xs font-semibold text-white/90 leading-tight select-none">
              {benefit.label}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
};
