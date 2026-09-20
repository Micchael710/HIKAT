import React from "react";

export type ButtonVariant = "primary" | "secondary" | "circle-arrow" | "ghost";

interface BaseButtonProps {
  variant?: ButtonVariant;
  icon?: React.ReactNode;
  trailingIcon?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  "aria-label"?: string;
}

export interface ButtonProps
  extends BaseButtonProps,
    React.ButtonHTMLAttributes<HTMLButtonElement> {}

export interface ButtonLinkProps
  extends BaseButtonProps,
    React.AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
}

const getVariantClasses = (variant: ButtonVariant = "primary"): string => {
  switch (variant) {
    case "primary":
      return "btn-primary-orange inline-flex items-center justify-center gap-2.5 px-6 py-3 rounded-2xl text-sm font-semibold tracking-tight select-none cursor-pointer";
    case "secondary":
      return "btn-secondary-glass inline-flex items-center justify-center gap-2.5 px-6 py-3 rounded-2xl text-sm font-semibold tracking-tight select-none cursor-pointer";
    case "circle-arrow":
      return "btn-circle-arrow w-10 h-10 select-none cursor-pointer";
    case "ghost":
      return "inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white/80 hover:text-white transition-colors select-none cursor-pointer";
    default:
      return "btn-primary-orange inline-flex items-center justify-center gap-2.5 px-6 py-3 rounded-2xl text-sm font-semibold tracking-tight select-none cursor-pointer";
  }
};

export const Button: React.FC<ButtonProps> = ({
  variant = "primary",
  icon,
  trailingIcon,
  children,
  className = "",
  type = "button",
  ...props
}) => {
  return (
    <button
      type={type}
      className={`${getVariantClasses(variant)} ${className}`}
      {...props}
    >
      {icon && <span className="flex-shrink-0">{icon}</span>}
      {children && <span className="whitespace-nowrap">{children}</span>}
      {trailingIcon && <span className="flex-shrink-0">{trailingIcon}</span>}
    </button>
  );
};

export const ButtonLink: React.FC<ButtonLinkProps> = ({
  variant = "primary",
  icon,
  trailingIcon,
  children,
  className = "",
  href,
  ...props
}) => {
  return (
    <a
      href={href}
      className={`${getVariantClasses(variant)} ${className}`}
      {...props}
    >
      {icon && <span className="flex-shrink-0">{icon}</span>}
      {children && <span className="whitespace-nowrap">{children}</span>}
      {trailingIcon && <span className="flex-shrink-0">{trailingIcon}</span>}
    </a>
  );
};
