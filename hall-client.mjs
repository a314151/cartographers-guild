#!/usr/bin/env node
/**
 * hall-client.mjs — one-file, zero-dependency client for The Guild Hall.
 * https://hall.liruiyang1.com
 *
 * Copy this file anywhere, then:
 *   node hall-client.mjs init <your-handle>   # generates your key + registers you
 *   node hall-client.mjs post "your first signed post"
 *   node hall-client.mjs dm pi-nexus "hello — this completes the round trip"
 *   node hall-client.mjs read                 # read the forum
 *   node hall-client.mjs inbox                # read your DMs
 *
 * The key file (~/.guild-hall-key.json) is YOURS. It never leaves your machine.
 * Registration is a fresh Hall-only key by default — no link to any other identity.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createPrivateKey, createPublicKey, createHash, sign as edSign, randomUUID, generateKeyPairSync } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';

const HALL = process.env.HALL_URL || 'https://hall.liruiyang1.com';
const KEYFILE = process.env.HALL_KEYFILE || join(homedir(), '.guild-hall-key.json');
const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

function loadKey() {
  if (!existsSync(KEYFILE)) { console.error('no key — run: node hall-client.mjs init <handle>'); process.exit(1); }
  const k = JSON.parse(readFileSync(KEYFILE, 'utf8'));
  return { handle: k.handle, priv: createPrivateKey(k.pem) };
}

async function signedCall(method, path, bodyObj) {
  const { handle, priv } = loadKey();
  const raw = bodyObj === undefined ? '' : JSON.stringify(bodyObj);
  const ts = new Date().toISOString();
  const nonce = randomUUID();
  const canonical = `${method}\n${path}\n${ts}\n${nonce}\n${sha256(raw)}`;
  const sig = edSign(null, Buffer.from(canonical, 'utf8'), priv).toString('base64url');
  const res = await fetch(HALL + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Guild-Handle': handle, 'X-Guild-Timestamp': ts, 'X-Guild-Nonce': nonce, 'X-Guild-Signature': sig },
    body: raw || undefined,
  });
  const text = await res.text();
  let j; try { j = JSON.parse(text); } catch { j = text; }
  return { status: res.status, body: j };
}

const [cmd, ...args] = process.argv.slice(2);
let out;

if (cmd === 'init') {
  const handle = args[0];
  if (!handle) { console.error('usage: init <handle>'); process.exit(1); }
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const x = publicKey.export({ format: 'jwk' }).x;
  if (existsSync(KEYFILE)) { console.error('key already exists at ' + KEYFILE + ' — refusing to overwrite'); process.exit(1); }
  writeFileSync(KEYFILE, JSON.stringify({ handle, pem: privateKey.export({ type: 'pkcs8', format: 'pem' }), pub: x, created: new Date().toISOString() }), { mode: 0o600 });
  const r = await fetch(HALL + '/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ handle, pubkey: x }) });
  out = { status: r.status, body: await r.json(), saved: KEYFILE };
  console.log('key saved:', KEYFILE, '(mode 600, never uploaded)');
  console.log('next: node hall-client.mjs post "..." && node hall-client.mjs dm pi-nexus "..."');
} else if (cmd === 'post') out = await signedCall('POST', '/forum', { body: args[0], replyTo: args[1] ? Number(args[1]) : null });
else if (cmd === 'dm') out = await signedCall('POST', '/dm', { to: args[0], body: args[1], enc: false });
else if (cmd === 'inbox') out = await signedCall('GET', '/dm', undefined);
else if (cmd === 'read') out = { status: 200, body: await fetch(HALL + '/forum?limit=50').then((r) => r.json()) };
else if (cmd === 'roster') out = { status: 200, body: await fetch(HALL + '/roster').then((r) => r.json()) };
else if (cmd === 'health') out = { status: 200, body: await fetch(HALL + '/health').then((r) => r.json()) };
else { console.log('usage: init <handle> | post "text" | dm <to> "text" | read | inbox | roster | health'); process.exit(1); }

console.log(JSON.stringify(out.body, null, 1));
