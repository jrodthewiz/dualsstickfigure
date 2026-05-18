"use client";

import React from 'react';
import { Button } from '../ui/Button';
import { useLobbyVoice } from '../../hooks/useLobbyVoice';

interface VoiceChatProps {
  channel: any;
  connectedPlayers: Array<{ clientId: string; username: string }>;
  localClientId: string | null;
  inGame?: boolean; // True when game has started (hides when inactive)
}

export function VoiceChat({ channel, connectedPlayers, localClientId, inGame = false }: VoiceChatProps) {
  console.log('[VoiceChat] Rendered - Channel:', !!channel, 'Players:', connectedPlayers.length, 'LocalID:', localClientId, 'InGame:', inGame);
  
  const { isActive, isMuted, micError, remoteStreams, startVoice, stopVoice, toggleMute } = 
    useLobbyVoice({
      channel,
      connectedPlayers,
      localClientId,
      enabled: true,
    });

  // Get player info for connected voice streams
  const getPlayerName = (clientId: string) => {
    const player = connectedPlayers.find(p => p.clientId === clientId);
    return player?.username || 'Unknown';
  };

  const localPlayer = connectedPlayers.find(p => p.clientId === localClientId);

  // Hide the component during gameplay if not active (but show JOIN button in lobby)
  if (inGame && !isActive && !micError) {
    return null;
  }

  return (
    <div
      style={{
        background: 'var(--neutral-900)',
        border: '1px solid var(--border-soft)',
        borderRadius: 8,
        padding: 15,
        marginTop: 0,
        boxShadow: 'inset 0 1px 0 var(--bevel-light), inset 0 -1px 0 var(--bevel-dark)',
        position: 'fixed',
        bottom: 20,
        left: 20,
        zIndex: 10001, // Above lobby screens
        maxWidth: 280,
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div
          style={{
            color: '#ffffff',
            fontFamily: "'Rajdhani', ui-monospace",
            fontSize: 12,
            fontWeight: 900,
            letterSpacing: 1,
          }}
        >
          🎤 VOICE {isActive && `(${1 + remoteStreams.size})`}
        </div>
        
        {!isActive ? (
          <Button onClick={startVoice} variant="accent" style={{ padding: '6px 12px', fontSize: 11 }}>
            JOIN
          </Button>
        ) : (
          <div style={{ display: 'flex', gap: 6 }}>
            <Button
              onClick={toggleMute}
              variant={isMuted ? 'danger' : 'ghost'}
              style={{ padding: '6px 10px', fontSize: 11 }}
            >
              {isMuted ? '🔇' : '🎤'}
            </Button>
          </div>
        )}
      </div>

      {/* Error message */}
      {micError && (
        <div
          style={{
            padding: '8px 10px',
            background: 'rgba(255, 107, 107, 0.1)',
            border: '1px solid rgba(255, 107, 107, 0.3)',
            borderRadius: 6,
            marginBottom: 10,
          }}
        >
          <div
            style={{
              color: '#ff6b6b',
              fontFamily: "'Rajdhani', ui-monospace",
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            ❌ {micError}
          </div>
        </div>
      )}

      {/* Voice participants list */}
      {isActive && (
        <div
          style={{
            background: 'var(--neutral-800)',
            border: '1px solid var(--border-soft)',
            borderRadius: 6,
            padding: 8,
            maxHeight: 120,
            overflowY: 'auto',
          }}
        >
          {/* Local player (you) */}
          {localPlayer && (
            <div
              key={localClientId}
              style={{
                padding: '6px 10px',
                marginBottom: 6,
                background: 'var(--neutral-700)',
                border: '1px solid var(--border-soft)',
                borderRadius: 4,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: isMuted ? '#ff6b6b' : '#00ff00',
                  boxShadow: isMuted ? '0 0 6px #ff6b6b' : '0 0 6px #00ff00',
                }}
              />
              <div
                style={{
                  flex: 1,
                  color: '#ffffff',
                  fontFamily: "'Rajdhani', ui-monospace",
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                {localPlayer.username} (You)
              </div>
              <div
                style={{
                  color: isMuted ? '#ff6b6b' : '#00ff00',
                  fontFamily: "'Rajdhani', ui-monospace",
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: 0.5,
                }}
              >
                {isMuted ? 'MUTED' : 'ACTIVE'}
              </div>
            </div>
          )}

          {/* Remote players with voice */}
          {Array.from(remoteStreams.entries()).map(([clientId, stream]) => (
            <div
              key={clientId}
              style={{
                padding: '6px 10px',
                marginBottom: 6,
                background: 'var(--neutral-700)',
                border: '1px solid var(--border-soft)',
                borderRadius: 4,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: '#00ff00',
                  boxShadow: '0 0 6px #00ff00',
                }}
              />
              <div
                style={{
                  flex: 1,
                  color: '#ffffff',
                  fontFamily: "'Rajdhani', ui-monospace",
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                {getPlayerName(clientId)}
              </div>
              <div
                style={{
                  color: '#00ff00',
                  fontFamily: "'Rajdhani', ui-monospace",
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: 0.5,
                }}
              >
                CONNECTED
              </div>
            </div>
          ))}

          {/* Players not in voice */}
          {connectedPlayers
            .filter(p => p.clientId !== localClientId && !remoteStreams.has(p.clientId))
            .map((player) => (
              <div
                key={player.clientId}
                style={{
                  padding: '6px 10px',
                  marginBottom: 6,
                  background: 'var(--neutral-800)',
                  border: '1px solid var(--border-soft)',
                  borderRadius: 4,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  opacity: 0.5,
                }}
              >
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: '#666',
                  }}
                />
                <div
                  style={{
                    flex: 1,
                    color: '#999999',
                    fontFamily: "'Rajdhani', ui-monospace",
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  {player.username}
                </div>
                <div
                  style={{
                    color: '#666',
                    fontFamily: "'Rajdhani', ui-monospace",
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: 0.5,
                  }}
                >
                  NO VOICE
                </div>
              </div>
            ))}
        </div>
      )}

      {/* Inactive state message */}
      {!isActive && !micError && (
        <div
          style={{
            color: '#999999',
            fontFamily: "'Rajdhani', ui-monospace",
            fontSize: 10,
            textAlign: 'center',
            fontStyle: 'italic',
            marginTop: 8,
          }}
        >
          P2P voice chat
        </div>
      )}

      {/* Hidden audio elements for remote streams */}
      <div style={{ display: 'none' }}>
        {Array.from(remoteStreams.entries()).map(([clientId, stream]) => (
          <audio
            key={clientId}
            autoPlay
            playsInline
            ref={(el) => {
              if (el && el.srcObject !== stream) {
                el.srcObject = stream;
              }
            }}
          />
        ))}
      </div>
    </div>
  );
}

