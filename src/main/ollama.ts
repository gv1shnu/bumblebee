// Local Ollama helpers: embeddings for semantic search, and warm-up so models are resident
// before the first message instead of cold-loading per reply.
const HOST = 'http://127.0.0.1:11434'
const EMBED_MODEL = 'nomic-embed-text'

// Batch-embed with /api/embed; returns one vector per input (null where it failed).
export async function embedBatch(inputs: string[]): Promise<Array<number[] | null>> {
  if (!inputs.length) return []
  try {
    const res = await fetch(`${HOST}/api/embed`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: EMBED_MODEL, input: inputs, keep_alive: '30m' }) })
    if (res.ok) { const data = await res.json() as { embeddings?: number[][] }; if (Array.isArray(data.embeddings) && data.embeddings.length === inputs.length) return data.embeddings }
  } catch { /* ollama down or model missing — degrade to keyword search */ }
  return inputs.map(() => null)
}

export async function embedOne(input: string): Promise<number[] | null> {
  return (await embedBatch([input]))[0] ?? null
}

// Load a chat model into memory (empty generate just loads it) and hold it there.
export async function warmChat(model: string, keepAliveMin: number): Promise<void> {
  try { await fetch(`${HOST}/api/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, keep_alive: `${Math.max(1, keepAliveMin)}m` }) }) } catch { /* best effort */ }
}

export async function warmEmbed(): Promise<void> {
  await embedBatch(['warm'])
}
