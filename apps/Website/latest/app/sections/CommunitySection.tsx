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
    <Card className="relative h-full p-6 sm:p-8 flex flex-col justify-between overflow-hidden rounded-[24px] border border-white/[0.1] bg-[#121a22]/85 backdrop-blur-xl shadow-[0_8px_30px_rgba(0,0,0,0.45)]">
      {/* Absolute internal media layer with rounded-[inherit] preventing any border clipping artifacts */}
      {content.backgroundImage && (
        <div className="absolute inset-0 overflow-hidden pointer-events-none select-none rounded-[inherit]">
          <img
            src={content.backgroundImage}
            alt=""
            className="w-full h-full object-cover object-[right_bottom] scale-105"
          />
          {/* Smooth directional gradient overlay: dark on left for text contrast, clear on right to showcase forge artwork */}
          <div className="absolute inset-0 bg-gradient-to-r from-[#0c1622]/98 via-[#0c1622]/80 via-45% to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#0c1622]/95 via-[#0c1622]/20 via-40% to-transparent" />
        </div>
      )}

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

      {/* Bottom Benefit Row: square icon tile + 2-line text + subtle vertical dividers */}
      <div className="relative z-10 flex items-center justify-between gap-3 sm:gap-4 pt-5 mt-5 border-t border-white/[0.08]">
        {content.benefits.map((benefit: CommunityBenefit, index: number) => (
          <React.Fragment key={benefit.id}>
            <div className="flex items-center gap-2.5 flex-1 min-w-0">
              {/* Small square tile with icon */}
              <div className="w-9 h-9 rounded-lg bg-[#0c1a26]/85 border border-cyan-500/25 flex items-center justify-center flex-shrink-0 text-cyan-400 shadow-[0_0_12px_rgba(6,182,212,0.15)]">
                {getBenefitIcon(benefit.icon)}
              </div>
              {/* Unboxed 2-line text */}
              <span className="text-[11px] sm:text-xs font-semibold text-white/90 leading-tight select-none whitespace-pre-line">
                {benefit.label}
              </span>
            </div>

            {/* Subtle vertical divider between items */}
            {index < content.benefits.length - 1 && (
              <div
                className="w-[1px] h-7 bg-white/[0.1] flex-shrink-0 self-center"
                aria-hidden="true"
              />
            )}
          </React.Fragment>
        ))}
      </div>
    </Card>
  );
};
