import { describe, expect, it } from 'vitest'
import { candidates, cleanSubtitles, parseCues, subtitleCandidates } from './ingest'
describe('subtitle cleanup',()=>{it('removes metadata and joins a split sentence',()=>{expect(cleanSubtitles('1\n00:00:01,000 --> 00:00:02,000\n<i>JERRY: This is\n\n2\n00:00:02,000 --> 00:00:03,000\nnot happening.</i>\n\n3\n00:00:03,000 --> 00:00:04,000\n[LAUGHTER]')).toEqual(['This is not happening.'])})})
describe('subtitle cues',()=>{
  it('keeps cue timings and strips markup',()=>{const cues=parseCues('1\n00:00:01,000 --> 00:00:02,500\n<i>Come with me if you want to live</i>\n\n2\n00:00:03,000 --> 00:00:04,000\n[EXPLOSION]');expect(cues.length).toBe(1);expect(cues[0]).toMatchObject({text:'Come with me if you want to live',start:1,end:2.5})})
  it('builds a candidate from a short line with the cue timing',()=>{const spans=subtitleCandidates(parseCues('1\n00:00:05,000 --> 00:00:06,000\nGet down!'));expect(spans).toHaveLength(1);expect(spans[0]).toMatchObject({phrase:'Get down!',start:5,end:6,quality:.7})})
})
describe('segmentation',()=>{it('keeps up to eight-word spans above the confidence floor',()=>{const words=Array.from({length:9},(_,i)=>({word:`word${i}`,start:i*.2,end:i*.2+.15,probability:.9}));const spans=candidates(words);expect(spans.some(s=>s.phrase.split(' ').length===8)).toBe(true);expect(spans.some(s=>s.phrase.split(' ').length===9)).toBe(false)})})
