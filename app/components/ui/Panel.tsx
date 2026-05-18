"use client";

import React from "react";

type PanelProps = React.PropsWithChildren<{
  style?: React.CSSProperties;
  className?: string;
  title?: string;
}>;

export function Panel({ children, style, className, title }: PanelProps) {
  return (
    <div
      className={className}
      style={{
        background: "var(--grad-surface)",
        border: "2px outset var(--bevel-mid)",
        borderRadius: 0,
        boxShadow: "var(--shadow-window)",
        color: "var(--neutral-black)",
        fontFamily: "'MS Sans Serif', 'Tahoma', sans-serif",
        fontSize: 11,
        ...style,
      }}
    >
      {title && (
        <div
          style={{
            background: "var(--grad-titlebar)",
            color: "var(--neutral-white)",
            padding: "3px 6px",
            fontWeight: 700,
            fontSize: 11,
            borderBottom: "1px solid var(--border-dark)",
            display: "flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          {title}
        </div>
      )}
      <div style={{ padding: title ? 8 : 0 }}>
        {children}
      </div>
    </div>
  );
}


