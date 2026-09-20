import React from "react";
import { ButtonLink } from "./Button";
import { IconArrowRight } from "./Icons";

export interface SectionHeadingProps {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: {
    label: string;
    href: string;
  };
  align?: "left" | "center";
  className?: string;
}

export const SectionHeading: React.FC<SectionHeadingProps> = ({
  eyebrow,
  title,
  description,
  action,
  align = "left",
  className = "",
}) => {
  return (
    <div
      className={`flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8 ${className}`}
    >
      <div className={`space-y-2.5 ${align === "center" ? "text-center mx-auto" : "max-w-3xl"}`}>
        {eyebrow && (
          <div className="inline-flex items-center gap-2">
            <span className="w-4 h-[3px] rounded-full bg-orange-500" />
            <span className="text-xs font-bold uppercase tracking-widest text-orange-400">
              {eyebrow}
            </span>
          </div>
        )}
        <h2 className="text-3xl sm:text-4xl lg:text-[40px] font-extrabold tracking-tight text-white leading-tight">
          {title}
        </h2>
        {description && (
          <p className="text-[#8899aa] text-sm sm:text-base leading-relaxed max-w-2xl font-normal">
            {description}
          </p>
        )}
      </div>

      {action && (
        <div className="flex-shrink-0">
          <ButtonLink
            variant="secondary"
            href={action.href}
            className="!px-4 !py-2 !text-xs !rounded-xl !gap-2 text-white/90 hover:text-white"
          >
            <span>{action.label}</span>
            <IconArrowRight size={14} />
          </ButtonLink>
        </div>
      )}
    </div>
  );
};
