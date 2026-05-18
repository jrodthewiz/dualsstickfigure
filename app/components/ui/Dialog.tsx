"use client";

import React from 'react';

interface DialogProps {
  title?: string;
  message: string;
  onClose: () => void;
  type?: 'info' | 'warning' | 'error';
}

export function Dialog({ title = 'Message', message, onClose, type = 'info' }: DialogProps) {
  const icon = type === 'error' ? '✕' : type === 'warning' ? '⚠' : 'ℹ';
  
  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 20000,
        pointerEvents: 'auto'
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--grad-surface)',
          border: '3px outset var(--bevel-mid)',
          borderRadius: 0,
          minWidth: 320,
          maxWidth: 480,
          boxShadow: 'var(--shadow-window)',
          display: 'flex',
          flexDirection: 'column'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Title Bar */}
        <div
          style={{
            background: 'var(--grad-titlebar)',
            color: 'var(--neutral-white)',
            padding: '4px 8px',
            fontFamily: "'MS Sans Serif', 'Tahoma', sans-serif",
            fontSize: 11,
            fontWeight: 700,
            borderBottom: '1px solid var(--border-dark)',
            textShadow: '1px 1px 0 rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}
        >
          <span>{title}</span>
        </div>

        {/* Content */}
        <div style={{ padding: 16, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          {/* Icon */}
          <div
            style={{
              width: 32,
              height: 32,
              background: 'var(--grad-button)',
              border: '2px outset var(--bevel-mid)',
              borderRadius: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 20,
              flexShrink: 0,
              boxShadow: 'var(--shadow-raised)'
            }}
          >
            {icon}
          </div>

          {/* Message */}
          <div
            style={{
              flex: 1,
              color: 'var(--neutral-black)',
              fontFamily: "'MS Sans Serif', 'Tahoma', sans-serif",
              fontSize: 11,
              lineHeight: 1.5,
              paddingTop: 6
            }}
          >
            {message}
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '8px 16px 16px',
            display: 'flex',
            justifyContent: 'center'
          }}
        >
          <button
            onClick={onClose}
            autoFocus
            style={{
              padding: '6px 24px',
              fontSize: 11,
              fontFamily: "'MS Sans Serif', 'Tahoma', sans-serif",
              fontWeight: 700,
              cursor: 'pointer',
              border: '2px outset var(--bevel-mid)',
              borderRadius: 0,
              background: 'var(--grad-button)',
              color: 'var(--neutral-black)',
              boxShadow: 'var(--shadow-raised)',
              transition: 'none',
              minWidth: 80
            }}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

