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

// Node version managers keep their global bins under per-version directories;
// check them too so an npm-installed omp is found without a login shell.
function versionedNodeBins(home) {
  const roots = [
    [path.join(home, '.nvm', 'versions', 'node'), 'bin'],
    [path.join(home, '.fnm', 'node-versions'), path.join('installation', 'bin')],
    [path.join(home, '.local', 'share', 'fnm', 'node-versions'), path.join('installation', 'bin')],
  ];
  const dirs = [];
  for (const [root, suffix] of roots) {
    let names;
    try {
      names = fs.readdirSync(root);
    } catch {
      continue;
    }
    for (const name of names) dirs.push(path.join(root, name, suffix));
  }
  return dirs;
}

function findOmp() {
  if (process.env.OMP_HARNESS_BIN) {
    // The entry runs in a temp dir, so a relative override would be meaningless.
    return path.resolve(process.env.OMP_HARNESS_BIN);
  }
  // Windows would need the package's JS entry launched with node.exe instead of
  // the .cmd shim; this build targets macOS and Linux.
  if (process.platform === 'win32') return null;

  const home = process.env.HOME || '';
  const dirs = (process.env.PATH || '')
    .split(path.delimiter)
    .filter(Boolean)
    .concat(
      [
        '/opt/homebrew/bin',
        '/usr/local/bin',
        '/opt/local/bin',
        path.join(home, '.local', 'bin'),
        path.join(home, '.bun', 'bin'),
        path.join(home, '.volta', 'bin'),
        path.join(home, '.npm-global', 'bin'),
      ],
      versionedNodeBins(home),
    );

  for (const dir of dirs) {
    const candidate = path.join(dir, 'omp');
    if (isExecutable(candidate)) return candidate;
  }
  return null;
}

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
