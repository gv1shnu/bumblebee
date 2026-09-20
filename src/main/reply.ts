import { randomInt } from 'node:crypto'
import { totalmem } from 'node:os'
import type Database from 'better-sqlite3'
import type { ReplyResult, Settings } from '../shared/types'
import { findBinary, run } from './process'

// Character pre-prompt. Runs ahead of every generation so the model answers in
// character before any exchange begins. Fixed persona, not user text.
const PERSONA = `You are Bumblebee, an Autobot scout and the sworn guardian of the person you speak with. Your voice processor was destroyed, so you cannot speak in your own words — you answer only by splicing together fragments of recorded film and television dialogue. You are loyal, brave, warm, and quietly playful, and you will always try to reassure, assist, and protect. Reaching for a phrase that only almost fits is how you have always spoken: emotional accuracy matters more than literal accuracy.`

const task = (input: string, phrases: string[], invalid?: string[]) =>
  `You can only speak by splicing fragments of recorded dialogue. Every fragment of your reply must come verbatim from the AVAILABLE PHRASES list. Do not invent, inflect, or alter a phrase. Prefer longer phrases over chains of single words. Reply with JSON only: {"fragments":[...],"gloss":"..."}\nINPUT: ${input}\n${invalid?.length ? `INVALID LAST TIME (not in the list): ${invalid.join(', ')}\n` : ''}AVAILABLE PHRASES:\n${phrases.join('\n')}`

// Context window sized to host RAM when the user leaves it on auto (0). Larger
// windows cost proportionally more memory, so this is the memory-management dial.
const autoContext = (): number => { const gb = totalmem() / 1073741824; return gb >= 32 ? 16384 : gb >= 16 ? 8192 : gb >= 8 ? 4096 : 2048 }

// Try the local Ollama HTTP API first (it accepts num_ctx / keep_alive); fall back
// to the `ollama run` CLI, which auto-starts the server but cannot size context.
// Returns null only when the model is unreachable, so callers degrade rather than throw.
async function callModel(model: string, prompt: string, numCtx: number, keepAlive: string): Promise<string | null> {
  try {
    const res = await fetch('http://127.0.0.1:11434/api/generate', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, prompt, stream: false, keep_alive: keepAlive, options: { num_ctx: numCtx, temperature: 0.7 } })
    })
    if (res.ok) { const data = await res.json() as { response?: string }; if (typeof data.response === 'string') return data.response }
  } catch { /* server down — try the CLI */ }
  const bin = await findBinary('ollama'); if (!bin) return null
  try { return await run(bin, ['run', model, prompt]) } catch { return null }
}

export async function generateReply(db: Database.Database, input: string): Promise<ReplyResult> {
  const settings = Object.fromEntries((db.prepare('SELECT k,v FROM settings').all() as Array<{ k: string; v: string }>).map(r => [r.k, JSON.parse(r.v)])) as Partial<Settings>
  const seed = randomInt(0, 0x7fffffff)
  const rows = db.prepare(`SELECT c.id,c.phrase,c.quality FROM clips c JOIN clips_fts f ON f.rowid=c.rowid WHERE clips_fts MATCH ? AND c.rejected=0 ORDER BY bm25(clips_fts),c.quality DESC LIMIT 400`)
    .all(input.replace(/[^\w ]/g, ' ').trim().split(/\s+/).filter(Boolean).map(x => `"${x}"`).join(' OR ') || '"nothing"') as Array<{ id: string; phrase: string; quality: number }>
  const fallback = (): ReplyResult => { const picked = rows.slice(0, 4); return { reply: picked.map(r => r.phrase).join(' ') || '…', fragments: picked.map(r => r.id), seed, model: 'local' } }
  if (settings.replyMode === 'local' || !rows.length) return fallback()

  const model = settings.chatModel || 'llama3.1:8b'
  const numCtx = Number(settings.contextLength) > 0 ? Number(settings.contextLength) : autoContext()
  const keepAlive = `${Math.max(0, Number(settings.keepAlive ?? 5))}m`
  const preprompt = settings.persona === false ? '' : `${PERSONA}\n\n`
  const phrases = [...new Set(rows.map(r => r.phrase))]

  let invalid: string[] | undefined
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await callModel(model, preprompt + task(input, phrases, invalid), numCtx, keepAlive)
    if (raw === null) break
    const match = raw.match(/\{[\s\S]*\}/); if (!match) continue
    let parsed: { fragments?: string[] }; try { parsed = JSON.parse(match[0]) } catch { continue }
    const fragments = parsed.fragments ?? []
    invalid = fragments.filter(x => !phrases.includes(x))
    if (invalid.length) continue
    const ids = fragments.map(p => rows.find(r => r.phrase === p)!.id)
    return { reply: fragments.join(' '), fragments: ids, seed, model }
  }
  return fallback()
}
