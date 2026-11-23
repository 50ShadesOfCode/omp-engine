// Required by ghost.json -> node.entry. Besides staying idle for the host
// protocol, the worker answers `harness/inspect`: a short ACP probe that reads
// the local omp version, modes and model list for `PUT /harnesses`.
const { spawn } = require('node:child_process');
const os = require('node:os');
const readline = require('node:readline');
const { findOmp } = require('../lib/find-omp.cjs');

const PROBE_TIMEOUT_MS = 12000;
const MAX_MODELS = 200;

function reply(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

function clip(text, limit) {
  const value = String(text ?? '');
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}

const MODE_IDS = new Map([
  ['default', 'default'],
  ['plan', 'plan'],
  ['accept-edits', 'acceptEdits'],
  ['acceptEdits', 'acceptEdits'],
  ['auto', 'auto'],
]);

// Starts `omp acp` without a session, asks for the initial config options and
// stops it. No prompt is sent, so this never calls a model.
function inspectHarness() {
  return new Promise((resolve, reject) => {
    const bin = findOmp();
    if (!bin) {
      resolve({
        available: false,
        reason: 'not-installed',
        message: 'Install the omp CLI (macOS/Linux) or set OMP_HARNESS_BIN.',
      });
      return;
    }

    const profile = process.env.OMP_HARNESS_PROFILE;
    const args = profile
      ? ['--profile', profile, '--no-session', 'acp']
      : ['--no-session', 'acp'];
    const child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'ignore'] });

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
          const config = message.result.configOptions || [];
          const modelOption = config.find((entry) => entry.id === 'model');
          const modeOption = config.find((entry) => entry.id === 'mode');
          const models = (modelOption?.options || [])
            .slice(0, MAX_MODELS)
            .map((option) => ({
              id: clip(option.value, 256),
              name: clip(option.name || option.value, 200),
              ...(option.description ? { description: clip(option.description, 200) } : {}),
            }))
            .filter((model) => model.id !== '');
          const modes = [];
          for (const option of modeOption?.options || []) {
            const mapped = MODE_IDS.get(option.value);
            if (mapped && !modes.includes(mapped)) modes.push(mapped);
          }
          const defaultMode = MODE_IDS.get(modeOption?.currentValue);
          finish(null, {
            available: true,
            version: clip(version, 64) || undefined,
            ...(modes.length ? { modes, ...(defaultMode ? { defaultMode } : {}) } : {}),
            ...(models.length ? { models } : {}),
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

readline.createInterface({ input: process.stdin }).on('line', async function (line) {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    reply({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
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
