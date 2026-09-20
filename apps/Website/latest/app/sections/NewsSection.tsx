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
      className="group flex items-center gap-4 p-3 rounded-2xl bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.06] hover:border-white/20 transition-all duration-200"
    >
      <div className="w-24 h-20 sm:w-28 sm:h-20 rounded-xl overflow-hidden flex-shrink-0 bg-[#0e151b] border border-white/[0.08]">
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
        <h4 className="text-sm sm:text-base font-bold text-white group-hover:text-white transition-colors truncate">
          {item.title}
        </h4>
        <p className="text-xs text-[#8899aa] line-clamp-1 leading-snug">
          {item.excerpt}
        </p>
        <span className="inline-block text-[11px] font-medium text-[#657788]">
          {item.date}
        </span>
      </div>
    </a>
  );
};

export const NewsSection: React.FC<NewsSectionProps> = ({ content }) => {
  return (
    <Card className="h-full p-6 sm:p-8 flex flex-col justify-between">
      <div className="space-y-6">
        {/* Header with eyebrow & view all action */}
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

        {/* Heading & Description */}
        <div className="space-y-2">
          <h3 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
            {content.title}
          </h3>
          <p className="text-xs sm:text-sm text-[#8899aa] leading-relaxed">
            {content.description}
          </p>
        </div>

        {/* News List or Empty State */}
        <div className="space-y-3">
          {content.items && content.items.length > 0 ? (
            content.items.map((item) => (
              <NewsCardItem key={item.id} item={item} />
            ))
          ) : (
            <div className="py-12 text-center text-[#657788] text-sm">
              {content.emptyMessage || "No hay novedades disponibles."}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
};
