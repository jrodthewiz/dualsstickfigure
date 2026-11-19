import { spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, readdir, realpath, rm, unlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = new URL('../', import.meta.url);
const require = createRequire(import.meta.url);
const basePath = '/stickfigure';
const result = spawnSync(process.execPath, [require.resolve('next/dist/bin/next'), 'build'], {
  cwd: fileURLToPath(root),
  env: { ...process.env, STICKFIGURE_BASE_PATH: basePath, STICKFIGURE_PACKED_IMAGES: '1' },
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
await cp(new URL('public/', root), site, {
  recursive: true,
  filter: source => basename(source) !== 'StickFigureMayhem HUD.png',
});
let imageBytesSaved = 0;
for (const entry of await readdir(site, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith('.png')) continue;
  const source = join(entry.parentPath, entry.name);
  const original = await readFile(source);
  const packed = await sharp(original).webp({ lossless: true, effort: 5 }).toBuffer();
  const before = await sharp(original).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const after = await sharp(packed).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (before.info.width !== after.info.width || before.info.height !== after.info.height || before.info.channels !== 4 || after.info.channels !== 4) {
    throw new Error(`Packed image dimensions or channels changed: ${entry.name}`);
  }
  // Fully transparent pixels carry no visible color. All alpha and visible RGB must match.
  for (let i = 0; i < before.data.length; i += 4) {
    const alpha = before.data[i + 3];
    if (alpha !== after.data[i + 3] || (alpha > 0 && (
      before.data[i] !== after.data[i] || before.data[i + 1] !== after.data[i + 1] || before.data[i + 2] !== after.data[i + 2]
    ))) throw new Error(`Packed image pixels changed: ${entry.name}`);
  }
  await writeFile(source.replace(/\.png$/, '.webp'), packed);
  await unlink(source);
  imageBytesSaved += original.length - packed.length;
}
await cp(new URL('.next/static/', root), new URL('_next/static/', site), { recursive: true });
await cp(new URL('icon.svg.body', artifacts), new URL('icon.svg', site));
await writeFile(new URL('index.html', site), html);
console.log(`Packaged ${basePath}/ at ${fileURLToPath(site)} and saved ${imageBytesSaved} image bytes`);
