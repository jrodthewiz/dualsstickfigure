"use client";

import React from "react";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "accent" | "danger" | "ghost";
  fullWidth?: boolean;
};

export function Button({ variant = "default", fullWidth, style, ...props }: ButtonProps) {
  const base: React.CSSProperties = {
    padding: "8px 16px",
    borderRadius: 0,
    fontFamily: "'MS Sans Serif', 'Tahoma', sans-serif",
    fontWeight: 700,
    fontSize: 11,
    letterSpacing: 0,
    cursor: props.disabled ? "not-allowed" : "pointer",
    transition: "none",
    width: fullWidth ? "100%" : undefined,
    background: "var(--grad-button)",
    color: "var(--neutral-black)",
    border: "1px solid var(--border-dark)",
    boxShadow: "var(--shadow-raised)",
    textShadow: "none",
  };

  const variants: Record<string, React.CSSProperties> = {
    default: {},
    accent: {
      background: "var(--grad-titlebar)",
      color: "var(--neutral-white)",
      border: "1px solid var(--border-dark)",
      boxShadow: "var(--shadow-raised)",
      fontWeight: 700,
    },
    danger: {
      background: "var(--grad-button)",
      color: "var(--error)",
      border: "1px solid var(--border-dark)",
      boxShadow: "var(--shadow-raised)",
    },
    ghost: {
      background: "transparent",
      border: "1px solid var(--border-soft)",
      color: "var(--neutral-300)",
      boxShadow: "none",
    },
  };

  const hoverStyles: React.CSSProperties = variant === "default" || variant === "danger" ? {
    background: "var(--grad-button-hover)",
  } : variant === "accent" ? {
    background: "linear-gradient(180deg, #4a7eb5 0%, #2f5d8a 100%)",
  } : {};

  const activeStyles: React.CSSProperties = {
    boxShadow: "var(--shadow-sunken)",
    background: "var(--grad-button-active)",
  };

  return (
    <button
      {...props}
      style={{
        ...base,
        ...variants[variant],
        ...(props.disabled
          ? { opacity: 0.5, cursor: "not-allowed" }
          : {}),
        ...style,
      }}
      onMouseEnter={(e) => {
        if (!props.disabled && variant !== "ghost") {
          Object.assign(e.currentTarget.style, hoverStyles);
        }
      }}
      onMouseLeave={(e) => {
        if (!props.disabled) {
          e.currentTarget.style.background = variants[variant]?.background || base.background;
        }
      }}
      onMouseDown={(e) => {
        if (!props.disabled) {
          Object.assign(e.currentTarget.style, activeStyles);
        }
      }}
      onMouseUp={(e) => {
        if (!props.disabled) {
          e.currentTarget.style.boxShadow = variants[variant]?.boxShadow || base.boxShadow;
          e.currentTarget.style.background = variants[variant]?.background || base.background;
        }
      }}
    />
  );
}


