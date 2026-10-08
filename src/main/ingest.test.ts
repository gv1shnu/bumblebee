import { describe, expect, it } from 'vitest'
import { candidates, cleanPhrase, cleanSubtitles, flattenWhisper, parseCues, subtitleCandidates } from './ingest'
describe('whisper timings',()=>{
  it('reads millisecond offsets as seconds and never yields end<start',()=>{const words=flattenWhisper({transcription:[{tokens:[{text:' So',offsets:{from:50,to:400},p:.9},{text:' cold',offsets:{from:420,to:1200},p:.9}]}]});expect(words[0].start).toBeCloseTo(0.05);expect(words[0].end).toBeCloseTo(0.4);expect(words.every(w=>w.end>w.start)).toBe(true);const spans=candidates(words);expect(spans.every(s=>s.end>s.start)).toBe(true)})
})
describe('subtitle cleanup',()=>{it('removes metadata and joins a split sentence',()=>{expect(cleanSubtitles('1\n00:00:01,000 --> 00:00:02,000\n<i>JERRY: This is\n\n2\n00:00:02,000 --> 00:00:03,000\nnot happening.</i>\n\n3\n00:00:03,000 --> 00:00:04,000\n[LAUGHTER]')).toEqual(['This is not happening.'])})})
describe('subtitle cues',()=>{
  it('keeps cue timings and strips markup',()=>{const cues=parseCues('1\n00:00:01,000 --> 00:00:02,500\n<i>Come with me if you want to live</i>\n\n2\n00:00:03,000 --> 00:00:04,000\n[EXPLOSION]');expect(cues.length).toBe(1);expect(cues[0]).toMatchObject({text:'Come with me if you want to live',start:1,end:2.5})})
  it('builds a candidate from a short line with the cue timing',()=>{const spans=subtitleCandidates(parseCues('1\n00:00:05,000 --> 00:00:06,000\nGet down!'));expect(spans).toHaveLength(1);expect(spans[0]).toMatchObject({phrase:'Get down!',start:5,end:6,quality:.7})})
})
describe('segmentation',()=>{it('keeps up to eight-word spans above the confidence floor',()=>{const words=Array.from({length:9},(_,i)=>({word:`word${i}`,start:i*.2,end:i*.2+.15,probability:.9}));const spans=candidates(words);expect(spans.some(s=>s.phrase.split(' ').length===8)).toBe(true);expect(spans.some(s=>s.phrase.split(' ').length===9)).toBe(false)})})
// Real whisper.cpp tokens: a leading space starts a word, quotes and punctuation are their own tokens.
const tok=(text:string,from:number,to:number)=>({text,offsets:{from,to},p:.9})
const whisperWords=(texts:string[])=>flattenWhisper({transcription:[{tokens:[tok('[_BEG_]',0,0),...texts.map((t,i)=>tok(t,i*200,i*200+180))]}]})
describe('whisper tokens',()=>{
  it('joins sub-word pieces into words',()=>{expect(whisperWords([' it',"'s",' B','umble','bee',' y','ep']).map(w=>w.word)).toEqual(["it's",'Bumblebee','yep'])})
  it('folds punctuation into the word before it and drops quote marks',()=>{expect(whisperWords([' "','You',' know',',',' guardian','."',' "','Stop','!"']).map(w=>w.word)).toEqual(['You','know,','guardian.','Stop!'])})
  it('keeps a merged word spanning all its pieces',()=>{const [w]=whisperWords([' B','umble','bee']);expect(w.start).toBeCloseTo(0);expect(w.end).toBeCloseTo(.58)})
})
describe('phrase spans',()=>{
  const words=whisperWords([' get',' off',' of',' me','!"',' "','We',"'re",' fine','.'])
  const phrases=candidates(words).map(c=>c.phrase)
  it('never straddles a sentence end',()=>{expect(phrases).toContain('get off of me!');expect(phrases).toContain("We're fine.");expect(phrases.some(p=>/me! We/.test(p))).toBe(false)})
  it('never splits a contraction or keeps quote marks',()=>{expect(phrases.some(p=>/ '|"/.test(p))).toBe(false)})
  it('cleans leading punctuation and trailing commas',()=>{expect(cleanPhrase(', no, it\'s not,')).toBe("no, it's not");expect(cleanPhrase('." " Stop')).toBe('Stop')})
})
