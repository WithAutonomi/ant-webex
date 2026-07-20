#!/usr/bin/env node
/**
 * Permissions-change guard (PR-only, non-failing). Changes to the manifest's
 * `permissions` / `host_permissions` trigger Chrome Web Store re-review and a
 * user re-consent prompt, and are a security-review point. This annotates the
 * PR when those keys change so permission creep stays visible instead of
 * slipping through. It never fails the build — legitimate changes happen.
 *
 * Usage: node scripts/check-permissions.mjs <base-git-ref>
 */
import { execSync } from 'child_process';
import { readFileSync, appendFileSync } from 'fs';

const base = process.argv[2];
if (!base) {
  console.log('No base ref given — skipping permissions guard.');
  process.exit(0);
}

const pick = (m) => ({
  permissions: [...(m.permissions ?? [])].sort(),
  host: [...(m.host_permissions ?? [])].sort(),
});

const current = pick(JSON.parse(readFileSync('src/manifest.json', 'utf8')));
let baseManifest;
try {
  baseManifest = pick(JSON.parse(execSync(`git show ${base}:src/manifest.json`, { encoding: 'utf8' })));
} catch {
  console.log('No base manifest to compare against — skipping.');
  process.exit(0);
}

const diff = (a, b) => ({
  added: b.filter((x) => !a.includes(x)),
  removed: a.filter((x) => !b.includes(x)),
});
const p = diff(baseManifest.permissions, current.permissions);
const h = diff(baseManifest.host, current.host);

if (![p.added, p.removed, h.added, h.removed].some((l) => l.length)) {
  console.log('No permission or host_permission changes.');
  process.exit(0);
}

const lines = [];
if (p.added.length) lines.push(`added permissions: ${p.added.join(', ')}`);
if (p.removed.length) lines.push(`removed permissions: ${p.removed.join(', ')}`);
if (h.added.length) lines.push(`added host_permissions: ${h.added.join(', ')}`);
if (h.removed.length) lines.push(`removed host_permissions: ${h.removed.join(', ')}`);

const summary = lines.join(' | ');
console.log(
  `::warning::Manifest permission change (triggers store re-review + user re-consent) — ${summary}`,
);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `### ⚠️ Manifest permission change\n\nThis PR changes permissions that trigger **store re-review** and a **user re-consent** prompt:\n\n` +
      lines.map((l) => `- ${l}`).join('\n') +
      '\n',
  );
}
