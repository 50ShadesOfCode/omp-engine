// Required by ghost.json -> node.entry. Besides staying idle for the host
// protocol, the worker answers `harness/inspect`: a short ACP probe that reads
// the local omp version, modes and chat model list for `PUT /harnesses`.
const { execFile, spawn } = require('node:child_process');
const os = require('node:os');
const readline = require('node:readline');
const { findOmp } = require('../lib/find-omp.cjs');

const PROBE_TIMEOUT_MS = 12000;
const CATALOG_TIMEOUT_MS = 8000;
const USAGE_TIMEOUT_MS = 15000;
const MAX_MODELS = 200;

function reply(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

function clip(text, limit) {
  const value = String(text ?? '');
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}

// Same profile the harness entry uses, so the catalog matches its model ids.
function ompArgs(...args) {
  const profile = process.env.OMP_HARNESS_PROFILE;
  return profile ? ['--profile', profile, ...args] : args;
}

const MODE_IDS = new Map([
  ['default', 'default'],
  ['plan', 'plan'],
  ['accept-edits', 'acceptEdits'],
  ['acceptEdits', 'acceptEdits'],
  ['auto', 'auto'],
]);

// ACP also offers non-chat catalog kinds (embeddings, search, TTS, STT) as
// switchable models. Only the chat catalog is usable for a task, so read it and
// use it to filter the ACP list. A missing or broken catalog falls back to the
// ACP list itself.
function readChatCatalog(bin) {
  return new Promise((resolve) => {
    execFile(
      bin,
      ompArgs('models', '--json', '--kind=chat'),
      { timeout: CATALOG_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          resolve(null);
          return;
        }
        try {
          const parsed = JSON.parse(stdout);
          const list = Array.isArray(parsed) ? parsed : parsed.models;
          if (!Array.isArray(list)) {
            resolve(null);
            return;
          }
          const ids = new Set();
          for (const model of list) {
            if (model && model.kind === 'chat' && typeof model.selector === 'string') {
              ids.add(model.selector);
            }
          }
          resolve(ids.size ? ids : null);
        } catch {
          resolve(null);
        }
      },
    );
  });
}

// Reads provider quota windows from `omp usage --json`. Any failure, timeout or
// empty report means "no data", which the host shows as no usage.
function readUsage(bin) {
  return new Promise((resolve) => {
    execFile(
      bin,
      ompArgs('usage', '--json'),
      { timeout: USAGE_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          resolve(null);
          return;
        }
        try {
          const parsed = JSON.parse(stdout);
          const windows = [];
          const balances = [];
          for (const report of parsed.reports || []) {
            const plan = report.metadata?.planType || report.provider || 'omp';
            for (const limit of report.limits || []) {
              const remaining = limit.amount?.remainingFraction;
              const resetsAt = limit.window?.resetsAt;
              const label = limit.window?.label || limit.label || limit.id;
              if (typeof remaining !== 'number' || typeof resetsAt !== 'number' || !label) {
                continue;
              }
              windows.push({
                label: `${plan} · ${label}`,
                remainingPercent: Math.max(0, Math.min(100, Math.round(remaining * 100))),
                resetsAt,
              });
            }
            for (const balance of report.balances || []) {
              if (balance && typeof balance.currency === 'string' && typeof balance.amount === 'string') {
                balances.push({ currency: balance.currency, amount: balance.amount });
              }
            }
          }
          if (!windows.length && !balances.length) {
            resolve(null);
            return;
          }
          const updatedAt = typeof parsed.generatedAt === 'number' ? parsed.generatedAt : Date.now();
          resolve({
            updatedAt,
            ...(windows.length ? { windows } : {}),
            ...(balances.length ? { balances } : {}),
          });
        } catch {
          resolve(null);
        }
      },
    );
  });
}

// Starts `omp acp` without a session, asks for the initial config options and
// stops it. No prompt is sent, so this never calls a model.
function probeConfig(bin) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, ompArgs('--no-session', 'acp'), {
      stdio: ['pipe', 'pipe', 'ignore'],
    });

    let buffer = '';
    let settled = false;
    let timer;
    let version;

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.stdin.end();
        child.kill('SIGTERM');
      } catch {
        /* already gone */
      }
      setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* already gone */
        }
      }, 500).unref();
      if (error) reject(error);
      else resolve(value);
    };

    timer = setTimeout(() => finish(new Error('omp ACP probe timed out')), PROBE_TIMEOUT_MS);
    timer.unref();

    const send = (message) => {
      try {
        child.stdin.write(JSON.stringify(message) + '\n');
      } catch {
        /* finish() reports the failure */
      }
    };

    child.on('error', (error) => finish(error));
    child.on('exit', (code, signal) => {
      finish(new Error(`omp exited before answering (code ${code ?? signal})`));
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
        if (message.id === 1 && message.result) {
          version = message.result.agentInfo?.version;
          send({
            jsonrpc: '2.0',
            id: 2,
            method: 'session/new',
            params: { cwd: os.tmpdir(), mcpServers: [] },
          });
        } else if (message.id === 2) {
          if (!message.result) {
            finish(new Error(clip(message.error?.message, 120) || 'session/new failed'));
            continue;
          }
          finish(null, {
            version,
            configOptions: message.result.configOptions || [],
          });
        }
      }
    });

    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: 1, clientCapabilities: {} },
    });
  });
}

async function inspectHarness() {
  const bin = findOmp();
  if (!bin) {
    return {
      available: false,
      reason: 'not-installed',
      message: 'Install the omp CLI (macOS/Linux) or set OMP_HARNESS_BIN.',
    };
  }

  const [probe, chatCatalog] = await Promise.all([probeConfig(bin), readChatCatalog(bin)]);
  const config = probe.configOptions;
  const modelOption = config.find((entry) => entry.id === 'model');
  const modeOption = config.find((entry) => entry.id === 'mode');

  let options = modelOption?.options || [];
  if (chatCatalog) {
    const chatOnly = options.filter((option) => chatCatalog.has(option.value));
    if (chatOnly.length) options = chatOnly;
  }

  const seen = new Set();
  const models = [];
  for (const option of options) {
    const id = clip(option.value, 256);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    models.push({
      id,
      name: clip(option.name || option.value, 200),
      ...(option.description ? { description: clip(option.description, 200) } : {}),
    });
    if (models.length === MAX_MODELS) break;
  }

  const modes = [];
  for (const option of modeOption?.options || []) {
    const mapped = MODE_IDS.get(option.value);
    if (mapped && !modes.includes(mapped)) modes.push(mapped);
  }
  const defaultMode = MODE_IDS.get(modeOption?.currentValue);

  return {
    available: true,
    reportsUsage: true,
    version: clip(probe.version, 64) || undefined,
    ...(modes.length ? { modes, ...(defaultMode ? { defaultMode } : {}) } : {}),
    ...(models.length ? { models } : {}),
  };
}

readline.createInterface({ input: process.stdin }).on('line', async function (line) {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    reply({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    return;
  }
  if (request.method === 'usage') {
    const bin = findOmp();
    reply({ jsonrpc: '2.0', id: request.id, result: bin ? await readUsage(bin) : null });
    return;
  }
  if (request.method === 'harness/inspect') {
    let result;
    try {
      result = await inspectHarness();
    } catch (error) {
      result = {
        available: false,
        reason: 'probe-failed',
        message: clip(error && error.message, 200) || 'omp probe failed',
      };
    }
    reply({ jsonrpc: '2.0', id: request.id, result });
    return;
  }
  reply({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Method not found' } });
});
