import { createD1RoomStore, handleRoomRequest } from '../app/utils/roomServer.mjs';

export function routeStickfigureRoom(request, db) {
  if (!/^\/stickfigure\/api\/multiplayer-room\/?$/.test(new URL(request.url).pathname)) return null;
  if (!db) return Response.json({ error: 'Room storage is unavailable' }, {
    status: 503, headers: { 'Cache-Control': 'no-store' },
  });
  return handleRoomRequest(request, createD1RoomStore(db));
}
