import { createHash, randomBytes } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, parse } from 'node:path'
import type Database from 'better-sqlite3'
import type { IngestProgress } from '../shared/types'
import { phraseKey } from '../shared/normalize'
import { findBinary, run } from './process'

const VIDEO=new Set(['.mkv','.mp4','.mov','.m4v','.avi','.webm'])
const AUDIO=new Set(['.mp3','.m4a','.aac','.flac','.wav','.ogg','.opus','.aiff','.aif','.wma'])
const MEDIA=new Set([...VIDEO,...AUDIO])
type Word={word:string;start:number;end:number;probability:number}
type Candidate={phrase:string;start:number;end:number;quality:number}
// 8 random bytes (64 bits). The old 3 bytes (~16M) collided within a single file's
// hundreds of clips — UNIQUE constraint failed on clips.id.
const id=(prefix:string)=>`${prefix}_${randomBytes(8).toString('hex')}`
export async function hashFile(path:string):Promise<string>{const h=createHash('sha256');for await(const chunk of createReadStream(path))h.update(chunk as Buffer);return h.digest('hex')}
export async function scanFolders(folders:string[]):Promise<string[]>{const out:string[]=[];async function walk(p:string){const info=await stat(p);if(info.isFile()){if(MEDIA.has(extname(p).toLowerCase()))out.push(p);return}for(const e of await readdir(p,{withFileTypes:true})){const f=join(p,e.name);if(e.isDirectory())await walk(f);else if(MEDIA.has(extname(e.name).toLowerCase()))out.push(f)}}for(const f of folders)await walk(f);return out.sort()}
export function cleanSubtitles(raw:string):string[]{
  const blocks=raw.replace(/\r/g,'').split(/\n\n+/);const lines=blocks.map(b=>b.split('\n').filter(x=>!/^\d+$/.test(x)&&!x.includes('-->')).join(' '))
    .map(x=>x.replace(/<[^>]+>/g,'').replace(/\[[^\]]*]|\([^)]*(music|laugh|door|noise)[^)]*\)/gi,'').replace(/^\s*[A-Z][A-Z ]{1,24}:\s*/,'').replace(/\s+/g,' ').trim()).filter(Boolean)
  const merged:string[]=[];for(const line of lines){if(merged.length&&!/[.!?]$/.test(merged.at(-1)!)&&/^[a-z]/.test(line))merged[merged.length-1]+=` ${line}`;else merged.push(line)}return merged
}
// whisper.cpp offsets are milliseconds (always /1000); API-style words carry seconds in
// start/end. The old per-value ">100 ? /1000 : /1" heuristic turned an early word at e.g.
// 50 ms into 50 s, so a span's start overshot its end and the cut aborted.
export function flattenWhisper(json:any):Word[]{
  const segments=json.transcription??json.segments??[]
  return segments.flatMap((s:any)=>(s.tokens??s.words??[]).map((w:any)=>{
    const off=w.offsets,word=String(w.text??w.word??'').trim()
    const start=off&&off.from!=null?Number(off.from)/1000:Number(w.start??0)
    const end=off&&off.to!=null?Number(off.to)/1000:Number(w.end??0)
    return {word,start,end,probability:Number(w.p??w.probability??.8)}
  })).filter((w:Word)=>w.word&&!/^\[/.test(w.word)&&w.end>w.start)
}
export function candidates(words:Word[]):Candidate[]{const best=new Map<string,Candidate[]>();for(let i=0;i<words.length;i++)for(let n=1;n<=8&&i+n<=words.length;n++){const span=words.slice(i,i+n);const start=span[0].start,end=span.at(-1)!.end,dur=end-start;if(dur<=0||dur>12||Math.min(...span.map(w=>w.probability))<.65||(n===1&&(dur<.09||dur>2))||span.some((w,j)=>j>0&&w.start-span[j-1].end>.6))continue;const phrase=span.map(w=>w.word).join(' ').replace(/\s+([,.!?])/g,'$1').trim(),key=phraseKey(phrase);if(!key)continue;const confidence=span.reduce((a,w)=>a+w.probability,0)/n;const quality=Math.max(0,Math.min(1,.72*confidence+.28*Math.min(1,dur/(n*.22))));const c={phrase,start,end,quality};const arr=best.get(key)??[];arr.push(c);arr.sort((a,b)=>b.quality-a.quality);best.set(key,arr.slice(0,3))}return [...best.values()].flat()}

type Cue={text:string;start:number;end:number}
const cueTime=(t:string):number=>{const m=t.match(/(\d+):(\d+):(\d+)[,.](\d+)/);return m?(+m[1]*3600+ +m[2]*60+ +m[3]+ +m[4]/1000):0}
// Parse an SRT/VTT keeping the cue timings (unlike cleanSubtitles, which drops them).
export function parseCues(raw:string):Cue[]{
  const cues:Cue[]=[]
  for(const block of raw.replace(/\r/g,'').split(/\n\n+/)){
    const lines=block.split('\n').filter(Boolean);const ti=lines.findIndex(l=>l.includes('-->'));if(ti<0)continue
    const m=lines[ti].match(/(\d+:\d+:\d+[,.]\d+)\s*-->\s*(\d+:\d+:\d+[,.]\d+)/);if(!m)continue
    const text=lines.slice(ti+1).join(' ').replace(/<[^>]+>/g,'').replace(/\{[^}]*\}/g,'').replace(/\[[^\]]*]|\([^)]*(?:music|laugh|door|noise|applause)[^)]*\)/gi,'').replace(/^\s*[A-Z][A-Z ]{1,24}:\s*/,'').replace(/\s+/g,' ').trim()
    const start=cueTime(m[1]),end=cueTime(m[2]);if(text&&end>start)cues.push({text,start,end})
  }
  return cues
}
// Build clip candidates straight from subtitle cues, no transcription. Short lines keep
// their own cue timing; longer lines split on sentences with proportional timing. The
// cutter's silence-trim and fades clean up the looser boundaries.
export function subtitleCandidates(cues:Cue[]):Candidate[]{
  const best=new Map<string,Candidate[]>()
  const add=(phrase:string,start:number,end:number)=>{const dur=end-start;if(dur<.12||dur>7)return;const p=phrase.replace(/\s+([,.!?])/g,'$1').trim();if(p.split(/\s+/).length>8)return;const key=phraseKey(p);if(!key)return;const c={phrase:p,start,end,quality:.7};const arr=best.get(key)??[];arr.push(c);arr.sort((a,b)=>b.quality-a.quality);best.set(key,arr.slice(0,3))}
  for(const cue of cues){
    const words=cue.text.split(/\s+/).filter(Boolean);if(!words.length)continue
    if(words.length<=8){add(cue.text,cue.start,cue.end);continue}
    const parts=cue.text.split(/(?<=[.!?])\s+/).map(s=>s.trim()).filter(Boolean);const totalChars=parts.reduce((a,p)=>a+p.length,0)||1;let t=cue.start
    for(const part of parts){const slice=(cue.end-cue.start)*(part.length/totalChars);const start=t;t+=slice;add(part,start,t)}
  }
  return [...best.values()].flat()
}
// Prefer an English subtitle already shipped with the file: a sidecar .srt, then an
// English-tagged embedded stream. Returns '' when none is found.
async function englishSubtitle(file:string,work:string,probe:any,ffmpeg:string):Promise<string>{
  const dir=dirname(file),stem=parse(file).name
  for(const name of [`${stem}.en.srt`,`${stem}.eng.srt`,`${stem}.english.srt`,`${stem}.srt`]){try{return await readFile(join(dir,name),'utf8')}catch{/* not present */}}
  const sub=(probe.streams||[]).find((s:any)=>s.codec_type==='subtitle'&&/^en/i.test(String(s.tags?.language??s.tags?.LANGUAGE??s.tags?.title??'')))
  if(sub){try{const out=join(work,'sub.eng.srt');await run(ffmpeg,['-i',file,'-map',`0:${sub.index}`,'-c:s','srt','-y',out]);return await readFile(out,'utf8')}catch{/* extraction failed */}}
  return ''
}

export class Ingestor{
  private cancelled=new Set<string>()
  constructor(private db:Database.Database,private userData:string,private progress:(p:IngestProgress)=>void){}
  cancel(job:string){this.cancelled.add(job)}
  async start(folders:string[]):Promise<string>{const job=id('job');void this.batch(job,folders);return job}
  private emit(job:string,stage:IngestProgress['stage'],file:string,index:number,total:number,pct:number,message:string){this.progress({jobId:job,stage,file,fileIndex:index,fileTotal:total,pct,message})}
  private async batch(job:string,folders:string[]){try{const files=await scanFolders(folders);if(!files.length){this.emit(job,'error','',0,0,0,'No media files found in that folder');return}let failed=0;for(let i=0;i<files.length;i++){if(this.cancelled.has(job))break;try{await this.one(job,files[i],i+1,files.length)}catch(e){failed++;console.warn('ingest failed for',files[i],e)}}const done=this.cancelled.has(job)?'Cancelled':failed?`Library ready — ${failed} of ${files.length} file${failed>1?'s':''} skipped`:'Library ready';this.emit(job,'done','',files.length,files.length,100,done)}catch(e){this.emit(job,'error','',0,0,0,e instanceof Error?e.message:String(e))}finally{this.cancelled.delete(job)}}
  private async one(job:string,file:string,index:number,total:number){
    const hash=await hashFile(file);if(this.db.prepare('SELECT 1 FROM sources WHERE hash=?').get(hash))return
    const ffmpeg=await findBinary('ffmpeg'),ffprobe=await findBinary('ffprobe');if(!ffmpeg||!ffprobe)throw new Error('ffmpeg and ffprobe are required')
    const stem=parse(file).name,sourceId=`s_${phraseKey(stem).replace(/ /g,'-').slice(0,42)||hash.slice(0,8)}`,work=join(this.userData,'cache',hash),clipDir=join(this.userData,'clips',sourceId);await mkdir(work,{recursive:true});await mkdir(clipDir,{recursive:true})
    this.emit(job,'scan',file,index,total,3,'Probing media');const probe=JSON.parse(await run(ffprobe,['-v','error','-show_streams','-of','json',file]));const audio=probe.streams.filter((s:any)=>s.codec_type==='audio').sort((a:any,b:any)=>(b.channels??0)-(a.channels??0))[0];if(!audio)throw new Error('No audio stream found');const channels=audio.channels??2;const filter=channels>=6?'pan=mono|c0=FC':channels<=1?'pan=mono|c0=c0':'pan=mono|c0=.5*c0+.5*c1'
    const master=join(work,'master.flac');this.emit(job,'audio',file,index,total,20,'Extracting dialogue');await run(ffmpeg,['-i',file,'-map',`0:${audio.index}`,'-af',filter,'-ar','48000','-y',master])
    let spans:Candidate[]
    const subtitle=await englishSubtitle(file,work,probe,ffmpeg)
    if(subtitle){this.emit(job,'subtitles',file,index,total,45,'Reading English subtitles');spans=subtitleCandidates(parseCues(subtitle))}
    else{const whisper=await findBinary('whisper-cli');if(!whisper)throw new Error('whisper-cli is required when no English subtitle is present');const wav=join(work,'whisper.wav');await run(ffmpeg,['-i',master,'-ar','16000','-ac','1','-y',wav]);const jsonPath=join(work,'whisper.json');try{await stat(jsonPath)}catch{this.emit(job,'align',file,index,total,35,'Transcribing and aligning');const settings=Object.fromEntries((this.db.prepare('SELECT k,v FROM settings').all() as Array<{k:string;v:string}>).map(r=>[r.k,JSON.parse(r.v)]));const model=settings.whisperModel||'base.en';const modelPath=join(this.userData,'models',`ggml-${model}.bin`);await run(whisper,['-m',modelPath,'-f',wav,'-ojf','-owts','-of',join(work,'whisper')]);await writeFile(jsonPath,await readFile(join(work,'whisper.json')))}spans=candidates(flattenWhisper(JSON.parse(await readFile(jsonPath,'utf8'))))}
    this.emit(job,'segment',file,index,total,55,'Finding clean phrases');const sourceGain=(Number.parseInt(hash.slice(0,2),16)/255*6)-3
    const insertSource=this.db.prepare('INSERT INTO sources(id,label,title,era,kind,path,hash,ingestedAt) VALUES(?,?,?,?,?,?,?,?)');const insertClip=this.db.prepare('INSERT INTO clips(id,phrase,phraseKey,dur,sourceId,quality,file) VALUES(?,?,?,?,?,?,?)')
    const rows: Array<[string,Candidate,string]>=[];for(let i=0;i<spans.length;i++){if(this.cancelled.has(job))return;const c=spans[i],clipId=id('c'),out=join(clipDir,`${clipId}.flac`);this.emit(job,'cut',file,index,total,60+Math.round(35*i/Math.max(1,spans.length)),`Cutting ${i+1} of ${spans.length}`);await run(ffmpeg,['-ss',String(Math.max(0,c.start-.04)),'-to',String(c.end+.04),'-i',master,'-af',`silenceremove=start_periods=1:start_duration=0:start_threshold=-48dB:stop_periods=-1:stop_duration=0.04:stop_threshold=-48dB,afade=t=in:d=0.01,afade=t=out:st=${Math.max(.01,c.end-c.start+.068)}:d=0.012,loudnorm=I=${-18+sourceGain}:TP=-2:LRA=7`,'-ar','48000','-ac','1','-y',out]);rows.push([clipId,c,out])}
    this.db.transaction(()=>{insertSource.run(sourceId,stem.slice(0,4).toUpperCase(),stem,0,'film',file,hash,new Date().toISOString());for(const [clipId,c,out] of rows)insertClip.run(clipId,c.phrase,phraseKey(c.phrase),c.end-c.start,sourceId,c.quality,out)})()
  }
}
