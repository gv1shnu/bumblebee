// Local Ollama helpers: the bundled server, model pulls, embeddings for semantic search, and
// warm-up so models are resident before the first message instead of cold-loading per reply.
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { findBinary } from './process'
import { EMBED_MODEL } from './models'

const HOST = 'http://127.0.0.1:11434'

// The packaged app ships Ollama in Contents/Resources/ollama (see scripts/fetch-ollama.mjs), so
// users never install it. Dev builds use vendor/ollama when fetched, else a system install.
export async function ollamaBinary(): Promise<string | null> {
  const bundled = [join(process.resourcesPath ?? '', 'ollama', 'ollama'), join(process.cwd(), 'vendor', 'ollama', 'ollama')]
  return bundled.find(p => existsSync(p)) ?? await findBinary('ollama')
}

const serverUp = async (): Promise<boolean> => { try { return (await fetch(`${HOST}/api/version`, { signal: AbortSignal.timeout(1500) })).ok } catch { return false } }

// Reuse a server that is already running (e.g. the user's own Ollama app); otherwise start ours
// and stop it when Bumblebee quits. Models live in the standard ~/.ollama so they are shared.
let server: ChildProcess | null = null
let starting: Promise<boolean> | null = null
export function ensureServer(): Promise<boolean> {
  starting ??= (async () => {
    if (await serverUp()) return true
    const bin = await ollamaBinary(); if (!bin) return false
    server = spawn(bin, ['serve'], { env: { ...process.env, OLLAMA_HOST: '127.0.0.1:11434' }, stdio: 'ignore' })
    server.on('exit', () => { server = null; starting = null })
    for (let i = 0; i < 75; i++) { if (await serverUp()) return true; await new Promise(r => setTimeout(r, 200)) }
    return false
  })()
  return starting
}
export function stopServer(): void { server?.kill(); server = null }

export async function installedModels(): Promise<string[]> {
  try { const res = await fetch(`${HOST}/api/tags`); if (res.ok) return ((await res.json()) as { models?: Array<{ name: string }> }).models?.map(m => m.name.replace(/:latest$/, '')) ?? [] } catch { /* server down */ }
  return []
}

// Stream /api/pull and report overall percent across all layers. Concurrent requests for the
// same model share one download.
const pulls = new Map<string, Promise<void>>()
export function pullModel(model: string, onProgress: (pct: number) => void): Promise<void> {
  const existing = pulls.get(model); if (existing) return existing
  const job = (async () => {
    if (!await ensureServer()) throw new Error('Ollama could not be started')
    const res = await fetch(`${HOST}/api/pull`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, stream: true }) })
    if (!res.ok || !res.body) throw new Error(`Pull failed: ${res.status}`)
    const layers = new Map<string, { total: number; completed: number }>(); let buffer = ''; let last = -1
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += Buffer.from(chunk).toString(); const lines = buffer.split('\n'); buffer = lines.pop() ?? ''
      for (const line of lines.filter(Boolean)) {
        const ev = JSON.parse(line) as { status?: string; digest?: string; total?: number; completed?: number; error?: string }
        if (ev.error) throw new Error(ev.error)
        if (ev.digest && ev.total) layers.set(ev.digest, { total: ev.total, completed: ev.completed ?? 0 })
        const total = [...layers.values()].reduce((a, l) => a + l.total, 0), done = [...layers.values()].reduce((a, l) => a + l.completed, 0)
        const pct = ev.status === 'success' ? 100 : total ? Math.min(99, Math.floor(done / total * 100)) : 0
        if (pct !== last) { last = pct; onProgress(pct) }
      }
    }
  })().finally(() => pulls.delete(model))
  pulls.set(model, job)
  return job
}

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

// Load a chat model into memory (empty generate just loads it) and hold it there. Load at
// the same num_ctx replies will use, so the first real reply doesn't trigger a reload.
export async function warmChat(model: string, keepAliveMin: number, numCtx: number): Promise<void> {
  try { await fetch(`${HOST}/api/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, keep_alive: `${Math.max(1, keepAliveMin)}m`, options: { num_ctx: numCtx } }) }) } catch { /* best effort */ }
}

export async function warmEmbed(): Promise<void> {
  await embedBatch(['warm'])
}
