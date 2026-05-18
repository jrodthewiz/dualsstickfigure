"use client";

import React, { useState } from 'react';
import { Panel } from '../ui/Panel';
import { Button } from '../ui/Button';
import type { ConnectedPlayer } from '../../types/Multiplayer';
import { MapSelection } from './MapSelection';

interface LobbyViewProps {
  players: ConnectedPlayer[];
  sessionId: string | null;
  isHost: boolean;
  onStartGame: (() => void) | null;
  onLeaveLobby: () => void;
  selectedMapId: string;
  onMapSelect: (mapId: string) => void;
  botCount: number;
}

export function LobbyView({ players, sessionId, isHost, onStartGame, onLeaveLobby, selectedMapId, onMapSelect, botCount }: LobbyViewProps) {
  const [copied, setCopied] = useState(false);

  const copySessionId = () => {
    if (sessionId) {
      navigator.clipboard.writeText(sessionId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };
  const canStart = players.length + botCount >= 2;

  return (
    <Panel
      style={{
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        borderRadius: 12,
        padding: 20,
        minWidth: 450,
        maxWidth: 600,
        zIndex: 10000,
      }}
    >
      <h2
        style={{
          color: '#ffffff',
          fontFamily: "'Rajdhani', 'Share Tech Mono', ui-monospace",
          fontSize: 28,
          fontWeight: 900,
          textAlign: 'center',
          marginBottom: 10,
          textShadow: '0 0 20px rgba(255,255,255,0.8)',
          letterSpacing: 2,
        }}
      >
        ⚔ PVP LOBBY
      </h2>

      {isHost && (
        <p
          style={{
            color: '#ffdd00',
            fontFamily: "'Rajdhani', ui-monospace",
            fontSize: 12,
            textAlign: 'center',
            marginBottom: 15,
            fontWeight: 700,
            letterSpacing: 1,
          }}
        >
          ⭐ YOU ARE THE HOST
        </p>
      )}

      <div
        style={{
          background: 'var(--neutral-900)',
          border: '1px solid var(--border-soft)',
          borderRadius: 8,
          padding: 15,
          marginBottom: 20,
          boxShadow: 'inset 0 1px 0 var(--bevel-light), inset 0 -1px 0 var(--bevel-dark)'
        }}
      >
        <div
          style={{
            color: '#999999',
            fontFamily: "'Rajdhani', ui-monospace",
            fontSize: 11,
            fontWeight: 900,
            marginBottom: 5,
            letterSpacing: 1,
          }}
        >
          SESSION ID
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <div
            style={{
              flex: 1,
              color: '#ffffff',
              fontFamily: "'Share Tech Mono', monospace",
              fontSize: 16,
              fontWeight: 700,
              letterSpacing: 2,
              textShadow: '0 0 10px rgba(255,255,255,0.6)',
            }}
          >
            {sessionId || 'N/A'}
          </div>
          <Button onClick={copySessionId} variant={copied ? 'accent' : 'ghost'} style={{ padding: '8px 12px', fontSize: 11 }}>
            {copied ? '✓ COPIED' : '📋 COPY'}
          </Button>
        </div>
      </div>

      <div style={{ marginBottom: 20 }}>
        <div
          style={{
            color: '#ffffff',
            fontFamily: "'Rajdhani', ui-monospace",
            fontSize: 14,
            fontWeight: 900,
            marginBottom: 10,
            letterSpacing: 1,
          }}
        >
          CONNECTED PLAYERS ({players.length})
        </div>
        <div
          style={{
            background: 'var(--neutral-900)',
            border: '1px solid var(--border-soft)',
            borderRadius: 8,
            padding: 10,
            maxHeight: 200,
            overflowY: 'auto',
            boxShadow: 'inset 0 1px 0 var(--bevel-light), inset 0 -1px 0 var(--bevel-dark)'
          }}
        >
          {players.map((player, index) => (
            <div
              key={player.clientId}
              style={{
                padding: '8px 12px',
                marginBottom: index < players.length - 1 ? 8 : 0,
                background: 'var(--neutral-800)',
                border: '1px solid var(--border-soft)',
                borderRadius: 6,
                display: 'flex',
                alignItems: 'center',
                gap: 10,
              }}
            >
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: '#00ff00',
                  boxShadow: '0 0 10px #00ff00',
                }}
              />
              <div
                style={{
                  flex: 1,
                  color: '#ffffff',
                  fontFamily: "'Rajdhani', ui-monospace",
                  fontSize: 14,
                  fontWeight: 700,
                }}
              >
                {player.username}
              </div>
              {index === 0 && (
                <div
                  style={{
                    color: 'var(--accent-primary)',
                    fontFamily: "'Rajdhani', ui-monospace",
                    fontSize: 10,
                    fontWeight: 900,
                    letterSpacing: 1,
                  }}
                >
                  HOST
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Map Selection */}
      <MapSelection
        selectedMapId={selectedMapId}
        onMapSelect={onMapSelect}
        isHost={isHost}
      />

      {!isHost && (
        <p
          style={{
            color: '#999999',
            fontFamily: "'Rajdhani', ui-monospace",
            fontSize: 13,
            textAlign: 'center',
            marginBottom: 15,
            fontStyle: 'italic',
          }}
        >
          Waiting for host to start the game...
        </p>
      )}

      <div style={{ display: 'flex', gap: 10 }}>
        <Button onClick={onLeaveLobby} variant="danger" style={{ flex: 1 }}>
          🚪 LEAVE LOBBY
        </Button>

        {isHost && onStartGame && (
          <Button onClick={onStartGame} disabled={!canStart} variant="accent" style={{ flex: 1 }}>
            ⚔ START GAME
          </Button>
        )}
      </div>

      {isHost && !canStart && (
        <p
          style={{
            color: '#ff9999',
            fontFamily: "'Rajdhani', ui-monospace",
            fontSize: 11,
            textAlign: 'center',
            marginTop: 10,
            fontStyle: 'italic',
          }}
        >
          Need at least 2 players to start
        </p>
      )}
    </Panel>
  );
}

