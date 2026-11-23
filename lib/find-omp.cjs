// Locates the local omp CLI. Shared by the ACP entry and the node worker so the
// harness and the harness probe resolve the same binary.
const fs = require('node:fs');
const path = require('node:path');

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

module.exports = { findOmp };
