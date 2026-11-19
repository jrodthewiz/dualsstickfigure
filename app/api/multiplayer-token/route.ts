import { issueMultiplayerToken } from '../../utils/multiplayerAuth.mjs';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return issueMultiplayerToken(request, process.env.ABLY_API_KEY);
}
