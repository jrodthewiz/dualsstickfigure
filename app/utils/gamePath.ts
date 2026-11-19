export function gamePath(path: string) {
  return `${process.env.NEXT_PUBLIC_STICKFIGURE_BASE_PATH || ''}${path}`;
}

export function gameImagePath(path: string) {
  const packedPath = process.env.NEXT_PUBLIC_STICKFIGURE_PACKED_IMAGES === '1'
    ? path.replace(/\.png$/, '.webp')
    : path;
  return gamePath(packedPath);
}

export function getInvitedRoom(params: URLSearchParams) {
  return ['room', 'session', 'sessionId', 'joinId']
    .map(key => params.get(key)?.trim())
    .find(Boolean);
}
