import React from "react";
import type { JourneyContent, JourneyStep as JourneyStepType } from "../content/types";
import { Container } from "../components/ui/Container";
import { SectionHeading } from "../components/ui/SectionHeading";
import { Card } from "../components/ui/Card";
import { DynamicBadgeIcon, IconArrowRight } from "../components/ui/Icons";

export interface JourneySectionProps {
  content: JourneyContent;
}

const JourneyStepCard: React.FC<{ step: JourneyStepType }> = ({ step }) => {
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
    <Card className="flex-1 p-5 sm:p-6 flex items-center gap-4 group hover:border-white/25 transition-all">
      <div
        className={`w-14 h-14 rounded-2xl border flex items-center justify-center flex-shrink-0 transition-transform duration-200 group-hover:scale-105 ${getBadgeStyle(
          step.badgeType
        )}`}
      >
        <DynamicBadgeIcon type={step.badgeType} size={28} />
      </div>
      <div className="min-w-0">
        <h3 className="text-base sm:text-lg font-bold text-white tracking-tight leading-snug">
          {step.title}
        </h3>
        <p className="text-xs sm:text-sm text-[#8899aa] leading-relaxed mt-1">
          {step.description}
        </p>
      </div>
    </Card>
  );
};

export const JourneySection: React.FC<JourneySectionProps> = ({ content }) => {
  return (
    <section id="aventura" className="relative pt-10 sm:pt-14 pb-4 sm:pb-6 overflow-hidden">
      {/* Subtle atmospheric background gradient */}
      <div className="absolute top-0 right-0 w-1/2 h-full bg-radial from-orange-500/[0.04] via-transparent to-transparent pointer-events-none" />

      <Container className="relative z-10">
        {/* Section Heading */}
        <SectionHeading
          eyebrow={content.eyebrow}
          title={content.title}
          description={content.description}
          className="!mb-6"
        />

        {/* Steps Sequence */}
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center gap-4 mt-6">
          {content.steps.map((step, index) => (
            <React.Fragment key={step.order}>
              <JourneyStepCard step={step} />

              {/* Connecting arrow separator */}
              {index < content.steps.length - 1 && (
                <div
                  className="hidden lg:flex items-center justify-center flex-shrink-0"
                  aria-hidden="true"
                >
                  <span className="w-8 h-8 rounded-full bg-white/[0.05] border border-white/[0.1] flex items-center justify-center text-[#8899aa]">
                    <IconArrowRight size={14} />
                  </span>
                </div>
              )}
            </React.Fragment>
          ))}
        </div>
      </Container>
    </section>
  );
};
