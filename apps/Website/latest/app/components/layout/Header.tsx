import React from "react";
import type { HeaderContent } from "../../content/types";
import { ButtonLink } from "../ui/Button";
import { IconDownload, HikatLogoSvg } from "../ui/Icons";
import { Container } from "../ui/Container";

export interface HeaderProps {
  content: HeaderContent;
}

export const Header: React.FC<HeaderProps> = ({ content }) => {
  return (
    <header className="w-full pt-4 sm:pt-6 px-4 sm:px-6 pointer-events-none">
      <Container className="!px-0">
        <nav
          className="pointer-events-auto flex items-center justify-between px-5 sm:px-7 py-3 sm:py-3.5 rounded-[26px] bg-[#121a22]/75 backdrop-blur-xl border border-white/[0.09] shadow-[0_12px_40px_rgba(0,0,0,0.6)] transition-all"
          aria-label="Navegación principal"
        >
          {/* Logo & Brand */}
          <a
            href="#hero"
            className="flex items-center gap-3.5 group select-none text-white focus:outline-none"
            aria-label={content.brandName}
          >
            {content.logoUrl ? (
              <img
                src={content.logoUrl}
                alt=""
                className="w-11 h-11 sm:w-12 sm:h-12 object-contain drop-shadow-[0_2px_10px_rgba(0,0,0,0.5)] transition-transform duration-200 group-hover:scale-105"
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
              />
            ) : (
              <HikatLogoSvg size={44} className="text-white" />
            )}
            <span className="text-2xl font-black tracking-tight text-white group-hover:text-white/90 transition-colors">
              {content.brandName}
            </span>
          </a>

          {/* Nav Items */}
          <ul className="hidden md:flex items-center gap-8 list-none m-0 p-0">
            {content.navItems.map((item, index) => {
              const isFirst = index === 0;
              return (
                <li key={item.id}>
                  <a
                    href={item.href}
                    className={`relative py-1.5 text-sm font-medium transition-colors select-none ${
                      isFirst
                        ? "text-white font-semibold"
                        : "text-[#8899aa] hover:text-white"
                    }`}
                  >
                    {item.label}
                    {isFirst && (
                      <span className="absolute bottom-0 left-0 right-0 h-[2.5px] rounded-full bg-gradient-to-r from-orange-500 to-amber-400 shadow-[0_0_8px_rgba(249,115,22,0.6)]" />
                    )}
                  </a>
                </li>
              );
            })}
          </ul>

          {/* CTA Action */}
          <div className="flex items-center gap-3">
            <ButtonLink
              variant="primary"
              href={content.ctaAction.href}
              icon={<IconDownload size={18} />}
              className="!py-2.5 !px-5 !text-xs sm:!text-sm !rounded-xl"
            >
              {content.ctaAction.label}
            </ButtonLink>
          </div>
        </nav>
      </Container>
    </header>
  );
};
