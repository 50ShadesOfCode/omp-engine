#!/usr/bin/env node
// Checks the worker's availability reasons and the reportsUsage flag.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const worker = path.join(root, 'node', 'worker.cjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omp-engine-availability-'));
process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));

function runInspect(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [worker], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`worker exited ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(output.trim()).result);
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'harness/inspect' }) + '\n');
  });
}

function fakeBin(name, body) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, `#!/bin/sh\n${body}\n`);
  fs.chmodSync(file, 0o755);
  return file;
}

const noAcp = fakeBin('no-acp', 'exit 1');
const broken = fakeBin('broken', 'if [ "$1" = "acp" ] && [ "$2" = "--help" ]; then exit 0; fi\nexit 1');

const missing = await runInspect({ OMP_HARNESS_BIN: path.join(dir, 'missing') });
assert.equal(missing.reason, 'not-installed');

const noAcpResult = await runInspect({ OMP_HARNESS_BIN: noAcp });
assert.equal(noAcpResult.reason, 'no-acp');

const brokenResult = await runInspect({ OMP_HARNESS_BIN: broken });
assert.equal(brokenResult.reason, 'probe-failed');

const real = await runInspect({});
assert.equal(real.available, true);
assert.equal(real.reportsUsage, true);

console.log('ok availability: not-installed, no-acp, probe-failed, available + reportsUsage');
