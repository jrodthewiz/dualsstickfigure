import SimplePeer from 'simple-peer';
import { gamePath } from './gamePath';

export type RoomMember = { clientId: string; data: { username: string } };
type RoomEvent = { id?: number; name: string; data: Record<string, any>; to?: string };
type IncomingEvent = RoomEvent & { from: string; seq: number };
type Snapshot = { members: RoomMember[]; cursor: number; events: IncomingEvent[] };
type Listener = (message: any) => void;
const directEvents = new Set(['playerSync', 'playerAttack', 'playerHit', 'bulletSync', 'flameWeapon']);

class Listeners {
  private events = new Map<string, Set<Listener>>();

  on(name: string, listener: Listener) {
    if (!this.events.has(name)) this.events.set(name, new Set());
    this.events.get(name)!.add(listener);
  }

  off(name?: string, listener?: Listener) {
    if (!name) this.events.clear();
    else if (listener) this.events.get(name)?.delete(listener);
    else this.events.delete(name);
  }

  emit(name: string, value?: unknown) {
    for (const listener of this.events.get(name) ?? []) listener(value);
  }
}

export class RealtimeRoom {
  state = 'initialized';
  readonly traffic = { directSent: 0, directReceived: 0, relayReceived: 0 };
  private token = crypto.randomUUID();
  private presenceEvents = new Listeners();
  private messageEvents = new Listeners();
  private members = new Map<string, RoomMember>();
  private peers = new Map<string, SimplePeer.Instance>();
  private queue: RoomEvent[] = [];
  private timer?: number;
  private cursor = 0;
  private joining = false;
  private lastError = 0;
  private sequence = 0;
  private onPageHide = () => { void this.presence.leave().catch(() => undefined); };

  constructor(readonly name: string, private clientId: string) {}

  presence = {
    get: async () => {
      this.joining = true;
      return (await this.request('peek')).members;
    },
    enter: async (data: { username: string }) => {
      if (this.state === 'attached') return;
      const snapshot = await this.request(this.joining ? 'join' : 'create', { username: data.username.trim().slice(0, 24) || 'Player' });
      this.state = 'attached';
      this.cursor = snapshot.cursor;
      for (const member of snapshot.members) this.members.set(member.clientId, member);
      window.addEventListener('pagehide', this.onPageHide);
      this.schedule();
    },
    leave: async () => {
      if (this.state !== 'attached') return;
      this.stop();
      await this.request('leave');
    },
    subscribe: (name: string, listener: Listener) => this.presenceEvents.on(name, listener),
    unsubscribe: (name?: string, listener?: Listener) => this.presenceEvents.off(name, listener),
  };

  subscribe(name: string, listener: Listener) {
    this.messageEvents.on(name, listener);
  }

  unsubscribe(name?: string, listener?: Listener) {
    this.messageEvents.off(name, listener);
  }

  async detach() {
    this.stop();
  }

  publish(name: string, data: Record<string, any>) {
    if (this.state !== 'attached') return;
    if (!directEvents.has(name)) {
      this.enqueue({ name, data });
      return;
    }
    for (const id of this.members.keys()) {
      if (id === this.clientId) continue;
      const peer = this.peers.get(id);
      if (peer?.connected) {
        try {
          if (name === 'playerSync' && peer.bufferSize > 128_000) continue;
          peer.send(JSON.stringify({ name, data }));
          this.traffic.directSent++;
          continue;
        } catch {
          peer.destroy();
        }
      }
      this.enqueue({ name, data, to: id });
    }
  }

  private enqueue(event: RoomEvent) {
    if (event.name === 'playerSync') {
      this.queue = this.queue.filter(old => old.name !== 'playerSync' || old.to !== event.to);
    }
    if (this.queue.length >= 96) {
      const oldSync = this.queue.findIndex(old => old.name === 'playerSync');
      if (oldSync >= 0) this.queue.splice(oldSync, 1);
      else return;
    }
    this.queue.push({ ...event, id: ++this.sequence });
  }

  private async request(action: string, payload: object = {}): Promise<Snapshot> {
    const response = await fetch(gamePath('/api/multiplayer-room/'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, room: this.name, clientId: this.clientId, token: this.token, ...payload }),
      keepalive: action === 'leave',
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      const error = new Error('Room request failed (' + response.status + ')');
      Object.assign(error, { status: response.status });
      throw error;
    }
    return response.json();
  }

  private schedule() {
    if (this.state !== 'attached') return;
    const others = this.members.size - 1;
    const relaying = [...this.peers.values()].filter(peer => peer.connected).length < others;
    const delay = this.lastError ? 400 : this.queue.length || relaying ? 70 : others ? 225 : 450;
    this.timer = window.setTimeout(() => { void this.poll(); }, delay);
  }

  private async poll() {
    const events = this.queue.splice(0, 3);
    try {
      const next = await this.request('sync', { events, cursor: this.cursor });
      if (this.state !== 'attached') return;
      this.lastError = 0;
      this.cursor = next.cursor;
      const updated = new Map(next.members.map(member => [member.clientId, member]));
      const previous = this.members;
      this.members = updated;
      for (const member of previous.values()) {
        if (updated.has(member.clientId)) continue;
        this.peers.get(member.clientId)?.destroy();
        this.peers.delete(member.clientId);
        this.presenceEvents.emit('leave', member);
      }
      for (const member of updated.values()) {
        if (!previous.has(member.clientId)) this.presenceEvents.emit('enter', member);
        if (member.clientId !== this.clientId && this.clientId < member.clientId && !this.peers.has(member.clientId)) {
          this.createPeer(member.clientId, true);
        }
      }
      for (const event of next.events) {
        if (!updated.has(event.from)) continue;
        if (event.name === 'rtcSignal') {
          const peer = this.peers.get(event.from) ?? this.createPeer(event.from, false);
          try { peer?.signal(event.data as SimplePeer.SignalData); } catch { peer?.destroy(); }
        } else {
          this.traffic.relayReceived++;
          this.messageEvents.emit(event.name, event);
        }
      }
    } catch (cause) {
      if (this.state !== 'attached') return;
      const status = (cause as { status?: number })?.status;
      if (status === 404 || status === 403) {
        for (const member of this.members.values()) {
          if (member.clientId !== this.clientId) this.presenceEvents.emit('leave', member);
        }
        this.messageEvents.emit('roomClosed');
        this.stop();
        return;
      }
      if (status !== 400) {
        const retry = events.filter(event => event.name !== 'playerSync');
        this.queue.unshift(...retry);
        this.queue.length = Math.min(this.queue.length, 96);
      }
      this.lastError = Date.now();
    } finally {
      this.schedule();
    }
  }

  private createPeer(id: string, initiator: boolean) {
    if (!SimplePeer.WEBRTC_SUPPORT) return;
    try {
      const peer = new SimplePeer({
        initiator,
        trickle: true,
        config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] },
      });
      this.peers.set(id, peer);
      peer.on('signal', (data: SimplePeer.SignalData) => this.enqueue({ name: 'rtcSignal', data, to: id }));
      peer.on('data', data => {
        if (data.length > 16000 || this.state !== 'attached') return;
        try {
          const message = JSON.parse(data.toString());
          if (!directEvents.has(message?.name) || !message.data || typeof message.data !== 'object') return;
          if (message.name === 'playerSync') message.data.id = id;
          this.traffic.directReceived++;
          this.messageEvents.emit(message.name, { ...message, from: id });
        } catch { /* Malformed peer messages are ignored. */ }
      });
      // Keep the closed peer in the map to use the relay for this membership.
      peer.on('error', () => {});
      return peer;
    } catch {
      return;
    }
  }

  private stop() {
    this.state = 'detached';
    window.clearTimeout(this.timer);
    window.removeEventListener('pagehide', this.onPageHide);
    for (const peer of this.peers.values()) peer.destroy();
    this.peers.clear();
    this.queue = [];
    this.presenceEvents.off();
    this.messageEvents.off();
  }
}

export class RoomClient {
  readonly auth = { clientId: 'player-' + crypto.randomUUID() };
  private rooms = new Map<string, RealtimeRoom>();
  readonly channels = {
    get: (name: string) => {
      let room = this.rooms.get(name);
      if (!room || room.state === 'detached') {
        room = new RealtimeRoom(name, this.auth.clientId);
        this.rooms.set(name, room);
      }
      return room;
    },
  };
}
