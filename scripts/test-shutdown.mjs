#!/usr/bin/env node
// Shutdown test: the entry must stop the agent and its children on SIGTERM.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const entry = path.join(root, 'omp-acp.js');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omp-engine-shutdown-'));
const parentPidFile = path.join(dir, 'parent.pid');
const childPidFile = path.join(dir, 'child.pid');
const fake = path.join(dir, 'fake-omp');

fs.writeFileSync(
  fake,
  `#!/bin/sh\nsleep 30 &\necho $! > "${childPidFile}"\necho $$ > "${parentPidFile}"\nwait\n`,
);
fs.chmodSync(fake, 0o755);

process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(predicate, label, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await delay(20);
  }
  throw new Error(`timed out: ${label}`);
}
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}
const readPid = (file) => {
  try {
    return Number(fs.readFileSync(file, 'utf8').trim());
  } catch {
    return null;
  }
};

const proxy = spawn(process.execPath, [entry], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, OMP_HARNESS_BIN: fake },
});
const exited = new Promise((resolve) => proxy.on('exit', (code, signal) => resolve({ code, signal })));

await waitFor(() => readPid(parentPidFile) && readPid(childPidFile), 'fake harness pids');
const parentPid = readPid(parentPidFile);
const childPid = readPid(childPidFile);
assert.ok(alive(parentPid) && alive(childPid), 'the fake harness must start');

proxy.kill('SIGTERM');
const exit = await exited;
assert.equal(exit.code, 0, 'the entry must exit 0 after a deliberate stop');

await waitFor(() => !alive(parentPid) && !alive(childPid), 'process group cleanup', 5000);
console.log(`ok shutdown: agent ${parentPid} and child ${childPid} are gone`);
