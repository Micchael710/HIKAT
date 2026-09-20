export interface NavigationItem {
  id: string;
  label: string;
  href: string;
  isExternal?: boolean;
}

export interface HeaderContent {
  brandName: string;
  logoUrl?: string;
  navItems: NavigationItem[];
  ctaAction: {
    label: string;
    href: string;
    icon?: string;
  };
}

export interface HeroCard {
  id: string;
  badgeType: "launcher" | "skins" | "server" | "custom";
  badgeIcon: string;
  title: string;
  description: string;
  href: string;
}

export interface HeroContent {
  serverLogoUrl?: string;
  serverName: string;
  title: string;
  description: string;
  backgroundImage: string;
  primaryCta: {
    label: string;
    href: string;
  };
  secondaryCta: {
    label: string;
    href: string;
  };
  cards: HeroCard[];
}

export interface JourneyStep {
  order: number;
  badgeType: "launcher" | "skins" | "server" | "custom";
  badgeIcon: string;
  title: string;
  description: string;
}

export interface JourneyContent {
  sectionBackgroundImage?: string;
  sectionBackgroundPosition?: string;
  sectionFocusPosition?: string;
  sectionFocusSize?: string;
  eyebrow: string;
  title: string;
  description: string;
  steps: JourneyStep[];
  sideIllustrationUrl?: string;
}

export interface NewsItem {
  id: string;
  title: string;
  excerpt: string;
  date: string;
  imageUrl: string;
  href: string;
}

export interface NewsSectionContent {
  eyebrow: string;
  title: string;
  description: string;
  viewAllAction: {
    label: string;
    href: string;
  };
  items: NewsItem[];
  emptyMessage?: string;
}

export interface CommunityBenefit {
  id: string;
  icon: string;
  label: string;
}

export interface CommunityContent {
  eyebrow: string;
  title: string;
  description: string;
  ctaAction: {
    label: string;
    href: string;
  };
  backgroundImage?: string;
  benefits: CommunityBenefit[];
}

export interface FeatureItem {
  id: string;
  title: string;
  description: string;
  imageUrl: string;
  href: string;
}

export interface FeaturesSectionContent {
  title: string;
  description: string;
  viewAllAction: {
    label: string;
    href: string;
  };
  featured: {
    serverLogoUrl?: string;
    serverName: string;
    title: string;
    description: string;
    backgroundImage: string;
    ctaAction: {
      label: string;
      href: string;
    };
  };
  secondaryItems: FeatureItem[];
}

export interface FooterSocialLink {
  id: string;
  icon: string;
  href: string;
  label: string;
}

export interface FooterContent {
  brandName: string;
  copyright: string;
  socialLinks: FooterSocialLink[];
}

export interface WebsiteContent {
  header: HeaderContent;
  hero: HeroContent;
  journey: JourneyContent;
  news: NewsSectionContent;
  community: CommunityContent;
  features: FeaturesSectionContent;
  footer: FooterContent;
}
