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
        return "bg-gradient-to-br from-amber-500/20 to-orange-600/30 border-orange-500/40 shadow-[0_0_16px_rgba(245,158,11,0.25)]";
      case "skins":
        return "bg-gradient-to-br from-cyan-500/20 to-blue-600/30 border-cyan-500/40 shadow-[0_0_16px_rgba(6,182,212,0.25)]";
      case "server":
        return "bg-gradient-to-br from-purple-500/20 to-indigo-600/30 border-purple-500/40 shadow-[0_0_16px_rgba(168,85,247,0.25)]";
      default:
        return "bg-white/10 border-white/20";
    }
  };

  return (
    <Card className="flex-1 p-6 sm:p-7 flex items-center gap-5 group hover:border-white/30 transition-all bg-[#121a22]/75 backdrop-blur-xl border-white/[0.1]">
      <div
        className={`w-16 h-16 rounded-2xl border flex items-center justify-center flex-shrink-0 transition-transform duration-200 group-hover:scale-105 ${getBadgeStyle(
          step.badgeType
        )}`}
      >
        <DynamicBadgeIcon type={step.badgeType} size={32} />
      </div>
      <div className="min-w-0">
        <h3 className="text-lg sm:text-xl font-bold text-white tracking-tight leading-snug">
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
    <div className="w-full">
      <Container className="!max-w-[1520px]">
        {/* Section Heading with large scale */}
        <SectionHeading
          eyebrow={content.eyebrow}
          title={content.title}
          description={content.description}
          className="!mb-8"
        />

        {/* 3 Step Sequence with circular arrow connectors */}
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center gap-4 sm:gap-5">
          {content.steps.map((step, index) => (
            <React.Fragment key={step.order}>
              <JourneyStepCard step={step} />

              {/* Connecting arrow separator in desktop */}
              {index < content.steps.length - 1 && (
                <div
                  className="hidden lg:flex items-center justify-center flex-shrink-0"
                  aria-hidden="true"
                >
                  <span className="w-9 h-9 rounded-full bg-white/[0.06] border border-white/[0.12] flex items-center justify-center text-[#8899aa]">
                    <IconArrowRight size={15} />
                  </span>
                </div>
              )}
            </React.Fragment>
          ))}
        </div>
      </Container>
    </div>
  );
};
