// Required by ghost.json -> node.entry. The plugin provides an ACP harness
// rather than node-backed tools, so the host starts this worker only if a
// plugin page asks it to; every request is answered with "method not found".
const readline = require('node:readline');

function reply(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

readline.createInterface({ input: process.stdin }).on('line', function (line) {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    reply({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    return;
  }
  reply({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Method not found' } });
});
