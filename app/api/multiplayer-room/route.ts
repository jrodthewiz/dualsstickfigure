import { createMemoryRoomStore, handleRoomRequest } from '../../utils/roomServer.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const store = createMemoryRoomStore();

export async function POST(request: Request) {
  return handleRoomRequest(request, store);
}
