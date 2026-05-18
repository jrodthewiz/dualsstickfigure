"use client";

import React, { createContext, useContext, useMemo, ReactNode } from 'react';
import * as Ably from 'ably';

interface AblyContextType {
  client: Ably.Realtime | null;
}

const AblyContext = createContext<AblyContextType>({ client: null });

export function useAbly(): Ably.Realtime | null {
  const context = useContext(AblyContext);
  return context.client;
}

interface AblyProviderProps {
  children: ReactNode;
}

export function AblyContextProvider({ children }: AblyProviderProps) {
  const ablyClient = useMemo(() => {
    // Only initialize on client side
    if (typeof window === 'undefined') return null;
    
    // Reuse existing client if available (persists across HMR)
    if ((window as any).__hvaiAblyClient) {
      return (window as any).__hvaiAblyClient as Ably.Realtime;
    }
    
    const key = process.env.NEXT_PUBLIC_ABLY_API_KEY;
    
    if (!key) {
      console.warn('NEXT_PUBLIC_ABLY_API_KEY not found. Multiplayer will not work.');
      return null;
    }
    
    // Generate stable clientId (persisted in sessionStorage)
    let clientIdToUse: string | null = null;
    try {
      clientIdToUse = window.sessionStorage.getItem('ablyClientId');
      if (!clientIdToUse) {
        clientIdToUse = `player-${Math.random().toString(36).substr(2, 9)}`;
        window.sessionStorage.setItem('ablyClientId', clientIdToUse);
      }
    } catch (err) {
      console.warn('Could not access sessionStorage, using random clientId');
      clientIdToUse = `player-${Math.random().toString(36).substr(2, 9)}`;
    }

    const options: Ably.ClientOptions = {
      key,
      closeOnUnload: true,
      echoMessages: false, // Don't receive our own messages
      autoConnect: true,
      ...(clientIdToUse ? { clientId: clientIdToUse } : {}),
    };

    const client = new Ably.Realtime(options);
    
    // Cache globally to persist across hot reloads
    (window as any).__hvaiAblyClient = client;
    
    // Log connection state changes
    client.connection.on('connected', () => {
      console.log('✅ Ably connected:', client.auth.clientId);
    });
    
    client.connection.on('disconnected', () => {
      console.log('❌ Ably disconnected');
    });
    
    client.connection.on('failed', (err) => {
      console.error('❌ Ably connection failed:', err);
    });
    
    return client;
  }, []);

  return (
    <AblyContext.Provider value={{ client: ablyClient }}>
      {children}
    </AblyContext.Provider>
  );
}

