const channel = new BroadcastChannel('omp-engine');
const statusEl = document.getElementById('status');
const button = document.getElementById('refresh');

function render(state) {
  if (!state) {
    statusEl.textContent = 'The engine has not reported its state yet.';
    return;
  }
  if (!state.available) {
    statusEl.textContent = `Engine unavailable (${state.reason || 'unknown'}): ${
      state.message || 'no details'
    }`;
    return;
  }
  const parts = [];
  if (state.version) parts.push(`omp ${state.version}`);
  parts.push(`${(state.models && state.models.length) || 0} models`);
  if (state.modes && state.modes.length) parts.push(`modes: ${state.modes.join(', ')}`);
  statusEl.textContent = `Engine available: ${parts.join(' · ')}`;
}

async function load() {
  try {
    const response = await fetch('/harnesses');
    if (!response.ok) {
      render(null);
      return;
    }
    const body = await response.json();
    render(body.harnesses && body.harnesses[0]);
  } catch {
    render(null);
  }
}

async function refresh() {
  button.disabled = true;
  try {
    await fetch('/wake');
    channel.postMessage({ type: 'harness-refresh' });
    setTimeout(load, 1200);
    setTimeout(load, 5000);
  } finally {
    setTimeout(() => {
      button.disabled = false;
    }, 6000);
  }
}

channel.onmessage = (event) => {
  if (event.data && event.data.type === 'harness-status') render(event.data.state);
};

button.addEventListener('click', refresh);
load();
refresh();
