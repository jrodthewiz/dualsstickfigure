"use client";

import React, { useState } from 'react';
import type { MapConfig } from '../../types/Maps';
import { AVAILABLE_MAPS } from '../../types/Maps';

interface MapSelectionProps {
  selectedMapId: string;
  onMapSelect: (mapId: string) => void;
  isHost: boolean;
}

// Compact blood splatter for mini cards
const MiniBloodSplatter = ({ intensity = 1 }: { intensity?: number }) => (
  <svg
    viewBox="0 0 200 200"
    style={{
      position: 'absolute',
      width: `${80 * intensity}px`,
      height: `${80 * intensity}px`,
      opacity: 0.12,
    }}
  >
    <g fill="#66ccff" fillOpacity="0.5">
      <circle cx="100" cy="100" r="30" />
      <circle cx="70" cy="80" r="15" />
      <circle cx="130" cy="85" r="12" />
      <circle cx="80" cy="130" r="10" />
    </g>
  </svg>
);

// Compact map card for lobby
const CompactMapCard = ({
  map,
  isSelected,
  isHost,
  onSelect,
}: {
  map: MapConfig;
  isSelected: boolean;
  isHost: boolean;
  onSelect: () => void;
}) => {
  const [isHovered, setIsHovered] = useState(false);

  const getThemeColor = (mapId: string) => {
    return { primary: '#66ccff', accent: '#9bdcff', light: '#c8c8c8' };
  };

  const colors = getThemeColor(map.id);

  return (
    <button
      onClick={() => isHost && onSelect()}
      disabled={!isHost}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        position: 'relative',
        padding: '12px',
        background: isSelected ? 'rgba(102,204,255,0.08)' : 'rgba(255,255,255,0.02)',
        border: isSelected
          ? `2px solid ${colors.primary}`
          : isHovered
            ? `1.5px solid ${colors.accent}`
            : '1px solid var(--border-soft)',
        borderRadius: 12,
        cursor: isHost ? 'pointer' : 'not-allowed',
        transition: 'all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)',
        opacity: isHost ? 1 : 0.6,
        textAlign: 'left',
        boxShadow: isSelected
          ? `0 0 20px ${colors.primary}40, inset 0 0 15px ${colors.primary}20`
          : isHovered
            ? `0 4px 16px ${colors.accent}30`
            : '0 2px 8px rgba(0, 0, 0, 0.5)',
        transform: isSelected
          ? 'translateY(-2px) scale(1.01)'
          : isHovered
            ? 'translateY(-1px) scale(1.005)'
            : 'translateY(0)',
      }}
    >
      {/* Map Preview - Mini */}
      <div
        style={{
          position: 'relative',
          width: '100%',
          height: 70,
          background: `linear-gradient(135deg, ${map.theme?.primaryColor || '#333'}, ${map.theme?.accentColor || '#555'})`,
          borderRadius: 8,
          marginBottom: 8,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: `1px solid ${isSelected ? colors.primary : 'var(--border-soft)'}`,
          overflow: 'hidden',
        }}
      >
        {/* Background icon */}
        <div
          style={{
            color: 'rgba(255,255,255,0.3)',
            fontFamily: "'Rajdhani', ui-monospace",
            fontSize: 32,
            fontWeight: 700,
          }}
        >
          {map.id === 'suburban-day' ? '🏘️' : map.id === 'rooftop-sunset' ? '🌆' : '🏙️'}
        </div>

        {/* Overlay gradient */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: isHovered
              ? `linear-gradient(135deg, ${colors.primary}15, ${colors.accent}10)`
              : 'transparent',
            transition: 'all 0.2s ease',
            pointerEvents: 'none',
          }}
        />

        {/* Blood splatter */}
        {isSelected && (
          <div style={{ position: 'absolute', bottom: 2, right: 2 }}>
            <MiniBloodSplatter intensity={0.6} />
          </div>
        )}
      </div>

      {/* Map Name */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 6,
        }}
      >
        <div
          style={{
            color: isSelected ? colors.primary : 'var(--neutral-050)',
            fontFamily: "'Rajdhani', ui-monospace",
            fontSize: 12,
            fontWeight: 900,
            letterSpacing: 0.5,
            transition: 'color 0.2s ease',
            textShadow: isSelected ? `0 0 10px ${colors.primary}80` : 'none',
          }}
        >
          {map.displayName}
        </div>

        {/* Selection indicator */}
        {isSelected && (
          <div
            style={{
              width: 16,
              height: 16,
              borderRadius: '50%',
              background: colors.primary,
              border: '2px solid var(--neutral-white)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: `0 0 12px ${colors.primary}`,
              fontSize: 10,
              fontWeight: 900,
              color: 'var(--neutral-black)',
              animation: 'mini-pulse 2s ease-in-out infinite',
            }}
          >
            ✓
          </div>
        )}
      </div>

      {/* Quick stats */}
      <div
        style={{
          display: 'flex',
          gap: 6,
          fontSize: 9,
          fontFamily: "'Rajdhani', ui-monospace",
          fontWeight: 700,
          color: 'var(--neutral-300)',
        }}
      >
        <span>⚡{map.gravity || 1200}</span>
        <span>📍{map.spawnPoints?.length || 4}</span>
      </div>
    </button>
  );
};

export function MapSelection({ selectedMapId, onMapSelect, isHost }: MapSelectionProps) {
  const selectedMap = AVAILABLE_MAPS.find((m) => m.id === selectedMapId);

  return (
    <div
      style={{
        background: 'var(--neutral-900)',
        border: '1.5px solid var(--border-soft)',
        borderRadius: 12,
        padding: '16px',
        marginBottom: 20,
        boxShadow: 'inset 0 1px 0 var(--bevel-light), inset 0 -1px 0 var(--bevel-dark)'
      }}
    >
      {/* Header */}
      <div
        style={{
          color: 'var(--neutral-050)',
          fontFamily: "'Rajdhani', ui-monospace",
          fontSize: 13,
          fontWeight: 900,
          marginBottom: 12,
          letterSpacing: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span style={{ color: 'var(--accent-primary)' }}>🗺️ MAP SELECTION</span>
        {!isHost && (
          <span
            style={{
              fontSize: 9,
              color: 'var(--accent-primary)',
              fontWeight: 700,
              letterSpacing: 0.5,
            }}
          >
            (HOST ONLY)
          </span>
        )}
      </div>

      {/* Map Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
          gap: 10,
          marginBottom: 12,
        }}
      >
        {AVAILABLE_MAPS.map((map) => (
          <CompactMapCard
            key={map.id}
            map={map}
            isSelected={selectedMapId === map.id}
            isHost={isHost}
            onSelect={() => onMapSelect(map.id)}
          />
        ))}
      </div>

      {/* Selected Map Info */}
      {selectedMap && (
        <div
          style={{
            background: 'var(--neutral-900)',
            border: '1px solid var(--border-soft)',
            borderRadius: 8,
            padding: '12px',
            transition: 'all 0.2s ease',
          }}
        >
          <div
            style={{
              color: 'var(--accent-primary)',
              fontFamily: "'Rajdhani', ui-monospace",
              fontSize: 11,
              fontWeight: 900,
              marginBottom: 4,
              letterSpacing: 0.5,
            }}
          >
            {selectedMap.displayName}
          </div>
          <div
            style={{
              color: 'var(--neutral-300)',
              fontFamily: "'Rajdhani', ui-monospace",
              fontSize: 10,
              lineHeight: 1.4,
            }}
          >
            {selectedMap.description}
          </div>
        </div>
      )}

      {/* Animations */}
      <style>{`
        @keyframes mini-pulse {
          0%, 100% {
            transform: scale(1);
            box-shadow: 0 0 12px currentColor;
          }
          50% {
            transform: scale(1.15);
            box-shadow: 0 0 20px currentColor;
          }
        }
      `}</style>
    </div>
  );
}

