"use client";

import React from 'react';
import type { ConnectedPlayer } from '../../types/Multiplayer';
import { getMapById } from '../../types/Maps';

interface ReadyUpScreenProps {
  players: ConnectedPlayer[];
  selectedMapId: string;
  onToggleReady: () => void;
  onStartGame: () => void;
  isHost: boolean;
  currentPlayerClientId: string;
  sessionId: string | null;
  botCount: number;
}

export function ReadyUpScreen({
  players,
  selectedMapId,
  onToggleReady,
  onStartGame,
  isHost,
  currentPlayerClientId,
  sessionId,
  botCount,
}: ReadyUpScreenProps) {
  const selectedMap = getMapById(selectedMapId);
  const currentPlayer = players.find(p => p.clientId === currentPlayerClientId);
  const hostPlayer = players[0];
  const readyPlayersExcludingHost = players.slice(1).filter(p => p.isReady);
  const hostReady = hostPlayer ? hostPlayer.isReady : false;
  const awaitingHostReady = isHost && !hostReady;
  const allPlayersReady = (players.length + botCount) >= 2 && readyPlayersExcludingHost.length === players.length - 1;
  const readyCount = players.filter(p => p.isReady).length;

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
        padding: '40px',
        overflow: 'auto',
      }}
    >
      {/* Windows desktop pattern */}
      <div style={{
        position: 'absolute',
        inset: 0,
        opacity: 0.03,
        backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(0,0,0,0.1) 2px, rgba(0,0,0,0.1) 4px)',
        pointerEvents: 'none'
      }} />

      {/* Header */}
      <div
        style={{
          textAlign: 'center',
          marginBottom: 20,
          background: 'var(--grad-titlebar)',
          padding: '12px 40px',
          border: '2px outset var(--bevel-mid)',
          boxShadow: 'var(--shadow-window)',
          borderRadius: 0,
        }}
      >
        <h1
          style={{
            color: 'var(--neutral-white)',
            fontFamily: "'MS Sans Serif', 'Tahoma', sans-serif",
            fontSize: 24,
            fontWeight: 700,
            marginBottom: 4,
            textShadow: '1px 1px 0 rgba(0,0,0,0.5)',
            letterSpacing: 1,
          }}
        >
          ⚔ Ready Up
        </h1>
        <div
          style={{
            color: 'var(--neutral-white)',
            fontFamily: "'MS Sans Serif', 'Tahoma', sans-serif",
            fontSize: 11,
            fontWeight: 400,
            letterSpacing: 0,
            opacity: 0.9,
          }}
        >
          Prepare for battle
        </div>
      </div>

      {/* Selected Map Display */}
      {selectedMap && (
        <div
          style={{
            background: 'var(--grad-surface)',
            border: '2px outset var(--bevel-mid)',
            borderRadius: 0,
            padding: 0,
            marginBottom: 30,
            display: 'flex',
            flexDirection: 'column',
            maxWidth: '600px',
            width: '100%',
            boxShadow: 'var(--shadow-window)',
          }}
        >
          {/* Title bar */}
          <div style={{
            background: 'var(--grad-titlebar)',
            color: 'var(--neutral-white)',
            padding: '4px 8px',
            fontFamily: "'MS Sans Serif', 'Tahoma', sans-serif",
            fontSize: 11,
            fontWeight: 700,
            borderBottom: '1px solid var(--border-dark)',
            textShadow: '1px 1px 0 rgba(0,0,0,0.5)',
          }}>
            Selected Map
          </div>
          
          <div style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 16 }}>
            <div
              style={{
                width: 80,
                height: 80,
                background: 'var(--grad-button)',
                borderRadius: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 40,
                border: '2px inset var(--bevel-mid)',
                boxShadow: 'var(--shadow-sunken)',
              }}
            >
              {selectedMapId === 'suburban-day' ? '🏘️' : selectedMapId === 'rooftop-sunset' ? '🌆' : '🏙️'}
            </div>
            <div style={{ flex: 1 }}>
              <div
                style={{
                  color: 'var(--neutral-black)',
                  fontFamily: "'MS Sans Serif', 'Tahoma', sans-serif",
                  fontSize: 16,
                  fontWeight: 700,
                  marginBottom: 4,
                  letterSpacing: 0,
                }}
              >
                {selectedMap.displayName}
              </div>
              <div
                style={{
                  color: 'var(--neutral-black)',
                  fontFamily: "'MS Sans Serif', 'Tahoma', sans-serif",
                  fontSize: 11,
                  opacity: 0.7,
                }}
              >
                {selectedMap.description}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Ready Status Bar */}
      <div
        style={{
          background: allPlayersReady ? 'var(--grad-titlebar)' : 'var(--grad-button)',
          border: '2px outset var(--bevel-mid)',
          borderRadius: 0,
          padding: '12px 30px',
          marginBottom: 30,
          fontFamily: "'MS Sans Serif', 'Tahoma', sans-serif",
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: 0,
          color: allPlayersReady ? 'var(--neutral-white)' : 'var(--neutral-black)',
          textShadow: allPlayersReady ? '1px 1px 0 rgba(0,0,0,0.5)' : 'none',
          boxShadow: 'var(--shadow-raised)',
          transition: 'none',
        }}
      >
        {allPlayersReady ? '✓ All Players Ready!' : `${readyCount} / ${players.length} Players Ready`}
      </div>

      {/* Players Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
          gap: 12,
          maxWidth: '900px',
          width: '100%',
          marginBottom: 30,
        }}
      >
        {players.map((player, index) => {
          const isCurrentPlayer = player.clientId === currentPlayerClientId;
          const isReady = player.isReady || false;

          return (
            <div
              key={player.clientId}
              style={{
                background: 'var(--grad-surface)',
                border: isReady ? '3px solid var(--accent-primary)' : '2px outset var(--bevel-mid)',
                borderRadius: 0,
                padding: 0,
                position: 'relative',
                transition: 'none',
                boxShadow: 'var(--shadow-window)',
              }}
            >
              {/* Title bar */}
              <div style={{
                background: isReady ? 'var(--grad-titlebar)' : 'var(--grad-button)',
                color: isReady ? 'var(--neutral-white)' : 'var(--neutral-black)',
                padding: '4px 8px',
                fontFamily: "'MS Sans Serif', 'Tahoma', sans-serif",
                fontSize: 11,
                fontWeight: 700,
                borderBottom: '1px solid var(--border-dark)',
                textShadow: isReady ? '1px 1px 0 rgba(0,0,0,0.5)' : 'none',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}>
                {index === 0 && <span>⭐</span>}
                <span>{player.username}{isCurrentPlayer && ' (YOU)'}</span>
              </div>
              
              {/* Player Avatar */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: 12,
                }}
              >
                <div
                  style={{
                    width: 50,
                    height: 50,
                    borderRadius: 0,
                    background: isReady ? 'var(--grad-titlebar)' : 'var(--grad-button)',
                    border: '2px outset var(--bevel-mid)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 24,
                    boxShadow: 'var(--shadow-raised)',
                  }}
                >
                  {isReady ? '✓' : '⏳'}
                </div>

                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                      fontSize: 11,
                      fontFamily: "'MS Sans Serif', 'Tahoma', sans-serif",
                      fontWeight: 400,
                    }}
                  >
                    {index === 0 && (
                      <span style={{ color: 'var(--neutral-black)', fontWeight: 700 }}>Host</span>
                    )}
                    <span
                      style={{
                        color: 'var(--neutral-black)',
                        fontWeight: isReady ? 700 : 400,
                      }}
                    >
                      {isReady ? '✓ Ready' : '⏳ Not Ready'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Action Buttons */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        {/* Ready/Unready Button */}
        <button
          onClick={onToggleReady}
          style={{
            padding: '12px 32px',
            background: currentPlayer?.isReady ? 'var(--grad-button)' : 'var(--grad-titlebar)',
            border: '2px outset var(--bevel-mid)',
            borderRadius: 0,
            color: currentPlayer?.isReady ? 'var(--neutral-black)' : 'var(--neutral-white)',
            fontFamily: "'MS Sans Serif', 'Tahoma', sans-serif",
            fontSize: 13,
            fontWeight: 700,
            cursor: 'pointer',
            letterSpacing: 0,
            textShadow: currentPlayer?.isReady ? 'none' : '1px 1px 0 rgba(0,0,0,0.5)',
            boxShadow: 'var(--shadow-raised)',
            transition: 'none',
          }}
        >
          {currentPlayer?.isReady ? '✗ Not Ready' : '✓ Ready'}
        </button>

        {/* Start Game Button (Host Only, All Ready) */}
        {isHost && allPlayersReady && hostReady && (
          <button
            onClick={onStartGame}
            style={{
              padding: '12px 32px',
              background: 'var(--grad-titlebar)',
              border: '3px solid var(--accent-primary)',
              borderRadius: 0,
              color: 'var(--neutral-white)',
              fontFamily: "'MS Sans Serif', 'Tahoma', sans-serif",
              fontSize: 13,
              fontWeight: 700,
              cursor: 'pointer',
              letterSpacing: 0,
              textShadow: '1px 1px 0 rgba(0,0,0,0.5)',
              boxShadow: 'var(--shadow-raised), 0 0 0 1px var(--accent-primary)',
              transition: 'none',
            }}
          >
            ▶ Start Game
          </button>
        )}
      </div>

      {/* Info Text */}
      {(!allPlayersReady || awaitingHostReady) && (
        <div
          style={{
            marginTop: 16,
            padding: '8px 16px',
            background: 'var(--neutral-white)',
            border: '2px inset var(--bevel-mid)',
            borderRadius: 0,
            color: 'var(--neutral-black)',
            fontFamily: "'MS Sans Serif', 'Tahoma', sans-serif",
            fontSize: 11,
            fontStyle: 'normal',
            textAlign: 'center',
            boxShadow: 'var(--shadow-sunken)',
          }}
        >
          {(players.length + botCount) < 2
            ? 'Need at least 2 players to start'
            : awaitingHostReady
              ? 'Host: press READY to enable START'
              : 'Waiting for all players to ready up...'}
        </div>
      )}

    </div>
  );
}

