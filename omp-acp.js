// omp-acp.js — Cindy harness entry.
//
// Cindy starts this file with "raw stdio" whenever the user picks the omp
// engine for a task. stdin/stdout carry ACP JSON-RPC, one message per line.
// All we do is start `omp acp` and forward the bytes in both directions:
// model choice, tool permissions, mode switching and usage all travel over
// the same ACP channel, so Cindy drives omp exactly like it drives the
// built-in engines.
//
// Logs go to stderr (Cindy writes them to the plugin log). stdout must stay
// pure protocol.

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

// Empty = omp's default profile (what plain `omp` in a terminal uses).
// Set to e.g. 'nova' to run the engine against an isolated profile.
const PROFILE = process.env.OMP_HARNESS_PROFILE || '';

function isExecutable(file) {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function findOmp() {
  if (process.env.OMP_HARNESS_BIN) return process.env.OMP_HARNESS_BIN;

  const exts = process.platform === 'win32' ? ['.exe', '.cmd'] : [''];
  const dirs = (process.env.PATH || '')
    .split(path.delimiter)
    .filter(Boolean)
    .concat([
      '/opt/homebrew/bin',
      '/usr/local/bin',
      path.join(process.env.HOME || '', '.local', 'bin'),
    ]);

  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, `omp${ext}`);
      if (isExecutable(candidate)) return candidate;
    }
  }
  return null;
}

const ompBin = findOmp();
if (!ompBin) {
  console.error(
    'omp not found: install the omp CLI or set OMP_HARNESS_BIN to its path.',
  );
  process.exit(127);
}

const args = PROFILE ? ['--profile', PROFILE, 'acp'] : ['acp'];

let agent;
try {
  agent = spawn(ompBin, args, { stdio: ['pipe', 'pipe', 'inherit'] });
} catch (error) {
  console.error(`failed to start ${ompBin} ${args.join(' ')}: ${error && error.message}`);
  process.exit(1);
}

process.stdin.pipe(agent.stdin);
agent.stdout.pipe(process.stdout);

agent.on('error', (error) => {
  console.error(`omp acp failed: ${error && error.message}`);
  process.exit(1);
});

agent.on('exit', (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});

// Cindy ends this process when the task ends or the plugin is disabled.
// Take the omp process down with us so nothing is left running.
function shutdown() {
  try {
    agent.kill('SIGTERM');
  } catch {
    /* already gone */
  }
  setTimeout(() => process.exit(0), 1000).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
