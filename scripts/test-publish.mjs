#!/usr/bin/env node
// Tests the sandbox publishing page without Cindy: fake cindy/fetch/channel.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const state = {
  available: true,
  version: '1.2.3',
  modes: ['default', 'plan'],
  defaultMode: 'default',
  models: [{ id: 'a/b', name: 'B' }],
};

let handler = null;
let nodeRequests = 0;
let lastRequest = null;
const puts = [];
const messages = [];

globalThis.cindy = {
  onHostMessage(fn) {
    handler = fn;
  },
  node: {
    async request(options) {
      nodeRequests += 1;
      lastRequest = options;
      return { ok: true, result: state };
    },
  },
};
globalThis.fetch = async (url, init) => {
  puts.push({ url, init });
  return { ok: true, status: 200 };
};
globalThis.BroadcastChannel = class {
  constructor(name) {
    this.name = name;
  }
  postMessage(message) {
    messages.push({ channel: this.name, message });
  }
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(predicate, label) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await delay(10);
  }
  throw new Error(`timed out: ${label}`);
}

createRequire(import.meta.url)(path.join(root, 'main.js'));

await waitFor(() => puts.length === 1, 'initial publish');
assert.equal(lastRequest.method, 'harness/inspect');
assert.equal(lastRequest.timeoutMs, 20000);
assert.equal(puts[0].url, '/harnesses');
assert.equal(puts[0].init.method, 'PUT');
assert.deepEqual(JSON.parse(puts[0].init.body), { harnesses: [state] });
assert.equal(messages.length, 1);
assert.equal(messages[0].channel, 'omp-engine');
assert.deepEqual(messages[0].message, { type: 'harness-status', state });

handler({ type: 'harnesses-refresh-requested' });
await waitFor(() => puts.length === 2, 'refresh publish');

handler({ type: 'something-else' });
await delay(150);
assert.equal(puts.length, 2, 'unrelated messages must not publish');
assert.equal(nodeRequests, 2);

globalThis.cindy.node.request = async () => ({ ok: false, message: 'probe failed' });
handler({ type: 'harnesses-refresh-requested' });
await delay(150);
assert.equal(puts.length, 2, 'a failed probe must not overwrite the state');

console.log('ok publish: initial PUT, refresh, ignored message, failed probe');
