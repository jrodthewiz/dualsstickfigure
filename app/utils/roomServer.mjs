const ROOM = /^pvp-[a-z0-9]{9}$/;
const ID = /^player-[0-9a-f-]{36}$/;
const TOKEN = /^[0-9a-f-]{36}$/;
const EVENTS = new Set(['rtcSignal', 'playerJoined', 'gameStart', 'playerSync', 'playerAttack', 'playerHit', 'bulletSync', 'flameWeapon', 'mapSelected', 'phaseChange', 'playerReady', 'voiceSignal']);
const TTL = 20000;
const MAX_BODY = 65536;
const MAX_ROOM_EVENTS = 160;
const HOST_EVENTS = new Set(['playerJoined', 'gameStart', 'phaseChange', 'mapSelected']);

export function createMemoryRoomStore() {
  const rooms = new Map();
  return {
    async read(id, now) {
      for (const [key, value] of rooms) {
        if (value.expires <= now) rooms.delete(key);
      }
      return structuredClone(rooms.get(id) ?? null);
    },
    async write(id, revision, state, expires) {
      if ((rooms.get(id)?.revision ?? 0) !== revision) return false;
      if (rooms.size >= 1000 && !rooms.has(id)) return false;
      rooms.set(id, { revision: revision + 1, state: structuredClone(state), expires });
      return true;
    },
  };
}

export function createD1RoomStore(db) {
  return {
    async read(id, now) {
      const row = await db.prepare('SELECT revision, state, expires FROM stickfigure_rooms WHERE id = ?').bind(id).first();
      if (!row) return null;
      if (row.expires > now) return { revision: row.revision, state: JSON.parse(row.state) };
      await db.prepare('DELETE FROM stickfigure_rooms WHERE id = ? AND revision = ? AND expires <= ?').bind(id, row.revision, now).run();
      return null;
    },
    async write(id, revision, state, expires) {
      if (!revision) {
        await db.prepare('DELETE FROM stickfigure_rooms WHERE id IN (SELECT id FROM stickfigure_rooms WHERE expires <= ? LIMIT 32)').bind(Date.now()).run();
      }
      const json = JSON.stringify(state);
      const command = revision
        ? db.prepare('UPDATE stickfigure_rooms SET revision = revision + 1, state = ?, expires = ? WHERE id = ? AND revision = ?').bind(json, expires, id, revision)
        : db.prepare('INSERT OR IGNORE INTO stickfigure_rooms (id, revision, state, expires) VALUES (?, 1, ?, ?)').bind(id, json, expires);
      const result = await command.run();
      return result.meta.changes === 1;
    },
  };
}

function matches(pattern, value) {
  return typeof value === 'string' && pattern.test(value);
}

function respond(data, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

async function readBody(request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Missing body');
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) {
      await reader.cancel();
      throw new Error('Room request too large');
    }
    text += decoder.decode(value, { stream: true });
  }
  return JSON.parse(text + decoder.decode());
}

export async function handleRoomRequest(request, store) {
  if (request.method !== 'POST') return respond({ error: 'POST required' }, 405);
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return respond({ error: 'Invalid origin' }, 403);
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) return respond({ error: 'JSON required' }, 415);
  let body;
  try {
    body = await readBody(request);
  } catch {
    return respond({ error: 'Invalid room request' }, 400);
  }
  const { room, action, clientId, token, username, cursor, events } = body ?? {};
  if (!matches(ROOM, room) || !['peek', 'create', 'join', 'sync', 'leave'].includes(action)) return respond({ error: 'Invalid room' }, 400);
  if (action !== 'peek' && (!matches(ID, clientId) || !matches(TOKEN, token))) return respond({ error: 'Invalid room identity' }, 400);
  if (['create', 'join'].includes(action) && (typeof username !== 'string' || username.length < 1 || username.length > 24)) {
    return respond({ error: 'Invalid player name' }, 400);
  }
  if (action === 'sync' && (!Number.isSafeInteger(cursor) || cursor < 0 || !Array.isArray(events) || events.length > 24 ||
    events.some(event => !EVENTS.has(event?.name) || !Number.isSafeInteger(event.id) || event.id < 1 || (event.to != null && !matches(ID, event.to)) ||
      typeof event.data !== 'object' || event.data === null || Array.isArray(event.data) || JSON.stringify(event).length > 16000))) {
    return respond({ error: 'Invalid room events' }, 400);
  }

  for (let attempt = 0; attempt < 8; attempt++) {
    const now = Date.now();
    const saved = await store.read(room, now);
    if (!saved && action !== 'create') return respond({ error: 'Room is closed' }, 404);
    const state = saved?.state ?? { host: clientId, members: [], events: [], cursor: 0 };
    const count = state.members.length;
    state.members = state.members.filter(member => member.seen + TTL > now);
    if (saved && !state.members.some(member => member.id === state.host)) {
      return respond({ error: 'Host disconnected' }, 404);
    }
    const members = () => state.members.map(({ id, username }) => ({ clientId: id, data: { username } }));
    if (action === 'peek') return respond({ members: members() });
    const member = state.members.find(player => player.id === clientId);
    if (member && member.token !== token) return respond({ error: 'Invalid room identity' }, 403);
    let changed = count !== state.members.length;
    if (action === 'create' && saved && !member) return respond({ error: 'Room code already exists' }, 409);
    if (action === 'create' || action === 'join') {
      if (!member) {
        if (state.members.length >= 4) return respond({ error: 'Room is full' }, 409);
        state.members.push({ id: clientId, token, username, seen: now, lastSend: 0, lastEventId: 0 });
        changed = true;
      }
    } else {
      if (!member) return respond({ error: 'Room membership expired' }, 404);
      if (action === 'leave') {
        state.members = state.members.filter(player => player.id !== clientId);
        changed = true;
      } else {
        if (events.length && now - member.lastSend < 30) return respond({ error: 'Slow down' }, 429);
        if (events.length) {
          let size = 0;
          if (events.some(event => HOST_EVENTS.has(event.name) && state.host !== clientId)) {
            return respond({ error: 'Only the host can send this event' }, 403);
          }
          for (const event of events) {
            if (event.id <= member.lastEventId) continue;
            member.lastEventId = event.id;
            if (event.name === 'playerReady') event.data.clientId = clientId;
            if (event.name === 'playerSync') event.data.id = clientId;
            state.events.push({ name: event.name, data: event.data, to: event.to, from: clientId, seq: ++state.cursor });
          }
          state.events = state.events.slice(-MAX_ROOM_EVENTS);
          for (let index = state.events.length - 1; index >= 0; index--) {
            size += JSON.stringify(state.events[index]).length;
            if (size <= 180000) continue;
            state.events = state.events.slice(index + 1);
            break;
          }
          member.lastSend = now;
          changed = true;
        }
        if (now - member.seen >= 4000) {
          member.seen = now;
          changed = true;
        }
      }
    }

    if (changed && !await store.write(room, saved?.revision ?? 0, state, now + TTL)) continue;
    if (action === 'leave') return respond({ ok: true });
    return respond({
      members: members(), cursor: state.cursor,
      events: action === 'sync' ? state.events.filter(event =>
        event.seq > cursor && event.from !== clientId && (!event.to || event.to === clientId)) : [],
    });
  }
  return respond({ error: 'Room is busy, retry shortly' }, 503);
}
