import React from "react";

interface CardProps {
  children: React.ReactNode;
  className?: string;
  interactive?: boolean;
  onClick?: () => void;
  style?: React.CSSProperties;
}

export const Card: React.FC<CardProps> = ({
  children,
  className = "",
  interactive = false,
  onClick,
  style,
}) => {
  const baseClasses =
    "hikat-glass-card relative overflow-hidden rounded-[22px] border border-white/[0.09] bg-[#121a22]/80 backdrop-blur-xl shadow-[0_8px_30px_rgba(0,0,0,0.45)]";
  const interactiveClasses = interactive
    ? "hikat-glass-card-interactive cursor-pointer hover:border-white/25 transition-all duration-200"
    : "";

  return (
    <div
      className={`${baseClasses} ${interactiveClasses} ${className}`}
      onClick={onClick}
      style={style}
    >
      {children}
    </div>
  );
};
