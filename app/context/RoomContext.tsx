'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { RoomClient } from '../utils/roomClient';

const RoomContext = createContext<RoomClient | null>(null);

export function useRoomClient() {
  return useContext(RoomContext);
}

export function RoomProvider({ children }: { children: ReactNode }) {
  const client = useMemo(() => typeof window === 'undefined' ? null : new RoomClient(), []);
  return <RoomContext.Provider value={client}>{children}</RoomContext.Provider>;
}
