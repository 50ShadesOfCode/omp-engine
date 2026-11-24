// Cindy starts this page when the plugin needs its logic: to publish the
// engine's current capabilities, or when the model selector asks for a refresh.
// The node worker does the probing; this page only forwards its answer to
// PUT /harnesses (see FORGE_GUIDE §4.6.4).
const CHANNEL_NAME = 'omp-engine';
const HARNESS_ID = 'omp';
const channel = new BroadcastChannel(CHANNEL_NAME);

let inFlight = null;

async function publish() {
  const response = await cindy.node.request({
    method: 'harness/inspect',
    timeoutMs: 20000,
  });
  if (!response || !response.ok || !response.result) return;

  const state = response.result;
  const put = await fetch('/harnesses', {
    method: 'PUT',
    body: JSON.stringify({ harnesses: [{ id: HARNESS_ID, ...state }] }),
  });
  if (!put.ok) {
    console.warn(`omp-engine: publishing the engine state failed (${put.status})`);
    return;
  }
  channel.postMessage({ type: 'harness-status', state });
}

function requestPublish() {
  if (inFlight) return inFlight;
  inFlight = publish()
    .catch((error) => {
      console.warn('omp-engine: engine probe failed:', (error && error.message) || error);
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

cindy.onHostMessage((message) => {
  if (message && message.type === 'harnesses-refresh-requested') requestPublish();
});

channel.onmessage = (event) => {
  if (event.data && event.data.type === 'harness-refresh') requestPublish();
};

requestPublish();
