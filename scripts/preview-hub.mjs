import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { Readable } from 'node:stream';
import { DatabaseSync } from 'node:sqlite';
import { routeStickfigureRoom } from '../integration/stickfigure-room-worker.mjs';

const port = Number(process.env.PORT || 3104);
const origin = 'http://127.0.0.1:' + port;
const root = resolve('build/site');
const sqlite = new DatabaseSync(':memory:');
sqlite.exec(await readFile(new URL('../integration/stickfigure-rooms.sql', import.meta.url), 'utf8'));
const db = {
  prepare(query) {
    const statement = sqlite.prepare(query);
    return {
      bind(...values) {
        return {
          async first() { return statement.get(...values) ?? null; },
          async run() { return { meta: statement.run(...values) }; },
        };
      },
    };
  },
};
const types = new Map(Object.entries({
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.wav': 'audio/wav',
}));

const server = createServer(async (incoming, outgoing) => {
  try {
    const address = new URL(incoming.url, origin);
    const stream = incoming.method === 'POST' ? Readable.toWeb(incoming) : undefined;
    const request = new Request(address, { method: incoming.method, headers: incoming.headers, body: stream, duplex: stream ? 'half' : undefined });
    const routed = routeStickfigureRoom(request, db);
    if (routed) {
      const response = await routed;
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    if (!['GET', 'HEAD'].includes(incoming.method)) {
      outgoing.writeHead(405).end();
      return;
    }
    const pathname = decodeURIComponent(address.pathname);
    let file = resolve(root, '.' + pathname);
    if (!file.startsWith(root + sep)) {
      outgoing.writeHead(404).end();
      return;
    }
    if (pathname.endsWith('/')) file = resolve(file, 'index.html');
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) {
      outgoing.writeHead(404).end();
      return;
    }
    outgoing.writeHead(200, {
      'Content-Type': types.get(extname(file)) ?? 'application/octet-stream',
      'Content-Length': info.size,
    });
    if (incoming.method === 'HEAD') outgoing.end();
    else createReadStream(file).pipe(outgoing);
  } catch (error) {
    console.error(error);
    outgoing.writeHead(500).end();
  }
});
server.listen(port, '127.0.0.1', () => console.log(origin + '/stickfigure/'));
