import { describe, expect, it } from 'vitest'
import { candidates, cleanSubtitles } from './ingest'
describe('subtitle cleanup',()=>{it('removes metadata and joins a split sentence',()=>{expect(cleanSubtitles('1\n00:00:01,000 --> 00:00:02,000\n<i>JERRY: This is\n\n2\n00:00:02,000 --> 00:00:03,000\nnot happening.</i>\n\n3\n00:00:03,000 --> 00:00:04,000\n[LAUGHTER]')).toEqual(['This is not happening.'])})})
describe('segmentation',()=>{it('keeps up to eight-word spans above the confidence floor',()=>{const words=Array.from({length:9},(_,i)=>({word:`word${i}`,start:i*.2,end:i*.2+.15,probability:.9}));const spans=candidates(words);expect(spans.some(s=>s.phrase.split(' ').length===8)).toBe(true);expect(spans.some(s=>s.phrase.split(' ').length===9)).toBe(false)})})
