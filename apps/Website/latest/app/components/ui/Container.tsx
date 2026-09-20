import React from "react";

interface ContainerProps {
  children: React.ReactNode;
  className?: string;
  id?: string;
}

export const Container: React.FC<ContainerProps> = ({
  children,
  className = "",
  id,
}) => {
  return (
    <div
      id={id}
      className={`w-full max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-10 xl:px-12 ${className}`}
    >
      {children}
    </div>
  );
};
