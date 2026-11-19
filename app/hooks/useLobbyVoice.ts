import { useEffect, useRef, useState, useCallback } from 'react';
import SimplePeer from 'simple-peer';
import type { RealtimeRoom } from '../utils/roomClient';
import { safeChannelPublish, safeChannelSubscribe } from '../utils/roomHelpers';

interface VoicePeer {
  peer: SimplePeer.Instance;
  stream: MediaStream | null;
}

interface UseLobbyVoiceOptions {
  channel: RealtimeRoom | null;
  connectedPlayers: Array<{ clientId: string; username: string }>;
  localClientId: string | null;
  enabled: boolean;
}

export function useLobbyVoice(options: UseLobbyVoiceOptions) {
  const { channel, connectedPlayers, localClientId, enabled } = options;
  
  const [isActive, setIsActive] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());

  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, VoicePeer>>(new Map());
  const isCleaningUpRef = useRef(false);
  const signalSubscriptionRef = useRef<any>(null);

  const createPeerConnection = useCallback((remoteClientId: string, initialSignal?: any) => {
    if (!localClientId || !localStreamRef.current || isCleaningUpRef.current) {
      return;
    }

    // Avoid duplicate peers
    if (peersRef.current.has(remoteClientId)) {
      return;
    }

    console.log(`[Voice] Creating peer connection to ${remoteClientId}`);

    // Determine who initiates (lower clientId alphabetically)
    const shouldInitiate = localClientId < remoteClientId;

    try {
      const peer = new SimplePeer({
        initiator: shouldInitiate,
        stream: localStreamRef.current,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' }
          ]
        }
      });

      peersRef.current.set(remoteClientId, { peer, stream: null });

      // Handle signaling
      peer.on('signal', (signal: any) => {
        console.log(`[Voice] Sending signal to ${remoteClientId}`);
        safeChannelPublish(channel, 'voiceSignal', {
          from: localClientId,
          to: remoteClientId,
          signal
        });
      });

      // Handle incoming stream
      peer.on('stream', (stream: MediaStream) => {
        console.log(`[Voice] Received stream from ${remoteClientId}`);
        const peerData = peersRef.current.get(remoteClientId);
        if (peerData) {
          peerData.stream = stream;
          setRemoteStreams(prev => {
            const next = new Map(prev);
            next.set(remoteClientId, stream);
            return next;
          });
        }
      });

      // Handle connection events
      peer.on('connect', () => {
        console.log(`[Voice] Connected to ${remoteClientId}`);
      });

      peer.on('close', () => {
        console.log(`[Voice] Connection closed with ${remoteClientId}`);
        peersRef.current.delete(remoteClientId);
        setRemoteStreams(prev => {
          const next = new Map(prev);
          next.delete(remoteClientId);
          return next;
        });
      });

      peer.on('error', (err: Error) => {
        console.error(`[Voice] Peer error with ${remoteClientId}:`, err);
        peersRef.current.delete(remoteClientId);
        setRemoteStreams(prev => {
          const next = new Map(prev);
          next.delete(remoteClientId);
          return next;
        });
      });

      // If we received an initial signal, process it
      if (initialSignal) {
        peer.signal(initialSignal);
      }

    } catch (error) {
      console.error(`[Voice] Failed to create peer for ${remoteClientId}:`, error);
    }
  }, [localClientId, channel]);

  const handleIncomingSignal = useCallback((message: any) => {
    const { from, to, signal } = message.data;

    // Only process signals meant for us
    if (to !== localClientId) {
      return;
    }

    console.log(`[Voice] Received signal from ${from}`);

    const peerData = peersRef.current.get(from);
    if (peerData) {
      // Peer exists, signal it
      try {
        peerData.peer.signal(signal);
      } catch (error) {
        console.error(`[Voice] Error signaling peer ${from}:`, error);
      }
    } else {
      // Peer doesn't exist, create it with the initial signal
      createPeerConnection(from, signal);
    }
  }, [localClientId, createPeerConnection]);

  const startVoice = useCallback(async () => {
    if (!channel || !localClientId || isActive) {
      return;
    }

    console.log('[Voice] Starting voice chat...');

    try {
      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
        video: false,
      });

      localStreamRef.current = stream;
      setIsActive(true);
      setMicError(null);

      console.log('[Voice] Microphone acquired');

      // Subscribe to voice signals
      const unsubscribe = safeChannelSubscribe(channel, 'voiceSignal', handleIncomingSignal);
      signalSubscriptionRef.current = unsubscribe;

      // Create peer connections to all existing players
      const otherPlayers = connectedPlayers.filter(p => p.clientId !== localClientId);
      console.log(`[Voice] Creating connections to ${otherPlayers.length} players`);
      
      for (const player of otherPlayers) {
        createPeerConnection(player.clientId);
      }

    } catch (error: any) {
      console.error('[Voice] Failed to start voice:', error);
      setMicError(error.message || 'Could not access microphone');
      setIsActive(false);
    }
  }, [channel, localClientId, isActive, connectedPlayers, handleIncomingSignal, createPeerConnection]);

  const stopVoice = useCallback(() => {
    console.log('[Voice] Stopping voice chat...');
    isCleaningUpRef.current = true;

    // Destroy all peers
    peersRef.current.forEach((peerData, clientId) => {
      console.log(`[Voice] Destroying peer ${clientId}`);
      try {
        peerData.peer.destroy();
      } catch (error) {
        console.error(`[Voice] Error destroying peer ${clientId}:`, error);
      }
    });
    peersRef.current.clear();

    // Stop local stream
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }

    // Unsubscribe from signals
    if (signalSubscriptionRef.current) {
      try {
        signalSubscriptionRef.current(); // Call the cleanup function
      } catch (error) {
        console.error('[Voice] Error unsubscribing:', error);
      }
      signalSubscriptionRef.current = null;
    }

    setRemoteStreams(new Map());
    setIsActive(false);
    isCleaningUpRef.current = false;
  }, [channel]);

  const toggleMute = useCallback(() => {
    if (localStreamRef.current) {
      const audioTracks = localStreamRef.current.getAudioTracks();
      const newMutedState = !isMuted;
      
      audioTracks.forEach(track => {
        track.enabled = !newMutedState;
      });

      setIsMuted(newMutedState);
      console.log(`[Voice] Muted: ${newMutedState}`);
    }
  }, [isMuted]);

  // Effect: Sync peer connections with connected players
  useEffect(() => {
    if (!isActive || !localClientId || isCleaningUpRef.current) {
      return;
    }

    const currentPlayerIds = new Set(connectedPlayers.map(p => p.clientId));
    const currentPeerIds = new Set(peersRef.current.keys());

    // Remove peers for disconnected players
    currentPeerIds.forEach(peerId => {
      if (!currentPlayerIds.has(peerId)) {
        console.log(`[Voice] Player ${peerId} left, destroying peer`);
        const peerData = peersRef.current.get(peerId);
        if (peerData) {
          try {
            peerData.peer.destroy();
          } catch (error) {
            console.error(`[Voice] Error destroying peer ${peerId}:`, error);
          }
          peersRef.current.delete(peerId);
          setRemoteStreams(prev => {
            const next = new Map(prev);
            next.delete(peerId);
            return next;
          });
        }
      }
    });

    // Add peers for new players
    currentPlayerIds.forEach(playerId => {
      if (playerId !== localClientId && !currentPeerIds.has(playerId)) {
        console.log(`[Voice] New player ${playerId} joined, creating peer`);
        createPeerConnection(playerId);
      }
    });
  }, [isActive, localClientId, connectedPlayers, createPeerConnection]);

  // Effect: Cleanup on unmount
  useEffect(() => {
    return () => {
      if (isActive) {
        stopVoice();
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    isActive,
    isMuted,
    micError,
    remoteStreams,
    startVoice,
    stopVoice,
    toggleMute,
  };
}

