import type { WebsiteContent } from "./types";

export const previewWebsiteContent: WebsiteContent = {
  header: {
    brandName: "HiKAT",
    logoUrl: "/assets/branding/logo-white.png",
    navItems: [
      { id: "inicio", label: "Inicio", href: "#hero" },
      { id: "novedades", label: "Novedades", href: "#novedades" },
      { id: "comunidad", label: "Comunidad", href: "#comunidad" },
    ],
    ctaAction: {
      label: "Descargar Launcher",
      href: "#descargar",
      icon: "download",
    },
  },
  hero: {
    serverLogoUrl: "/assets/launcher/apparatia-logo.png",
    serverName: "APPARATIA",
    title: "Un mundo de posibilidades",
    description:
      "Explora, crea, sobrevive y progresa en Apparatia. Únete a una comunidad industrial y creativa donde tu imaginación no tiene límites.",
    backgroundImage: "/assets/backgrounds/hero-home-bg.png",
    primaryCta: {
      label: "Descargar Launcher",
      href: "#descargar",
    },
    secondaryCta: {
      label: "Ver más",
      href: "#novedades",
    },
    cards: [
      {
        id: "launcher",
        badgeType: "launcher",
        badgeIcon: "A",
        title: "Launcher",
        description: "Accede de forma rápida y segura a todo el contenido de HiKAT.",
        href: "#descargar",
      },
      {
        id: "skins",
        badgeType: "skins",
        badgeIcon: "shirt",
        title: "Skins",
        description: "Personaliza tu identidad y destaca en el servidor.",
        href: "#skins",
      },
      {
        id: "servidor",
        badgeType: "server",
        badgeIcon: "server",
        title: "Servidor",
        description: "Vive la experiencia en nuestra comunidad de Apparatia.",
        href: "#servidor",
      },
    ],
  },
  journey: {
    sectionBackgroundImage: "/assets/backgrounds/journey-bg.jpg",
    sectionBackgroundPosition: "right 5% top",
    sectionFocusPosition: "right top",
    sectionFocusSize: "cover",
    eyebrow: "CONSTRUYE SIN LÍMITES",
    title: "Comienza tu aventura",
    description:
      "Descarga el launcher, personaliza tu identidad y únete a miles de jugadores en Apparátia. Es rápido, seguro y el primer paso hacia un mundo increíble.",
    steps: [
      {
        order: 1,
        badgeType: "launcher",
        badgeIcon: "A",
        title: "1. Descarga el launcher",
        description: "Accede de forma rápida, segura y gratuita.",
      },
      {
        order: 2,
        badgeType: "skins",
        badgeIcon: "shirt",
        title: "2. Personaliza tu perfil",
        description: "Elige tu skin, configura tu identidad y hazlo tuyo.",
      },
      {
        order: 3,
        badgeType: "server",
        badgeIcon: "server",
        title: "3. Entra al servidor",
        description: "Conéctate, conoce gente y vive grandes aventuras.",
      },
    ],
    sideIllustrationUrl: "/assets/backgrounds/journey-bg.jpg",
  },
  news: {
    eyebrow: "NOVEDADES",
    title: "Siempre algo nuevo en Apparatia",
    description:
      "Nuevas actualizaciones, eventos, construcciones y mucho más. Mantente al día con todo lo que sucede en nuestra comunidad.",
    viewAllAction: {
      label: "Ver todas",
      href: "#novedades",
    },
    items: [
      {
        id: "news-1",
        title: "Nuevas máquinas en Apparátia",
        excerpt: "Descubre las últimas adiciones del servidor.",
        date: "12 Abr, 2024",
        imageUrl: "/assets/news/news-aeronaves.png",
        href: "#news-1",
      },
      {
        id: "news-2",
        title: "Evento de automatización",
        excerpt: "Construye, optimiza y compite junto a la comunidad.",
        date: "28 Mar, 2024",
        imageUrl: "/assets/news/news-cimas.png",
        href: "#news-2",
      },
      {
        id: "news-3",
        title: "Actualización del servidor",
        excerpt: "Más estable, más contenido, más posibilidades.",
        date: "10 Mar, 2024",
        imageUrl: "/assets/news/news-heroes.png",
        href: "#news-3",
      },
    ],
    emptyMessage: "No hay novedades disponibles en este momento.",
  },
  community: {
    eyebrow: "UNA COMUNIDAD DE CREADORES",
    title: "Comunidad",
    description:
      "Construye máquinas, automatiza procesos, explora nuevas tecnologías y forma parte de una comunidad que convierte ideas en grandes proyectos.",
    ctaAction: {
      label: "Únete a la comunidad",
      href: "https://discord.gg",
    },
    backgroundImage: "/assets/backgrounds/journey-bg.jpg",
    benefits: [
      {
        id: "b1",
        icon: "gear",
        label: "Construye\ny automatiza",
      },
      {
        id: "b2",
        icon: "bars",
        label: "Progresa\nen comunidad",
      },
      {
        id: "b3",
        icon: "users",
        label: "Comparte\ntus creaciones",
      },
    ],
  },
  features: {
    title: "¿Qué puedes hacer en HiKAT?",
    description:
      "Explora un mundo de posibilidades y vive una experiencia única junto a miles de jugadores en Apparatia.",
    viewAllAction: {
      label: "Ver todo",
      href: "#features",
    },
    featured: {
      serverLogoUrl: "/assets/launcher/apparatia-logo.png",
      serverName: "EXPLORA APPARATIA",
      title: "Un mundo de aventuras te espera",
      description:
        "Descubre biomas únicos, construye, sobrevive, haz amigos y forma parte de una comunidad que no deja de crecer.",
      backgroundImage: "/assets/backgrounds/hero-home-bg.png",
      ctaAction: {
        label: "Descargar Launcher",
        href: "#descargar",
      },
    },
    secondaryItems: [
      {
        id: "feat-launcher",
        title: "Launcher oficial",
        description: "Accede de forma rápida, segura y sencilla a todo el contenido de HiKAT.",
        imageUrl: "/assets/branding/logo-reduced-white.png",
        href: "#launcher",
      },
      {
        id: "feat-skins",
        title: "Skins y cosméticos",
        description: "Personaliza tu identidad y destaca en la comunidad con skins, capas y mucho más.",
        imageUrl: "/assets/launcher/default-avatar.png",
        href: "#skins",
      },
      {
        id: "feat-server",
        title: "Servidor y comunidad",
        description: "Vive una experiencia única junto a miles de jugadores. Construye, colabora y forma parte de algo grande.",
        imageUrl: "/assets/news/news-tierras.png",
        href: "#servidor",
      },
    ],
  },
  footer: {
    brandName: "HiKAT",
    copyright: "© 2024 HiKAT Community. Todos los derechos reservados.",
    socialLinks: [
      {
        id: "discord",
        icon: "discord",
        href: "https://discord.gg",
        label: "Discord Oficial de HiKAT",
      },
    ],
  },
};
