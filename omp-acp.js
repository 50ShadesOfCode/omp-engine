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

// Empty = omp's default profile (what plain `omp` in a terminal uses).
// Set to e.g. 'nova' to run the engine against an isolated profile.
const PROFILE = process.env.OMP_HARNESS_PROFILE || '';

const { findOmp } = require('./lib/find-omp.cjs');

const ompBin = findOmp();
if (!ompBin) {
  console.error(
    'omp not found: install the omp CLI (macOS/Linux) or set OMP_HARNESS_BIN to its absolute path.',
  );
  process.exit(127);
}

const args = PROFILE ? ['--profile', PROFILE, 'acp'] : ['acp'];

let agent;
try {
  agent = spawn(ompBin, args, {
    stdio: ['pipe', 'pipe', 'inherit'],
    // Own process group so a shutdown reaches omp's tool subprocesses too.
    detached: process.platform !== 'win32',
  });
} catch (error) {
  console.error(`failed to start ${ompBin} ${args.join(' ')}: ${error && error.message}`);
  process.exit(1);
}

// Both pipes fail when the other side goes away: Cindy closes the task, or omp
// exits before reading. Those are normal shutdowns, not unhandled exceptions.
agent.stdin.on('error', () => {});
process.stdin.on('error', () => {});
process.stdout.on('error', () => {
  signalAgent('SIGTERM');
  process.exit(0);
});

process.stdin.pipe(agent.stdin);
agent.stdout.pipe(process.stdout);

agent.on('error', (error) => {
  console.error(`omp acp failed: ${error && error.message}`);
  process.exit(1);
});

agent.on('exit', (code, signal) => {
  process.exit(shuttingDown ? 0 : (code ?? (signal ? 1 : 0)));
});

let shuttingDown = false;

// Signal omp's whole process group on POSIX so its shell commands go down too;
// Windows has no process groups here, so fall back to the process itself.
function signalAgent(signal) {
  if (process.platform !== 'win32' && agent.pid) {
    try {
      process.kill(-agent.pid, signal);
      return;
    } catch {
      /* group already gone, fall through to the process */
    }
  }
  try {
    agent.kill(signal);
  } catch {
    /* already gone */
  }
}

// Cindy ends this process when the task ends or the plugin is disabled.
// Take the omp process down with us so nothing is left running.
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    agent.stdin.end();
  } catch {
    /* already closed */
  }
  signalAgent('SIGTERM');
  setTimeout(() => {
    signalAgent('SIGKILL');
    setTimeout(() => process.exit(0), 250);
  }, 2000);
}

// Cindy closing our stdin already ends omp's stdin through the pipe; give it a
// moment to finish on its own, then take it down.
process.stdin.on('end', () => {
  setTimeout(shutdown, 2000);
});
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
