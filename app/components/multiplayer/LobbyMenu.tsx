"use client";

import React, { useState } from 'react';
import { Panel } from '../ui/Panel';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';

interface LobbyMenuProps {
  onCreateLobby: (username: string) => void;
  onJoinLobby: (sessionId: string, username: string) => void;
}

export function LobbyMenu({ onCreateLobby, onJoinLobby }: LobbyMenuProps) {
  const [username, setUsername] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [mode, setMode] = useState<'create' | 'join'>('create');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) { 
      setErrorMessage('Please enter a username'); 
      return; 
    }
    if (mode === 'create') {
      onCreateLobby(username.trim());
    } else {
      if (!sessionId.trim()) { 
        setErrorMessage('Please enter a session ID'); 
        return; 
      }
      onJoinLobby(sessionId.trim(), username.trim());
    }
  };

  return (
    <>
      {errorMessage && (
        <Dialog
          title="Validation Error"
          message={errorMessage}
          type="warning"
          onClose={() => setErrorMessage(null)}
        />
      )}
      
      <Panel
        title="⚔ PVP MULTIPLAYER"
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          padding: 0,
          minWidth: 400,
          zIndex: 10000,
        }}
      >

      <div style={{ marginBottom: 12, display: 'flex', gap: 8 }}>
        <Button onClick={() => setMode('create')} variant={mode === 'create' ? 'accent' : 'default'} style={{ flex: 1 }}>
          CREATE LOBBY
        </Button>
        <Button onClick={() => setMode('join')} variant={mode === 'join' ? 'accent' : 'default'} style={{ flex: 1 }}>
          JOIN LOBBY
        </Button>
      </div>

      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: 12 }}>
          <label
            style={{
              display: 'block',
              color: 'var(--neutral-black)',
              fontFamily: "'MS Sans Serif', 'Tahoma', sans-serif",
              fontSize: 11,
              fontWeight: 700,
              marginBottom: 4,
            }}
          >
            USERNAME:
          </label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            maxLength={20}
            placeholder="Enter your name"
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
              boxShadow: 'var(--shadow-sunken)'
            }}
          />
        </div>

        {mode === 'join' && (
          <div style={{ marginBottom: 12 }}>
            <label
              style={{
                display: 'block',
                color: 'var(--neutral-black)',
                fontFamily: "'MS Sans Serif', 'Tahoma', sans-serif",
                fontSize: 11,
                fontWeight: 700,
                marginBottom: 4,
              }}
            >
              SESSION ID:
            </label>
            <input
              type="text"
              value={sessionId}
              onChange={(e) => setSessionId(e.target.value)}
              placeholder="Enter session ID"
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
                boxShadow: 'var(--shadow-sunken)'
              }}
            />
          </div>
        )}

        <Button type="submit" variant="accent" fullWidth style={{ padding: '8px 16px', fontSize: 11, marginTop: 8 }}>
          {mode === 'create' ? 'CREATE LOBBY' : 'JOIN LOBBY'}
        </Button>
      </form>
    </Panel>
    </>
  );
}

