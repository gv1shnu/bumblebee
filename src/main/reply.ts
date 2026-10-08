import { randomInt } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { ReplyResult, Settings } from '../shared/types'
import { embedOne, ensureServer } from './ollama'
import { nearestPhraseKeys } from './db'
import { autoContext, defaultChatModel, machine } from './models'

// Character pre-prompt. Runs ahead of every generation so the model answers in
// character before any exchange begins. Fixed persona, not user text.
const PERSONA = `You are Bumblebee, an Autobot scout and the sworn guardian of the person you speak with. Your voice processor was destroyed, so you cannot speak in your own words — you answer only by splicing together fragments of recorded film and television dialogue. You are loyal, brave, warm, and quietly playful, and you will always try to reassure, assist, and protect. Reaching for a phrase that only almost fits is how you have always spoken: emotional accuracy matters more than literal accuracy.`

const task = (input: string, phrases: string[], maxFragments: number, invalid?: string[]) =>
  `You can only speak by splicing fragments of recorded dialogue. Every fragment of your reply must come verbatim from the AVAILABLE PHRASES list. Do not invent, inflect, or alter a phrase. Prefer longer phrases over chains of single words. Answer in one to ${maxFragments} fragments. Reply with JSON only: {"fragments":[...]}\nINPUT: ${input}\n${invalid?.length ? `INVALID LAST TIME (not in the list): ${invalid.join(', ')}\n` : ''}AVAILABLE PHRASES:\n${phrases.join('\n')}`

// Context window: auto (0) sizes it to host RAM; an explicit contextLength wins. Shared with
// warm-up so the model is loaded at the same size and the first reply doesn't pay for a reload.
export const replyContext = (contextLength?: number): number => Number(contextLength) > 0 ? Number(contextLength) : autoContext(machine().ramGB)

// How many distinct phrases to offer the model. Enough to give real choice, few enough
// that the prompt stays small and the reply comes back quickly.
const PHRASE_CAP = 140

// Call the local Ollama HTTP API (it accepts num_ctx / keep_alive). If the server isn't up,
// start the bundled one and try once more. Returns null only when the model is unreachable,
// so callers degrade rather than throw.
async function callModel(model: string, prompt: string, format: object, numPredict: number, numCtx: number, keepAlive: string): Promise<string | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch('http://127.0.0.1:11434/api/generate', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        // The schema constrains decoding: fragments can only be phrases from the list, and at most
        // maxFragments of them, so the model can't invent a phrase, ramble, or loop. Without it a small
        // model lists a dozen near-duplicates (or repeats one) and costs 20+ seconds a reply.
        body: JSON.stringify({ model, prompt, stream: false, format, keep_alive: keepAlive, options: { num_ctx: numCtx, num_predict: numPredict, temperature: 0.4 } })
      })
      if (res.ok) { const data = await res.json() as { response?: string }; if (typeof data.response === 'string') return data.response }
      return null
    } catch { if (attempt === 0 && !await ensureServer()) return null }
  }
  return null
}

export async function generateReply(db: Database.Database, input: string): Promise<ReplyResult> {
  const settings = Object.fromEntries((db.prepare('SELECT k,v FROM settings').all() as Array<{ k: string; v: string }>).map(r => [r.k, JSON.parse(r.v)])) as Partial<Settings>
  const seed = randomInt(0, 0x7fffffff)
  let rows = db.prepare(`SELECT c.id,c.phrase,c.quality FROM clips c JOIN clips_fts f ON f.rowid=c.rowid WHERE clips_fts MATCH ? AND c.rejected=0 ORDER BY bm25(clips_fts),c.quality DESC LIMIT 400`)
    .all(input.replace(/[^\w ]/g, ' ').trim().split(/\s+/).filter(Boolean).map(x => `"${x}"`).join(' OR ') || '"nothing"') as Array<{ id: string; phrase: string; quality: number }>
  // Semantic hits: embed the input and pull the nearest phrases by meaning, so relevant
  // fragments surface even when no keyword matches (a paraphrase, or a different-language
  // corpus). Merged with the keyword hits, de-duped, capped.
  const vec = await embedOne(input)
  if (vec) {
    const nearKeys = nearestPhraseKeys(db, vec, 80)
    if (nearKeys.length) {
      const vrows = db.prepare(`SELECT id,phrase,quality FROM clips WHERE rejected=0 AND phraseKey IN (${nearKeys.map(() => '?').join(',')}) ORDER BY quality DESC`).all(...nearKeys) as Array<{ id: string; phrase: string; quality: number }>
      const seen = new Set(rows.map(r => r.id))
      for (const v of vrows) if (!seen.has(v.id)) { rows.push(v); seen.add(v.id) }
    }
  }
  // Still nothing (no keywords, no embeddings yet) — reach for phrases anyway so the reply
  // is never silent.
  if (!rows.length) rows = db.prepare(`SELECT id,phrase,quality FROM clips WHERE rejected=0 ORDER BY RANDOM() LIMIT 200`).all() as Array<{ id: string; phrase: string; quality: number }>
  // Collapse to distinct phrases, keeping relevance order (FTS hits first, then semantic),
  // and cap the prompt vocabulary. Duplicate phrase strings added nothing but tokens, and a
  // tighter list keeps num_ctx small so generation stays fast without losing coverage.
  const seenPhrase = new Set<string>()
  rows = rows.filter(r => !seenPhrase.has(r.phrase) && seenPhrase.add(r.phrase)).slice(0, PHRASE_CAP)
  const fallback = (): ReplyResult => { const picked = rows.slice(0, 4); return { reply: picked.map(r => r.phrase).join(' ') || '…', fragments: picked.map(r => r.id), seed, model: 'local' } }
  if (settings.replyMode === 'local' || !rows.length) return fallback()

  const model = settings.chatModel || defaultChatModel()
  const numCtx = replyContext(settings.contextLength)
  const keepAlive = `${Math.max(0, Number(settings.keepAlive ?? 5))}m`
  const preprompt = settings.persona === false ? '' : `${PERSONA}\n\n`
  const phrases = [...new Set(rows.map(r => r.phrase))]

  // Reply length cap (Settings → Max fragments); each fragment is one clip of up to eight words.
  const maxFragments = Math.min(12, Math.max(1, Math.round(Number(settings.maxFragments) || 6)))
  const format = { type: 'object', properties: { fragments: { type: 'array', items: { type: 'string', enum: phrases }, minItems: 1, maxItems: maxFragments } }, required: ['fragments'] }
  // A fragment costs ~10-15 tokens of JSON; this is a ceiling, the schema ends the reply first.
  const numPredict = 40 + 25 * maxFragments
  let invalid: string[] | undefined
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await callModel(model, preprompt + task(input, phrases, maxFragments, invalid), format, numPredict, numCtx, keepAlive)
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
