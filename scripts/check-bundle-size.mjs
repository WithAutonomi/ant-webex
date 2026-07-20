#!/usr/bin/env node
/**
 * Bundle-size budget. `content.js` is injected on <all_urls>, so a size
 * regression there is a real per-page perf cost — fail CI when a bundle
 * exceeds its budget. Run after `npm run build`. Budgets carry deliberate
 * headroom; tighten them as bundles shrink, or raise (with a reason) when
 * growth is justified.
 */
import { statSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const KB = 1024;

// path (relative to dist/) -> budget in KB
const BUDGETS = {
  'content.js': 48, // perf-critical: injected on every page
  'popup/index.js': 32,
  'background.js': 24,
  'onboarding/index.js': 16,
};

let failed = false;
console.log('Bundle sizes (dist/):');
for (const [rel, budgetKb] of Object.entries(BUDGETS)) {
  const p = resolve(root, 'dist', rel);
  let size;
  try {
    size = statSync(p).size;
  } catch {
    console.error(`  ✗ ${rel} — MISSING (run \`npm run build\` first)`);
    failed = true;
    continue;
  }
  const kb = size / KB;
  const ok = kb <= budgetKb;
  if (!ok) failed = true;
  console.log(
    `  ${ok ? '✓' : '✗'} ${rel.padEnd(20)} ${kb.toFixed(1).padStart(6)} KB / ${budgetKb} KB`,
  );
}

if (failed) {
  console.error(
    '\nBundle-size budget exceeded. Trim the bundle, or if the growth is ' +
      'justified raise the budget in scripts/check-bundle-size.mjs.',
  );
  process.exit(1);
}
console.log('\nAll bundles within budget.');
