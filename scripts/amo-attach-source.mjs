#!/usr/bin/env node
// Attach the AMO source-code submission to a just-created version.
//
// AMO requires source for minified/bundled add-ons, but `web-ext sign` has no
// way to send it — the API models `source` as a PATCHable field on the version
// object, so this runs right after the listed submission:
//
//   node scripts/amo-attach-source.mjs \
//     --manifest dist-firefox/manifest.json --source source.zip
//
// Auth is the same JWT scheme web-ext uses, minted from WEB_EXT_API_KEY /
// WEB_EXT_API_SECRET. Exits non-zero on any failure so a publish never goes
// source-less silently. No dependencies — Node 20 built-ins only.

import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const API = 'https://addons.mozilla.org/api/v5';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1 || !process.argv[i + 1]) {
    console.error(`missing --${name}`);
    process.exit(1);
  }
  return process.argv[i + 1];
}

const key = process.env.WEB_EXT_API_KEY;
const secret = process.env.WEB_EXT_API_SECRET;
if (!key || !secret) {
  console.error('WEB_EXT_API_KEY / WEB_EXT_API_SECRET are not set');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(arg('manifest'), 'utf8'));
const addonId = manifest.browser_specific_settings?.gecko?.id;
const version = manifest.version;
if (!addonId) {
  console.error('manifest has no browser_specific_settings.gecko.id');
  process.exit(1);
}

// AMO accepts JWTs valid for at most 5 minutes; backdate iat for clock skew.
function jwt() {
  const now = Math.floor(Date.now() / 1000);
  const enc = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const body = `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc({
    iss: key,
    jti: randomUUID(),
    iat: now - 5,
    exp: now + 240,
  })}`;
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}

async function amo(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `JWT ${jwt()}`, ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

// The version was created seconds ago by web-ext; retry briefly, and follow
// pagination in case the add-on accumulates more versions than one page.
const addon = encodeURIComponent(addonId);
let versionId;
for (let attempt = 1; attempt <= 6 && !versionId; attempt++) {
  let path = `/addons/addon/${addon}/versions/?filter=all_with_unlisted`;
  while (path && !versionId) {
    const page = await amo(path);
    versionId = page.results?.find((v) => v.version === version)?.id;
    path = page.next ? page.next.replace(API, '') : null;
  }
  if (!versionId) {
    console.log(`version ${version} not visible yet (attempt ${attempt}/6); waiting 10s…`);
    await new Promise((r) => setTimeout(r, 10_000));
  }
}
if (!versionId) {
  console.error(`version ${version} not found on ${addonId}`);
  process.exit(1);
}

const srcPath = arg('source');
const form = new FormData();
form.append('source', new Blob([readFileSync(srcPath)], { type: 'application/zip' }), basename(srcPath));
const updated = await amo(`/addons/addon/${addon}/versions/${versionId}/`, {
  method: 'PATCH',
  body: form,
});
if (!updated.source) {
  console.error('PATCH succeeded but the version still reports no source');
  process.exit(1);
}
console.log(`source attached to ${addonId} v${version} (version id ${versionId})`);
