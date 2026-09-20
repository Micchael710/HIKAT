import React, { useState, useEffect } from "react";
import type { HeaderContent } from "../../content/types";
import { ButtonLink } from "../ui/Button";
import { IconDownload, HikatLogoSvg } from "../ui/Icons";
import { Container } from "../ui/Container";

export interface HeaderProps {
  content: HeaderContent;
}

export const Header: React.FC<HeaderProps> = ({ content }) => {
  const [activeSection, setActiveSection] = useState<string>("inicio");

  useEffect(() => {
    const handleScroll = () => {
      const sections = ["hero", "novedades", "comunidad", "features"];
      const scrollPosition = window.scrollY + 200;

      for (const sectionId of sections) {
        const el = document.getElementById(sectionId);
        if (el) {
          const top = el.offsetTop;
          const height = el.offsetHeight;
          if (scrollPosition >= top && scrollPosition < top + height) {
            setActiveSection(sectionId === "hero" ? "inicio" : sectionId);
            break;
          }
        }
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 pt-3 sm:pt-4 px-4 sm:px-6 pointer-events-none">
      <Container className="!px-0">
        <nav
          className="pointer-events-auto flex items-center justify-between px-4 sm:px-6 py-2.5 sm:py-3 rounded-[24px] bg-[#121a22]/75 backdrop-blur-xl border border-white/[0.09] shadow-[0_12px_40px_rgba(0,0,0,0.6)] transition-all"
          aria-label="Navegación principal"
        >
          {/* Logo & Brand */}
          <a
            href="#hero"
            className="flex items-center gap-3 group select-none text-white focus:outline-none"
            aria-label={content.brandName}
          >
            {content.logoUrl ? (
              <img
                src={content.logoUrl}
                alt=""
                className="w-9 h-9 object-contain drop-shadow-[0_2px_8px_rgba(0,0,0,0.4)]"
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
              />
            ) : (
              <HikatLogoSvg size={36} className="text-white" />
            )}
            <span className="text-xl font-extrabold tracking-tight text-white group-hover:text-white/90 transition-colors">
              {content.brandName}
            </span>
          </a>

          {/* Nav Items */}
          <ul className="hidden md:flex items-center gap-8 list-none m-0 p-0">
            {content.navItems.map((item) => {
              const isActive = activeSection === item.id;
              return (
                <li key={item.id}>
                  <a
                    href={item.href}
                    className={`relative py-1.5 text-sm font-medium transition-colors select-none ${
                      isActive
                        ? "text-white font-semibold"
                        : "text-[#8899aa] hover:text-white"
                    }`}
                  >
                    {item.label}
                    {isActive && (
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
