#!/usr/bin/env node
// Checks which omp catalog entries may reach Cindy's model selector.
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const { isChatModel } = require(path.join(root, 'lib', 'chat-models.cjs'));

const chat = (selector, name) => ({ kind: 'chat', selector, name: name ?? selector });

// omp 19.1.1 files these under kind: "chat"; they still cannot answer a prompt.
for (const id of [
  'opencode-go/text-embedding-3-small',
  'opencode-go/qwen3-embedding-8b',
  'opencode-zen/gemini-embedding-001',
  'opencode-zen/gemini-embedding-2',
]) {
  assert.equal(isChatModel(chat(id)), false, `${id} must not be offered`);
}

// Names carry the same signal when the selector does not.
assert.equal(isChatModel(chat('vendor/m1', 'Gemini Embedding 2')), false);

// Real chat models survive, including ones whose name contains "embed"-like text.
for (const id of [
  'opencode-go/deepseek-v4.1-flash',
  'opencode-go/claude-haiku-5-5',
  'opencode-go/beam-free',
  'opencode-zen/claude-fable-5-2',
  'vendor/text-embed1',
  'vendor/embedx-1',
]) {
  assert.equal(isChatModel(chat(id)), true, `${id} must be offered`);
}

// Non-chat catalog entries and malformed rows stay out.
assert.equal(isChatModel({ kind: 'image', selector: 'vendor/img-1' }), false);
assert.equal(isChatModel({ kind: 'chat' }), false);
assert.equal(isChatModel(null), false);

console.log('ok chat models: embeddings dropped, chat models kept');
