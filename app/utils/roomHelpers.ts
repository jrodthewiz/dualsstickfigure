// Safe room transport channel operation helpers

import type { RealtimeRoom as RealtimeChannel } from "./roomClient";

/**
 * Safely publish a message to an room transport channel
 * Prevents errors from detached/failed channel states
 */
export function safeChannelPublish(
  channel: RealtimeChannel | null | undefined,
  eventName: string,
  data: any
): boolean {
  if (!channel) {
    console.warn('Cannot publish: channel is null/undefined');
    return false;
  }
  
  if (
    channel.state === 'detached' || 
    channel.state === 'detaching' || 
    channel.state === 'failed'
  ) {
    console.warn(`Channel is ${channel.state}, skipping message:`, eventName);
    return false;
  }
  
  try {
    channel.publish(eventName, data);
    return true;
  } catch (error) {
    console.warn(`Failed to publish ${eventName}:`, error);
    return false;
  }
}

/**
 * Safely subscribe to an room transport channel event
 * Returns cleanup function or null
 */
export function safeChannelSubscribe(
  channel: RealtimeChannel | null | undefined,
  eventName: string,
  handler: (message: any) => void
): (() => void) | null {
  if (!channel) {
    console.warn('Cannot subscribe: channel is null/undefined');
    return null;
  }
  
  if (
    channel.state === 'detached' || 
    channel.state === 'detaching' || 
    channel.state === 'failed'
  ) {
    console.warn(`Channel is ${channel.state}, cannot subscribe to:`, eventName);
    return null;
  }
  
  try {
    const safeHandler = (message: any) => {
      try {
        handler(message);
      } catch (error) {
        console.warn(`Error in ${eventName} handler:`, error);
      }
    };
    
    channel.subscribe(eventName, safeHandler);
    
    return () => {
      try {
        if (channel.state !== 'detached' && channel.state !== 'detaching') {
          channel.unsubscribe(eventName, safeHandler);
        }
      } catch (error) {
        console.warn(`Error unsubscribing from ${eventName}:`, error);
      }
    };
  } catch (error) {
    console.warn(`Failed to subscribe to ${eventName}:`, error);
    return null;
  }
}

/**
 * Check if channel is ready for operations
 */
export function isChannelReady(
  channel: RealtimeChannel | null | undefined
): boolean {
  if (!channel) return false;
  return channel.state === 'attached' || channel.state === 'attaching';
}

/**
 * Cleanup all subscriptions from a channel
 */
export function cleanupChannelSubscriptions(
  channel: RealtimeChannel | null | undefined,
  eventNames: string[]
): void {
  if (!channel) return;
  
  try {
    eventNames.forEach(eventName => {
      try {
        channel.unsubscribe(eventName);
      } catch (err) {
        console.warn(`Failed to unsubscribe from ${eventName}:`, err);
      }
    });
  } catch (err) {
    console.warn('Error during channel cleanup:', err);
  }
}

