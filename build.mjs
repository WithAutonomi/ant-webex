import * as esbuild from 'esbuild';
import {
  copyFileSync,
  mkdirSync,
  cpSync,
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
} from 'fs';
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
  // Inline imported images as data URLs (the content script can't reference
  // page-relative or extension assets without web_accessible_resources).
  loader: { '.png': 'dataurl' },
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

/**
 * Regenerate src/i18n/content-locales.json from the `content` section of every
 * locale file, so the content script can bundle its (small) string subset
 * without fetching packaged assets. The per-locale files stay the single
 * source of truth; this artifact is committed only so `tsc` resolves the
 * import — it's rewritten on every build.
 */
function generateContentLocales() {
  const localesDir = src('i18n/locales');
  const out = {};
  for (const file of readdirSync(localesDir)) {
    if (!file.endsWith('.json')) continue;
    const lang = file.slice(0, -'.json'.length);
    const catalog = JSON.parse(readFileSync(resolve(localesDir, file), 'utf-8'));
    if (catalog.content) out[lang] = catalog.content;
  }
  writeFileSync(
    src('i18n/content-locales.json'),
    JSON.stringify(out, null, 2) + '\n',
  );
}

/** Copy both locale stores into a dist: native _locales (manifest __MSG__
 *  fields) and the runtime dictionary fetched by popup/onboarding. */
function copyLocaleAssets() {
  if (existsSync(src('_locales'))) {
    cpSync(src('_locales'), dist('_locales'), { recursive: true });
  }
  cpSync(src('i18n/locales'), dist('i18n/locales'), { recursive: true });
}

async function build() {
  // Must run before esbuild bundles content/index.ts, which imports the
  // generated content-locales.json.
  generateContentLocales();
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
  copyLocaleAssets();
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
