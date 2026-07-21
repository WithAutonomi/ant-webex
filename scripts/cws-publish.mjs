#!/usr/bin/env node
/**
 * Publish a packaged extension zip to the Chrome Web Store via the CWS API.
 *
 * Deliberately self-contained (Node's global fetch + fs, no npm dependency and
 * no third-party GitHub Action) so the store credentials are never handed to
 * code we don't control. Credentials come from the environment; the zip and
 * publish audience come from flags.
 *
 * Env:   CWS_CLIENT_ID, CWS_CLIENT_SECRET, CWS_REFRESH_TOKEN, CWS_EXTENSION_ID
 * Usage: node scripts/cws-publish.mjs --source chrome.zip --target trustedTesters
 *          --target: "default" (public) | "trustedTesters"
 *
 * The item must already exist on the Web Store (created once in the dashboard
 * with its listing metadata) — this uploads a new version and publishes it.
 * Publishing enters Google's review queue; the API doesn't bypass it.
 */
import { readFileSync } from 'fs';

const argv = process.argv.slice(2);
const flag = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : def;
};
const source = flag('source');
const target = flag('target', 'default');

const { CWS_CLIENT_ID, CWS_CLIENT_SECRET, CWS_REFRESH_TOKEN, CWS_EXTENSION_ID } = process.env;
for (const [k, v] of Object.entries({ CWS_CLIENT_ID, CWS_CLIENT_SECRET, CWS_REFRESH_TOKEN, CWS_EXTENSION_ID })) {
  if (!v) {
    console.error(`::error::Missing required env var ${k}`);
    process.exit(1);
  }
}
if (!source) {
  console.error('::error::--source <zip> is required');
  process.exit(1);
}
if (!['default', 'trustedTesters'].includes(target)) {
  console.error(`::error::--target must be "default" or "trustedTesters" (got "${target}")`);
  process.exit(1);
}

async function main() {
  // 1) Exchange the refresh token for a short-lived access token.
  const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CWS_CLIENT_ID,
      client_secret: CWS_CLIENT_SECRET,
      refresh_token: CWS_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  const token = await tokenResp.json();
  if (!token.access_token) {
    console.error('::error::OAuth token exchange failed:', token.error, token.error_description ?? '');
    process.exit(1);
  }
  const auth = { Authorization: `Bearer ${token.access_token}`, 'x-goog-api-version': '2' };

  // 2) Upload the new package to the existing item.
  console.log(`Uploading ${source} to item ${CWS_EXTENSION_ID} …`);
  const up = await fetch(
    `https://www.googleapis.com/upload/chromewebstore/v1.1/items/${CWS_EXTENSION_ID}`,
    { method: 'PUT', headers: auth, body: readFileSync(source) },
  );
  const upJson = await up.json();
  if (upJson.uploadState !== 'SUCCESS') {
    console.error('::error::Upload failed:', JSON.stringify(upJson, null, 2));
    process.exit(1);
  }
  console.log('Upload OK.');

  // 3) Publish to the chosen audience.
  console.log(`Publishing (target: ${target}) …`);
  const pub = await fetch(
    `https://www.googleapis.com/chromewebstore/v1.1/items/${CWS_EXTENSION_ID}/publish?publishTarget=${target}`,
    { method: 'POST', headers: { ...auth, 'Content-Length': '0' } },
  );
  const pubJson = await pub.json();
  const statuses = Array.isArray(pubJson.status) ? pubJson.status : [];
  const bad = statuses.filter((s) => !['OK', 'ITEM_PENDING_REVIEW'].includes(s));
  if (!pub.ok || bad.length) {
    console.error('::error::Publish failed:', JSON.stringify(pubJson, null, 2));
    process.exit(1);
  }
  console.log('Publish submitted:', statuses.join(', ') || 'OK', '— now in Google review.');
}

main().catch((e) => {
  console.error('::error::', e?.message ?? e);
  process.exit(1);
});
