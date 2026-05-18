"use client";

import React, { useState, useEffect, useRef } from 'react';

interface PromptDialogProps {
  title?: string;
  message: string;
  placeholder?: string;
  defaultValue?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

export function PromptDialog({ 
  title = 'Input Required', 
  message, 
  placeholder = '',
  defaultValue = '',
  onConfirm, 
  onCancel 
}: PromptDialogProps) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Auto-focus the input when dialog opens
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (value.trim()) {
      onConfirm(value.trim());
    }
  };

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
      onClick={onCancel}
    >
      <div
        style={{
          background: 'var(--grad-surface)',
          border: '3px outset var(--bevel-mid)',
          borderRadius: 0,
          minWidth: 360,
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
        <form onSubmit={handleSubmit}>
          <div style={{ padding: 16 }}>
            {/* Message */}
            <div
              style={{
                color: 'var(--neutral-black)',
                fontFamily: "'MS Sans Serif', 'Tahoma', sans-serif",
                fontSize: 11,
                lineHeight: 1.5,
                marginBottom: 12
              }}
            >
              {message}
            </div>

            {/* Input */}
            <input
              ref={inputRef}
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={placeholder}
              style={{
                width: '100%',
                padding: '4px 6px',
                background: 'var(--neutral-white)',
                border: '2px inset var(--bevel-mid)',
                borderRadius: 0,
                color: 'var(--neutral-black)',
                fontFamily: "'MS Sans Serif', 'Tahoma', sans-serif",
                fontSize: 11,
                outline: 'none',
                boxShadow: 'var(--shadow-sunken)',
                boxSizing: 'border-box'
              }}
            />
          </div>

          {/* Footer */}
          <div
            style={{
              padding: '8px 16px 16px',
              display: 'flex',
              justifyContent: 'center',
              gap: 8
            }}
          >
            <button
              type="submit"
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
            <button
              type="button"
              onClick={onCancel}
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
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

