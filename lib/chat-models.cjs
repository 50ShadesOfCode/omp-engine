// Which catalog entries may appear in Cindy's model selector.
//
// omp's `models --json --kind=chat` is the authority for "this can run a task",
// but its catalog also files embedding models under `kind: "chat"` (checked
// against omp 19.1.1: text-embedding-3-small, qwen3-embedding-8b,
// gemini-embedding-*). An embedding cannot answer a prompt, so the selector
// drops entries whose selector or name is an embedding model.
const EMBEDDING_RE = /(^|[\s\-_/.])(embedding|embeddings)([\s\-_/.]|$)/i;

function isChatModel(entry) {
  if (!entry || typeof entry !== 'object') return false;
  if (entry.kind !== 'chat' || typeof entry.selector !== 'string') return false;
  if (EMBEDDING_RE.test(entry.selector)) return false;
  if (typeof entry.name === 'string' && EMBEDDING_RE.test(entry.name)) return false;
  return true;
}

module.exports = { isChatModel, EMBEDDING_RE };
