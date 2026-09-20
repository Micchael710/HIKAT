import React from "react";
import type { FooterContent } from "../../content/types";
import { Container } from "../ui/Container";
import { HikatLogoSvg, IconDiscord } from "../ui/Icons";

export interface FooterProps {
  content: FooterContent;
}

export const Footer: React.FC<FooterProps> = ({ content }) => {
  return (
    <footer className="w-full border-t border-white/[0.08] bg-[#090d12]/90 backdrop-blur-lg py-8 mt-24">
      <Container>
        <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
          {/* Logo & Brand */}
          <div className="flex items-center gap-3">
            <HikatLogoSvg size={32} className="text-white" />
            <span className="text-lg font-bold tracking-tight text-white">
              {content.brandName}
            </span>
          </div>

          {/* Copyright */}
          <p className="text-xs sm:text-sm text-[#657788] text-center font-normal">
            {content.copyright}
          </p>

          {/* Social Links */}
          <div className="flex items-center gap-4">
            {content.socialLinks.map((social) => (
              <a
                key={social.id}
                href={social.href}
                target="_blank"
                rel="noreferrer noopener"
                aria-label={social.label}
                className="w-10 h-10 rounded-xl bg-white/[0.05] border border-white/[0.08] flex items-center justify-center text-[#8899aa] hover:text-white hover:border-white/20 hover:bg-white/[0.1] transition-all"
              >
                {social.icon === "discord" ? (
                  <IconDiscord size={20} />
                ) : (
                  <span>{social.label}</span>
                )}
              </a>
            ))}
          </div>
        </div>
      </Container>
    </footer>
  );
};
