#!/usr/bin/env node
// ACP smoke test: proxy handshake, clean failure without omp, worker probe.
// Sends no prompt, so it never calls a model. Requires the omp CLI.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const entry = path.join(root, 'omp-acp.js');
const worker = path.join(root, 'node', 'worker.cjs');

const require = createRequire(import.meta.url);
const { findOmp } = require('../lib/find-omp.cjs');
const realOmp = findOmp();
if (!realOmp) {
  throw new Error('omp not found; install the CLI or set OMP_HARNESS_BIN');
}

// Run the proxy against a wrapper that points omp at a throwaway session dir,
// so a smoke run never touches the user's omp history.
const smokeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omp-engine-smoke-'));
const sessionDir = path.join(smokeDir, 'sessions');
fs.mkdirSync(sessionDir);
const wrapper = path.join(smokeDir, 'omp');
fs.writeFileSync(
  wrapper,
  `#!/bin/sh\nexec "${realOmp}" --no-session --session-dir "${sessionDir}" "$@"\n`,
);
fs.chmodSync(wrapper, 0o755);
process.on('exit', () => fs.rmSync(smokeDir, { recursive: true, force: true }));

const initialize = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: 1, clientCapabilities: {} },
});

function waitForExit(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

async function handshake() {
  const child = spawn(process.execPath, [entry], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, OMP_HARNESS_BIN: wrapper },
  });
  const messages = [];
  let buffer = '';
  let stderr = '';

  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      messages.push(message);
      if (message.id === 1 && message.result) {
        child.stdin.write(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 2,
            method: 'session/new',
            params: { cwd: os.tmpdir(), mcpServers: [] },
          }) + '\n',
        );
      } else if (message.id === 2) {
        child.stdin.end();
      }
    }
  });

  child.stdin.write(initialize + '\n');
  const exit = await waitForExit(child, 20000);
  return { exit, messages, stderr };
}

function findReply(messages, id) {
  return messages.find((message) => message.id === id);
}

const handshakeResult = await handshake();
const initialized = findReply(handshakeResult.messages, 1);
assert.ok(initialized && initialized.result, 'initialize must succeed');
assert.equal(initialized.result.agentInfo.name, 'omp');

const session = findReply(handshakeResult.messages, 2);
assert.ok(session && session.result && session.result.sessionId, 'session/new must succeed');
const modelOption = session.result.configOptions.find((option) => option.id === 'model');
const modeOption = session.result.configOptions.find((option) => option.id === 'mode');
assert.ok(modelOption && modelOption.options.length > 0, 'omp must report models');
assert.ok(modeOption && modeOption.options.length > 0, 'omp must report modes');
assert.equal(handshakeResult.exit.code, 0, `proxy must exit 0, stderr: ${handshakeResult.stderr}`);
const sessionFiles = fs.existsSync(sessionDir)
  ? fs.readdirSync(sessionDir).filter((name) => name.endsWith('.jsonl'))
  : [];
assert.ok(
  sessionFiles.length > 0,
  'omp must write its session metadata into the throwaway dir, not the user profile',
);
console.log(
  `ok handshake: omp ${initialized.result.agentInfo.version}, ${modelOption.options.length} models, ` +
    `${modeOption.options.map((option) => option.value).join('/')}`,
);

const broken = spawn(process.execPath, [entry], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, OMP_HARNESS_BIN: '/nonexistent/omp-smoke-test' },
});
let brokenStderr = '';
broken.stderr.on('data', (chunk) => {
  brokenStderr += chunk;
});
broken.stdin.write(initialize + '\n');
const brokenExit = await waitForExit(broken, 5000);
assert.equal(brokenExit.code, 1, 'a missing binary must fail with exit code 1');
assert.ok(!/Unhandled 'error' event/.test(brokenStderr), 'a missing binary must not raise an uncaught error');
assert.match(brokenStderr, /omp acp failed/, 'the failure must be reported on stderr');
console.log('ok missing binary: clean failure');

const probe = spawn(process.execPath, [worker], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, OMP_HARNESS_BIN: wrapper },
});
let probeOutput = '';
probe.stdout.on('data', (chunk) => {
  probeOutput += chunk;
});
probe.stdin.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'harness/inspect' }) + '\n');
const probeExit = await waitForExit(probe, 25000);
assert.equal(probeExit.code, 0, 'the worker must exit cleanly');
const probeResult = JSON.parse(probeOutput.trim()).result;
assert.equal(probeResult.available, true, 'the probe must find omp');
assert.ok(probeResult.version, 'the probe must report the version');
assert.ok(probeResult.models.length > 0, 'the probe must report models');
assert.ok(probeResult.models.length <= 200, 'the model list must fit the host limit');
assert.ok(probeResult.modes.includes('default'), 'the probe must report the default mode');
console.log(
  `ok worker probe: omp ${probeResult.version}, ${probeResult.models.length} models, ` +
    `modes ${probeResult.modes.join('/')}`,
);

console.log('smoke test passed');
