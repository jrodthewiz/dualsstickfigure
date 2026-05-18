"use client";

import React, { useState } from 'react';
import { Button } from '../ui/Button';
import { AVAILABLE_MAPS } from '../../types/Maps';
import type { ConnectedPlayer } from '../../types/Multiplayer';

interface MapSelectionScreenProps {
  selectedMapId: string;
  onMapSelect: (mapId: string) => void;
  onConfirm: () => void;
  isHost: boolean;
  connectedPlayers: ConnectedPlayer[];
  sessionId: string | null;
}

// Map preview card component
const MapCard = ({
  map,
  isSelected,
  isHost,
  onSelect,
}: {
  map: any;
  isSelected: boolean;
  isHost: boolean;
  onSelect: () => void;
}) => {
  const [isHovered, setIsHovered] = useState(false);

  const getMapPreviewContent = (mapId: string) => {
    switch (mapId) {
      case 'suburban-day':
        return (
          <svg viewBox="0 0 500 280" style={{ width: '100%', height: '100%' }}>
            <defs>
              <linearGradient id="suburbanSky" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" style={{ stopColor: '#87CEEB', stopOpacity: 1 }} />
                <stop offset="100%" style={{ stopColor: '#B0E0E6', stopOpacity: 1 }} />
              </linearGradient>
              <filter id="bloodDrip">
                <feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="3" result="noise" />
                <feDisplacementMap in="SourceGraphic" in2="noise" scale="3" xChannelSelector="R" yChannelSelector="G" />
              </filter>
            </defs>

            {/* Sky */}
            <rect width="500" height="200" fill="url(#suburbanSky)" />

            {/* Sun */}
            <circle cx="420" cy="50" r="35" fill="#FFD700" opacity="0.9" />

            {/* Ground with texture */}
            <rect y="200" width="500" height="80" fill="#7CB342" />
            <rect y="210" width="500" height="5" fill="#689F38" />

            {/* Left house platform */}
            <rect x="40" y="155" width="120" height="45" fill="#8B4513" rx="4" />
            <rect x="40" y="150" width="120" height="5" fill="#A0522D" />
            
            {/* Right house platform */}
            <rect x="340" y="140" width="130" height="60" fill="#A0522D" rx="4" />
            <rect x="340" y="135" width="130" height="5" fill="#8B4513" />

            {/* Center elevated platform */}
            <rect x="190" y="170" width="120" height="12" fill="#CD853F" rx="2" />
            <rect x="190" y="168" width="120" height="2" fill="#DEB887" />

            {/* Battle damage - blood splatters */}
            <ellipse cx="80" cy="140" rx="25" ry="35" fill="#8B0000" opacity="0.6" />
            <ellipse cx="90" cy="120" rx="18" ry="28" fill="#DC143C" opacity="0.5" />
            <path d="M 100 100 Q 110 90 115 75 Q 120 60 110 50" stroke="#8B0000" strokeWidth="3" fill="none" opacity="0.4" />
            
            <circle cx="420" cy="145" r="12" fill="#DC143C" opacity="0.5" />
            <circle cx="435" cy="155" r="8" fill="#8B0000" opacity="0.4" />
            <circle cx="410" cy="160" r="10" fill="#DC143C" opacity="0.35" />

            {/* Ground impact marks */}
            <circle cx="250" cy="215" r="20" fill="#333333" opacity="0.15" />
            <circle cx="250" cy="215" r="15" fill="none" stroke="#333333" strokeWidth="1" opacity="0.2" />
          </svg>
        );

      case 'rooftop-sunset':
        return (
          <svg viewBox="0 0 500 280" style={{ width: '100%', height: '100%' }}>
            <defs>
              <linearGradient id="sunsetSky" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" style={{ stopColor: '#1a1a2e', stopOpacity: 1 }} />
                <stop offset="40%" style={{ stopColor: '#ff6b35', stopOpacity: 1 }} />
                <stop offset="100%" style={{ stopColor: '#f7931e', stopOpacity: 1 }} />
              </linearGradient>
              <radialGradient id="sunGlow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" style={{ stopColor: '#FFA500', stopOpacity: 0.8 }} />
                <stop offset="100%" style={{ stopColor: '#FF6347', stopOpacity: 0.3 }} />
              </radialGradient>
            </defs>

            {/* Sky */}
            <rect width="500" height="280" fill="url(#sunsetSky)" />

            {/* Sun on horizon */}
            <circle cx="250" cy="160" r="50" fill="url(#sunGlow)" />

            {/* Far building */}
            <rect x="30" y="110" width="80" height="140" fill="#0d0d0d" />
            
            {/* Main rooftop platform (left) */}
            <rect x="50" y="100" width="90" height="20" fill="#2a2a2a" rx="2" />
            <rect x="50" y="98" width="90" height="2" fill="#444444" />

            {/* Center rooftop platform */}
            <rect x="170" y="80" width="160" height="24" fill="#333333" rx="3" />
            <rect x="170" y="77" width="160" height="3" fill="#555555" />

            {/* Right rooftop platform */}
            <rect x="380" y="110" width="100" height="20" fill="#2a2a2a" rx="2" />
            <rect x="380" y="108" width="100" height="2" fill="#444444" />

            {/* Far right building */}
            <rect x="410" y="90" width="70" height="160" fill="#0d0d0d" />

            {/* Dramatic blood splatters from combat */}
            <g opacity="0.7">
              <ellipse cx="100" cy="70" rx="35" ry="45" fill="#C41E3A" />
              <circle cx="75" cy="50" r="20" fill="#8B0000" />
              <circle cx="130" cy="45" r="18" fill="#DC143C" />
              <path d="M 95 25 L 100 10 L 105 25 Z" fill="#8B0000" />
            </g>

            {/* Blood trails */}
            <path d="M 250 70 Q 245 85 242 100" stroke="#8B0000" strokeWidth="8" fill="none" opacity="0.5" strokeLinecap="round" />
            <path d="M 260 72 Q 268 88 275 105" stroke="#DC143C" strokeWidth="6" fill="none" opacity="0.4" strokeLinecap="round" />

            {/* Impact crater on rooftop */}
            <circle cx="320" cy="95" r="18" fill="none" stroke="#444444" strokeWidth="2" opacity="0.6" />
            <circle cx="320" cy="95" r="12" fill="#1a1a1a" opacity="0.5" />
          </svg>
        );

      case 'city-platformer':
      default:
        return (
          <svg viewBox="0 0 500 280" style={{ width: '100%', height: '100%' }}>
            <defs>
              <linearGradient id="cityBg" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" style={{ stopColor: '#0a0a15', stopOpacity: 1 }} />
                <stop offset="50%" style={{ stopColor: '#1a1a3e', stopOpacity: 1 }} />
                <stop offset="100%" style={{ stopColor: '#0f2438', stopOpacity: 1 }} />
              </linearGradient>
            </defs>

            {/* Background */}
            <rect width="500" height="280" fill="url(#cityBg)" />

            {/* Neon accents */}
            <rect x="80" y="10" width="15" height="180" fill="#00ff88" opacity="0.15" />
            <rect x="78" y="10" width="19" height="180" fill="none" stroke="#00ff88" strokeWidth="1" opacity="0.3" />

            {/* Left building platform */}
            <rect x="20" y="140" width="100" height="22" fill="#1a3a52" rx="2" />
            <rect x="20" y="135" width="100" height="5" fill="#2a5a72" />
            <rect x="25" y="150" width="12" height="12" fill="#00ff88" opacity="0.6" />
            <rect x="45" y="150" width="12" height="12" fill="#00ff88" opacity="0.4" />
            <rect x="65" y="150" width="12" height="12" fill="#00ff88" opacity="0.5" />

            {/* Center lower platform */}
            <rect x="150" y="180" width="200" height="25" fill="#1a2d4d" rx="2" />
            <rect x="150" y="175" width="200" height="5" fill="#3a5d7d" />
            <line x1="150" y1="180" x2="350" y2="180" stroke="#00ff88" strokeWidth="1" opacity="0.4" />

            {/* Right elevated platform */}
            <rect x="380" y="120" width="100" height="20" fill="#1a3a52" rx="2" />
            <rect x="380" y="115" width="100" height="5" fill="#2a5a72" />

            {/* Neon glow effect on platform */}
            <rect x="380" y="118" width="100" height="2" fill="#6699ff" opacity="0.3" />

            {/* Battle damage - bullet holes and cracks */}
            <circle cx="180" cy="160" r="6" fill="none" stroke="#666666" strokeWidth="1.5" opacity="0.6" />
            <circle cx="180" cy="160" r="3" fill="#0a0a15" />
            
            <circle cx="220" cy="165" r="5" fill="none" stroke="#666666" strokeWidth="1.5" opacity="0.5" />
            <circle cx="220" cy="165" r="2" fill="#0a0a15" />

            {/* Blood smears */}
            <ellipse cx="140" cy="130" rx="28" ry="38" fill="#DC143C" opacity="0.5" />
            <ellipse cx="125" cy="110" rx="20" ry="32" fill="#8B0000" opacity="0.4" />
            <path d="M 140 90 Q 145 70 138 50" stroke="#DC143C" strokeWidth="4" fill="none" opacity="0.45" strokeLinecap="round" />
            
            {/* Splatter on right side */}
            <g opacity="0.5">
              <circle cx="420" cy="95" r="22" fill="#C41E3A" />
              <circle cx="405" cy="80" r="15" fill="#8B0000" />
              <circle cx="445" cy="85" r="13" fill="#DC143C" />
              <ellipse cx="425" cy="60" rx="12" ry="18" fill="#8B0000" />
            </g>

            {/* Impact trails */}
            <path d="M 300 150 Q 310 140 318 125" stroke="#DC143C" strokeWidth="5" fill="none" opacity="0.4" strokeLinecap="round" />
          </svg>
        );
    }
  };

  return (
    <button
      onClick={() => isHost && onSelect()}
      disabled={!isHost}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        position: 'relative',
        width: '100%',
        cursor: isHost ? 'pointer' : 'not-allowed',
        border: 'none',
        background: 'transparent',
        padding: 0,
        transition: 'all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
        transform: isSelected
          ? 'scale(1.03) translateY(-6px)'
          : isHovered
            ? 'scale(1.01) translateY(-3px)'
            : 'scale(1) translateY(0)',
        filter: isHost && !isHovered ? 'brightness(0.9)' : undefined,
        opacity: isHost ? 1 : 0.6,
      }}
    >
      {/* Main Card Container */}
      <div
        style={{
          position: 'relative',
          borderRadius: 0,
          overflow: 'hidden',
          background: 'var(--grad-surface)',
          border: isSelected
            ? '3px solid var(--accent-primary)'
            : '2px outset var(--bevel-mid)',
          boxShadow: isSelected
            ? 'var(--shadow-window), 0 0 0 1px var(--accent-primary)'
            : 'var(--shadow-window)',
          transition: 'none',
        }}
      >
        {/* Map Preview Section */}
        <div
          style={{
            position: 'relative',
            width: '100%',
            height: 240,
            background: '#1a1a2e',
            overflow: 'hidden',
          }}
        >
          {/* Preview Content */}
          {getMapPreviewContent(map.id)}

          {/* Overlay with battle effect */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background:
                isSelected || isHovered
                  ? 'linear-gradient(135deg, rgba(102,204,255,0.12), rgba(0,0,0,0.2))'
                  : 'linear-gradient(135deg, rgba(0,0,0,0.2), rgba(0,0,0,0.4))',
              transition: 'all 0.3s ease',
              pointerEvents: 'none',
            }}
          />

          {/* Vignette effect */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'radial-gradient(ellipse at center, transparent 0%, rgba(0,0,0,0.4) 100%)',
              pointerEvents: 'none',
            }}
          />

          {/* Shine effect on hover */}
          {isHovered && (
            <div
              style={{
                position: 'absolute',
                top: '-50%',
                left: '-50%',
                width: '200%',
                height: '200%',
                background: 'linear-gradient(45deg, transparent 30%, rgba(255,255,255,0.08) 50%, transparent 70%)',
                animation: 'shimmer 2s infinite',
                pointerEvents: 'none',
              }}
            />
          )}

          {/* Map Name Overlay */}
          <div
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              background: isSelected ? 'var(--grad-titlebar)' : 'var(--grad-surface)',
              padding: '8px 12px',
              transition: 'none',
              borderTop: '1px solid var(--border-dark)',
            }}
          >
            <div
              style={{
                color: isSelected ? 'var(--neutral-white)' : 'var(--neutral-black)',
                fontFamily: "'MS Sans Serif', 'Tahoma', sans-serif",
                fontSize: 13,
                fontWeight: 700,
                letterSpacing: 0,
                textShadow: isSelected ? '1px 1px 0 rgba(0,0,0,0.5)' : 'none',
                transition: 'none',
              }}
            >
              {map.displayName}
            </div>
          </div>

          {/* Selection Badge - Windows Classic Checkmark */}
          {isSelected && (
            <div
              style={{
                position: 'absolute',
                top: 8,
                right: 8,
                width: 32,
                height: 32,
                borderRadius: 0,
                background: 'var(--grad-button)',
                border: '2px outset var(--bevel-mid)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: 'var(--shadow-raised)',
                fontSize: 20,
                fontWeight: 900,
                color: 'var(--neutral-black)',
                zIndex: 10,
              }}
            >
              ✓
            </div>
          )}
        </div>

        {/* Info Section */}
        <div
          style={{
            padding: '8px 12px',
            background: 'var(--grad-surface)',
            transition: 'none',
            borderTop: '1px solid var(--border-dark)',
          }}
        >
          {/* Description */}
          <div
            style={{
              color: 'var(--neutral-black)',
              fontFamily: "'MS Sans Serif', 'Tahoma', sans-serif",
              fontSize: 11,
              lineHeight: 1.4,
              marginBottom: 8,
              minHeight: 32,
            }}
          >
            {map.description}
          </div>

          {/* Stats Row */}
          <div
            style={{
              display: 'flex',
              gap: 12,
              fontSize: 11,
              fontFamily: "'MS Sans Serif', 'Tahoma', sans-serif",
              fontWeight: 400,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                color: 'var(--neutral-black)',
              }}
            >
              <span>Gravity: {map.gravity || 1200}</span>
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                color: 'var(--neutral-black)',
              }}
            >
              <span>Spawns: {map.spawnPoints?.length || 4}</span>
            </div>
          </div>
        </div>
      </div>
    </button>
  );
};

export function MapSelectionScreen({ 
  selectedMapId, 
  onMapSelect, 
  onConfirm, 
  isHost,
  connectedPlayers,
  sessionId,
}: MapSelectionScreenProps) {
  const selectedMap = AVAILABLE_MAPS.find((m) => m.id === selectedMapId);

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'var(--grad-surface)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
        padding: '40px 20px',
        overflow: 'auto',
      }}
    >
      {/* Classic Windows desktop pattern */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          pointerEvents: 'none',
          zIndex: 0,
          opacity: 0.03,
          backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(0,0,0,0.1) 2px, rgba(0,0,0,0.1) 4px)',
        }}
      >
      </div>

      {/* Content Container */}
      <div style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: 1100 }}>
        {/* Header - Windows Classic Style */}
        <div
          style={{
            textAlign: 'center',
            marginBottom: 24,
            background: 'var(--grad-titlebar)',
            padding: '16px',
            border: '2px outset var(--bevel-mid)',
            boxShadow: 'var(--shadow-window)',
        }}
      >
        <h1
          style={{
            color: 'var(--neutral-white)',
            fontFamily: "'MS Sans Serif', 'Tahoma', sans-serif",
            fontSize: 18,
            fontWeight: 700,
            marginBottom: 8,
            textShadow: '1px 1px 0 rgba(0,0,0,0.5)',
            letterSpacing: 0,
            lineHeight: 1.2,
          }}
        >
            MAP SELECTION
        </h1>
        <div
          style={{
              color: 'var(--neutral-white)',
            fontFamily: "'MS Sans Serif', 'Tahoma', sans-serif",
            fontSize: 11,
            fontWeight: 400,
            letterSpacing: 0,
          }}
        >
            {isHost ? 'Host: Select a map' : 'Waiting for host...'}
        </div>
      </div>

        {/* Session Info - Windows Panel Style */}
        <div
          style={{
            background: 'var(--grad-surface)',
            border: '2px inset var(--bevel-mid)',
            borderRadius: 0,
            padding: '8px 12px',
            marginBottom: 16,
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            fontFamily: "'MS Sans Serif', 'Tahoma', sans-serif",
            fontSize: 11,
            color: 'var(--neutral-black)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontWeight: 700 }}>Session:</span>
            <span style={{ fontFamily: 'monospace', background: 'var(--neutral-white)', padding: '2px 4px', border: '1px solid var(--border-dark)' }}>{sessionId}</span>
        </div>
          <div style={{ width: 2, height: 16, background: 'var(--bevel-dark)' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontWeight: 700 }}>Players:</span>
            <span style={{ fontWeight: 700 }}>{connectedPlayers.length}</span>
        </div>
      </div>

        {/* Maps Grid */}
      <div
        style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: 28,
            marginBottom: 40,
          }}
        >
          {AVAILABLE_MAPS.map((map) => (
            <MapCard
              key={map.id}
              map={map}
              isSelected={selectedMapId === map.id}
              isHost={isHost}
              onSelect={() => onMapSelect(map.id)}
            />
          ))}
                </div>
                
        {/* Confirm Button */}
      {isHost && selectedMap && (
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
            <Button onClick={onConfirm} variant="accent" style={{ padding: '18px 40px', letterSpacing: 2, fontSize: 18 }}>
              START GAME
            </Button>
          </div>
        )}

      </div>

    </div>
  );
}

