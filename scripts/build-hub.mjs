import { spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const require = createRequire(import.meta.url);
const basePath = '/stickfigure';
const result = spawnSync(process.execPath, [require.resolve('next/dist/bin/next'), 'build'], {
  cwd: fileURLToPath(root),
  env: { ...process.env, STICKFIGURE_BASE_PATH: basePath },
  stdio: 'inherit',
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

const artifacts = new URL('.next/server/app/', root);
const html = await readFile(new URL('index.html', artifacts), 'utf8');
if (!html.includes(`${basePath}/_next/static/`)) {
  throw new Error('Expected a prerendered entry with Stickfigure asset URLs');
}

const siteParent = new URL('build/site/', root);
await mkdir(siteParent, { recursive: true });
if (await realpath(siteParent) !== resolve(await realpath(root), 'build', 'site')) {
  throw new Error('The build/site directory must be inside the checkout');
}
const site = new URL('stickfigure/', siteParent);
await rm(site, { recursive: true, force: true });
await mkdir(site, { recursive: true });
await cp(new URL('public/', root), site, { recursive: true });
await cp(new URL('.next/static/', root), new URL('_next/static/', site), { recursive: true });
await cp(new URL('icon.svg.body', artifacts), new URL('icon.svg', site));
await writeFile(new URL('index.html', site), html);
console.log(`Packaged ${basePath}/ at ${fileURLToPath(site)}`);
