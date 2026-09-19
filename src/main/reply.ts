import { randomInt } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { ReplyResult } from '../shared/types'
import { findBinary, run } from './process'

const prompt=(input:string,phrases:string[],invalid?:string[])=>`You are a machine whose voice processor is destroyed. You can only speak by splicing fragments of recorded television and film dialogue. Every fragment must come verbatim from AVAILABLE PHRASES. Do not invent, inflect, or alter a phrase. Emotional accuracy matters more than literal accuracy. Prefer longer phrases. Reply with JSON only: {"fragments":[...],"gloss":"..."}\nINPUT: ${input}\n${invalid?.length?`INVALID LAST TIME: ${invalid.join(', ')}\n`:''}AVAILABLE PHRASES:\n${phrases.join('\n')}`
export async function generateReply(db:Database.Database,input:string):Promise<ReplyResult>{
  const settings=Object.fromEntries((db.prepare('SELECT k,v FROM settings').all() as Array<{k:string;v:string}>).map(r=>[r.k,JSON.parse(r.v)]));const seed=randomInt(0,0x7fffffff)
  const rows=db.prepare(`SELECT c.id,c.phrase,c.quality FROM clips c JOIN clips_fts f ON f.rowid=c.rowid WHERE clips_fts MATCH ? AND c.rejected=0 ORDER BY bm25(clips_fts),c.quality DESC LIMIT 400`).all(input.replace(/[^\w ]/g,' ').trim().split(/\s+/).filter(Boolean).map(x=>`"${x}"`).join(' OR ')||'"nothing"') as Array<{id:string;phrase:string;quality:number}>
  const fallback=():ReplyResult=>{const picked=rows.slice(0,4);return{reply:picked.map(r=>r.phrase).join(' ')||'…',fragments:picked.map(r=>r.id),seed,model:'local'}}
  if(settings.replyMode==='local'||!rows.length)return fallback();const ollama=await findBinary('ollama');if(!ollama)return fallback();const phrases=[...new Set(rows.map(r=>r.phrase))]
  for(let attempt=0;attempt<2;attempt++)try{const raw=await run(ollama,['run',settings.chatModel||'llama3.2:3b',prompt(input,phrases)]);const match=raw.match(/\{[\s\S]*\}/);if(!match)continue;const parsed=JSON.parse(match[0]) as {fragments?:string[];gloss?:string};const fragments=parsed.fragments??[];const invalid=fragments.filter(x=>!phrases.includes(x));if(invalid.length)continue;const ids=fragments.map(p=>rows.find(r=>r.phrase===p)!.id);return{reply:fragments.join(' '),fragments:ids,seed,model:settings.chatModel||'ollama'}}catch{}
  return fallback()
}
