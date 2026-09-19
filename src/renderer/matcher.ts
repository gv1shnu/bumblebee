import { phraseKey } from '../shared/normalize'
import type { Clip, Segment } from '../shared/types'

type State = { cost: number; segments: Segment[]; last?: Clip; used: Set<string> }
const stem = (word: string): string => word.replace(/(?:ing|ed|s)$/, '')

export async function matchText(text: string): Promise<Segment[]> {
  const matches = [...text.matchAll(/[\w']+|[^\w\s]+/g)]
  const words = matches.filter(m => /[\w']/.test(m[0])).map(m => ({ text: m[0], index: m.index }))
  const keys = new Set<string>()
  for (let end = 1; end <= words.length; end++) {
    for (let size = 1; size <= 8 && size <= end; size++) {
      const key = phraseKey(words.slice(end - size, end).map(w => w.text).join(' '))
      keys.add(key)
      if (size === 1) keys.add(stem(key))
    }
  }
  const found = await window.bridge.corpus.lookup([...keys])
  const dp: Array<State | undefined> = Array(words.length + 1)
  dp[0] = { cost: 0, segments: [], used: new Set<string>() }
  for (let end = 1; end <= words.length; end++) {
    for (let size = 1; size <= 8 && size <= end; size++) {
      const previous = dp[end - size]
      if (!previous) continue
      const raw = words.slice(end - size, end).map(w => w.text).join(' ')
      const key = phraseKey(raw)
      const clips: Clip[] = [...(found[key] ?? [])]
      if (size === 1) clips.push(...(found[stem(key)] ?? []))
      for (const clip of clips) {
        const before = text.slice(0, words[end - size].index).trimEnd().at(-1) ?? ''
        const boundary = /[,.;!?]/.test(before)
        const cost = previous.cost + 1
          + (previous.last && previous.last.sourceId !== clip.sourceId ? 0.6 : 0)
          + (boundary ? -0.5 : 0)
          + (previous.used.has(clip.id) ? 0.4 : 0)
          - Math.log(Math.max(0.01, clip.quality))
        const current = dp[end]
        if (!current || cost < current.cost) {
          const used = new Set<string>(previous.used)
          used.add(clip.id)
          dp[end] = { cost, segments: [...previous.segments, { kind: 'clip', text: raw, clip, dur: clip.dur }], last: clip, used }
        }
      }
      if (size === 1) {
        const cost = previous.cost + 2.4
        const current = dp[end]
        if (!current || cost < current.cost) {
          dp[end] = { cost, segments: [...previous.segments, { kind: 'unmatched', text: raw, dur: 0.32 }], last: previous.last, used: new Set<string>(previous.used) }
        }
      }
    }
  }
  return dp[words.length]?.segments ?? []
}
