export const STICKFIGURE_CHANNEL_PREFIX = 'stickfigure';

const encoder = new TextEncoder();
const headers = { 'Cache-Control': 'no-store' };

function base64Url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function issueMultiplayerToken(request, apiKey) {
  const clientId = new URL(request.url).searchParams.get('clientId');
  if (!clientId || !/^player-[0-9a-f-]{36}$/.test(clientId)) {
    return Response.json({ error: 'Invalid player ID' }, { status: 400, headers });
  }

  const [keyName, secret] = (apiKey || '').split(':');
  if (!keyName || !secret) {
    return Response.json({ error: 'Multiplayer is unavailable' }, { status: 503, headers });
  }

  const now = Math.floor(Date.now() / 1000);
  const jwtHeader = { typ: 'JWT', alg: 'HS256', kid: keyName };
  const claims = {
    iat: now,
    exp: now + 3600,
    'x-ably-clientId': clientId,
    'x-ably-capability': JSON.stringify({
      [`${STICKFIGURE_CHANNEL_PREFIX}:*`]: ['publish', 'subscribe', 'presence'],
    }),
  };
  const unsigned = [jwtHeader, claims].map(value => base64Url(encoder.encode(JSON.stringify(value)))).join('.');
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(unsigned)));

  return new Response(`${unsigned}.${base64Url(signature)}`, {
    headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
