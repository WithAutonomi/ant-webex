import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync, cpSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = (p) => resolve(__dirname, 'src', p);
const watching = process.argv.includes('--watch');

// --firefox builds for Firefox, otherwise Chrome/Chromium (default).
const browser = process.argv.includes('--firefox') ? 'firefox' : 'chrome';
const outDir = resolve(__dirname, browser === 'firefox' ? 'dist-firefox' : 'dist');
const dist = (p) => resolve(outDir, p);

console.log(`Building for ${browser} → ${outDir.split(/[\\/]/).pop()}/`);

mkdirSync(dist('popup'), { recursive: true });
mkdirSync(dist('onboarding'), { recursive: true });
mkdirSync(dist('assets/icons'), { recursive: true });

// Firefox doesn't support ESM service workers yet — use IIFE.
const bgFormat = browser === 'firefox' ? 'iife' : 'esm';

const commonOptions = {
  bundle: true,
  target: browser === 'firefox' ? 'firefox128' : 'chrome120',
  sourcemap: watching ? 'inline' : false,
  minify: !watching,
  logLevel: 'info',
};

/**
 * Merge base manifest with browser-specific overlay.
 * The base has everything except `background`, the overlay adds it.
 */
function buildManifest() {
  const base = JSON.parse(readFileSync(src('manifest.json'), 'utf-8'));
  const overlay = JSON.parse(
    readFileSync(src(`manifest.${browser}.json`), 'utf-8'),
  );
  const merged = { ...base, ...overlay };
  writeFileSync(dist('manifest.json'), JSON.stringify(merged, null, 2));
}

async function build() {
  await Promise.all([
    esbuild.build({
      ...commonOptions,
      entryPoints: [src('background/index.ts')],
      outfile: dist('background.js'),
      format: bgFormat,
    }),
    esbuild.build({
      ...commonOptions,
      entryPoints: [src('content/index.ts')],
      outfile: dist('content.js'),
      format: 'iife',
    }),
    esbuild.build({
      ...commonOptions,
      entryPoints: [src('popup/index.ts')],
      outfile: dist('popup/index.js'),
      format: 'iife',
    }),
    esbuild.build({
      ...commonOptions,
      entryPoints: [src('onboarding/index.ts')],
      outfile: dist('onboarding/index.js'),
      format: 'iife',
    }),
  ]);

  buildManifest();
  copyFileSync(src('popup/index.html'), dist('popup/index.html'));
  copyFileSync(src('popup/style.css'), dist('popup/style.css'));
  copyFileSync(src('onboarding/index.html'), dist('onboarding/index.html'));
  copyFileSync(src('onboarding/style.css'), dist('onboarding/style.css'));
  if (existsSync(resolve(__dirname, 'assets'))) {
    cpSync(resolve(__dirname, 'assets'), dist('assets'), { recursive: true });
  }
}

await build();

if (watching) {
  console.log('Watching for changes...');
  const contexts = await Promise.all([
    esbuild.context({
      ...commonOptions,
      entryPoints: [src('background/index.ts')],
      outfile: dist('background.js'),
      format: bgFormat,
    }),
    esbuild.context({
      ...commonOptions,
      entryPoints: [src('content/index.ts')],
      outfile: dist('content.js'),
      format: 'iife',
    }),
    esbuild.context({
      ...commonOptions,
      entryPoints: [src('popup/index.ts')],
      outfile: dist('popup/index.js'),
      format: 'iife',
    }),
    esbuild.context({
      ...commonOptions,
      entryPoints: [src('onboarding/index.ts')],
      outfile: dist('onboarding/index.js'),
      format: 'iife',
    }),
  ]);
  await Promise.all(contexts.map((ctx) => ctx.watch()));
}
