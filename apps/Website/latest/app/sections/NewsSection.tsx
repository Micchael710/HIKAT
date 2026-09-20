import React from "react";
import type { NewsSectionContent, NewsItem as NewsItemType } from "../content/types";
import { Card } from "../components/ui/Card";
import { IconArrowRight } from "../components/ui/Icons";

export interface NewsSectionProps {
  content: NewsSectionContent;
}

const NewsCardItem: React.FC<{ item: NewsItemType }> = ({ item }) => {
  return (
    <a
      href={item.href}
      className="group flex items-center gap-3.5 p-2.5 sm:p-3 rounded-xl bg-white/[0.03] hover:bg-white/[0.08] border border-white/[0.06] hover:border-white/20 transition-all duration-200"
    >
      <div className="w-20 h-16 sm:w-24 sm:h-18 rounded-lg overflow-hidden flex-shrink-0 bg-[#090d12] border border-white/[0.08]">
        <img
          src={item.imageUrl}
          alt={item.title}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          onError={(e) => {
            e.currentTarget.style.opacity = "0.3";
          }}
        />
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <h4 className="text-xs sm:text-sm font-bold text-white group-hover:text-white transition-colors truncate">
          {item.title}
        </h4>
        <p className="text-[11px] sm:text-xs text-[#8899aa] line-clamp-1 leading-snug">
          {item.excerpt}
        </p>
        <span className="inline-block text-[10px] font-medium text-[#657788]">
          {item.date}
        </span>
      </div>
    </a>
  );
};

export const NewsSection: React.FC<NewsSectionProps> = ({ content }) => {
  return (
    <Card className="h-full p-6 sm:p-8 flex flex-col justify-between bg-[#121a22]/75 backdrop-blur-xl border-white/[0.1] shadow-[0_8px_30px_rgba(0,0,0,0.45)]">
      <div className="space-y-6">
        {/* Top Header Bar: Eyebrow on left, View All on right */}
        <div className="flex items-center justify-between gap-4">
          <div className="inline-flex items-center gap-2">
            <span className="w-3.5 h-[2.5px] rounded-full bg-orange-500" />
            <span className="text-[11px] font-bold uppercase tracking-widest text-orange-400">
              {content.eyebrow}
            </span>
          </div>

          <a
            href={content.viewAllAction.href}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#8899aa] hover:text-white transition-colors"
          >
            <span>{content.viewAllAction.label}</span>
            <IconArrowRight size={12} />
          </a>
        </div>

        {/* 2-Column Split inside News Card: Left Heading/Description, Right News Stack */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
          {/* Left Column: Heading & Description */}
          <div className="md:col-span-5 space-y-3">
            <h3 className="text-2xl sm:text-3xl font-black tracking-tight text-white leading-tight">
              {content.title}
            </h3>
            <p className="text-xs sm:text-sm text-[#8899aa] leading-relaxed font-normal">
              {content.description}
            </p>
          </div>

          {/* Right Column: 3 News items */}
          <div className="md:col-span-7 space-y-3">
            {content.items && content.items.length > 0 ? (
              content.items.map((item) => (
                <NewsCardItem key={item.id} item={item} />
              ))
            ) : (
              <div className="py-8 text-center text-[#657788] text-xs">
                {content.emptyMessage || "No hay novedades disponibles."}
              </div>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
};
