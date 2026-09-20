import type { Segment } from '../shared/types'

export const mulberry32=(seed:number)=>()=>{let t=seed+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296}
class BufferCache{private map=new Map<string,{buffer:AudioBuffer;size:number}>();private bytes=0;constructor(private max=120*1024*1024){}get(k:string){const v=this.map.get(k);if(v){this.map.delete(k);this.map.set(k,v)}return v?.buffer}set(k:string,b:AudioBuffer){const size=b.length*b.numberOfChannels*4;this.map.set(k,{buffer:b,size});this.bytes+=size;while(this.bytes>this.max){const [key,v]=this.map.entries().next().value!;this.map.delete(key);this.bytes-=v.size}}}
export class RadioEngine{
  readonly ctx=new AudioContext();readonly analyser=this.ctx.createAnalyser();private cache=new BufferCache();private active:AudioBufferSourceNode[]=[];private master=this.ctx.createGain();private idleSource?:AudioBufferSourceNode
  constructor(){const limiter=this.ctx.createDynamicsCompressor();limiter.threshold.value=-4;limiter.knee.value=12;limiter.ratio.value=8;this.master.connect(limiter).connect(this.analyser).connect(this.ctx.destination)}
  private async decode(key:string,bytes:Promise<ArrayBuffer>){let b=this.cache.get(key);if(!b){b=await this.ctx.decodeAudioData(await bytes);this.cache.set(key,b)}return b}
  async play(segments:Segment[],seed:number):Promise<number>{await this.stop();await this.ctx.resume();const rand=mulberry32(seed);const payload=await Promise.all(segments.map(s=>s.kind==='clip'?this.decode(s.clip.id,window.bridge.corpus.clipAudio(s.clip.id)).catch(()=>null):null));const fx=await Promise.all(['staticShort','staticLong','sweep','bed'].map(n=>this.decode(n,window.bridge.corpus.fxAudio(n as any))));let t=this.ctx.currentTime+.15;const endEstimate=t+segments.reduce((a,s)=>a+s.dur+.2,0);this.source(fx[3],t,.012,true,endEstimate-t)
    for(let i=0;i<segments.length;i++){const s=segments[i];s.audioStart=t;if(s.kind==='clip'){const buf=payload[i];if(buf){const src=this.ctx.createBufferSource();src.buffer=buf;const filter=this.ctx.createBiquadFilter();filter.type='bandpass';filter.frequency.value=1150;filter.Q.value=.6+rand()*.5;const gain=this.ctx.createGain();src.connect(filter).connect(gain).connect(this.master);if(rand()<.05){const d=t+rand()*Math.max(.01,s.dur-.08),len=.04+rand()*.04;gain.gain.setValueAtTime(1,d);gain.gain.linearRampToValueAtTime(.05,d+.006);gain.gain.setValueAtTime(.05,d+len-.006);gain.gain.linearRampToValueAtTime(1,d+len)}src.start(t);this.active.push(src)}t+=s.dur}else{this.source(fx[0],t,.2,false,.25);t+=.25}s.audioClipEnd=t
      const next=segments[i+1];if(next){const switched=s.kind==='clip'&&next.kind==='clip'&&s.clip.sourceId!==next.clip.sourceId;const punct=/[,.!?;:]$/.test(s.text);if(!switched&&s.kind==='clip'&&next.kind==='clip'){t-=.04}else{let gap=s.kind==='unmatched'?.25:punct?.18:.09;gap+=(rand()-.5)*.012;this.source(fx[punct?1:0],t,.17,false,gap);if(punct)this.source(fx[2],t,.08,false,gap);t+=gap}}s.audioEnd=t}
    return t
  }
  private source(buffer:AudioBuffer,start:number,gainValue:number,loop:boolean,duration:number){const s=this.ctx.createBufferSource(),g=this.ctx.createGain();s.buffer=buffer;s.loop=loop;g.gain.value=gainValue;s.connect(g).connect(this.master);s.start(start);s.stop(start+duration);this.active.push(s)}
  async startIdle(){if(this.idleSource)return;await this.ctx.resume();const buffer=await this.decode('bed',window.bridge.corpus.fxAudio('bed'));const source=this.ctx.createBufferSource(),gain=this.ctx.createGain();source.buffer=buffer;source.loop=true;gain.gain.value=.006;source.connect(gain).connect(this.master);source.start();source.onended=()=>{if(this.idleSource===source)this.idleSource=undefined};this.idleSource=source;this.active.push(source)}
  async stop(){const now=this.ctx.currentTime;this.master.gain.cancelScheduledValues(now);this.master.gain.setValueAtTime(this.master.gain.value,now);this.master.gain.linearRampToValueAtTime(0,now+.03);for(const s of this.active)try{s.stop(now+.03)}catch{}this.active=[];this.idleSource=undefined;this.master.gain.setValueAtTime(1,now+.031)}

  // Build the deterministic schedule for a reply — the same timing, band-pass jitter,
  // dropouts and inter-clip static that play() lays down live, but as plain data so it can
  // be re-scheduled on an OfflineAudioContext for export. Kept separate from play() so the
  // live path (and its hard-won lifecycle) stays untouched; both share the same seed, so an
  // exported file sounds like what was heard.
  private plan(segments:Segment[],seed:number):{items:PlanItem[];total:number;marks:Mark[]}{
    const rand=mulberry32(seed);const items:PlanItem[]=[];const marks:Mark[]=[]
    let t=.05;const endEstimate=t+segments.reduce((a,s)=>a+s.dur+.2,0)
    items.push({type:'bed',start:t,dur:endEstimate-t,gain:.012})
    for(let i=0;i<segments.length;i++){const s=segments[i];const start=t
      if(s.kind==='clip'){const q=.6+rand()*.5;let drop:{d:number;len:number}|undefined;if(rand()<.05){const d=t+rand()*Math.max(.01,s.dur-.08),len=.04+rand()*.04;drop={d,len}}items.push({type:'clip',src:s.clip.id,start:t,dur:s.dur,q,drop});t+=s.dur}
      else{items.push({type:'fx',name:'staticShort',start:t,gain:.2,dur:.25});t+=.25}
      const clipEnd=t;if(s.kind==='clip')marks.push({start,end:clipEnd,text:s.text})
      const next=segments[i+1]
      if(next){const switched=s.kind==='clip'&&next.kind==='clip'&&s.clip.sourceId!==next.clip.sourceId;const punct=/[,.!?;:]$/.test(s.text)
        if(!switched&&s.kind==='clip'&&next.kind==='clip'){t-=.04}
        else{let gap=s.kind==='unmatched'?.25:punct?.18:.09;gap+=(rand()-.5)*.012;items.push({type:'fx',name:punct?'staticLong':'staticShort',start:t,gain:.17,dur:gap});if(punct)items.push({type:'fx',name:'sweep',start:t,gain:.08,dur:gap});t+=gap}}
    }
    return {items,total:t,marks}
  }

  // Render a reply to a mono WAV plus matching SRT, faster than real time. Reuses the live
  // decode cache (AudioBuffers are context-independent) and rebuilds the limiter chain.
  async renderOffline(segments:Segment[],seed:number):Promise<{wav:ArrayBuffer;srt:string}>{
    const {items,total,marks}=this.plan(segments,seed)
    const sr=this.ctx.sampleRate;const octx=new OfflineAudioContext(1,Math.max(1,Math.ceil((total+.15)*sr)),sr)
    const master=octx.createGain();const limiter=octx.createDynamicsCompressor();limiter.threshold.value=-4;limiter.knee.value=12;limiter.ratio.value=8;master.connect(limiter).connect(octx.destination)
    const clipIds=[...new Set(items.flatMap(i=>i.type==='clip'?[i.src]:[]))]
    const clipBufs=new Map<string,AudioBuffer|null>();await Promise.all(clipIds.map(async id=>{clipBufs.set(id,await this.decode(id,window.bridge.corpus.clipAudio(id)).catch(()=>null))}))
    const fx=Object.fromEntries(await Promise.all((['staticShort','staticLong','sweep','bed'] as const).map(async n=>[n,await this.decode(n,window.bridge.corpus.fxAudio(n))] as const)))
    for(const it of items){
      if(it.type==='bed'||it.type==='fx'){const buf=it.type==='bed'?fx.bed:fx[it.name];if(!buf)continue;const s=octx.createBufferSource(),g=octx.createGain();s.buffer=buf;s.loop=it.type==='bed';g.gain.value=it.gain;s.connect(g).connect(master);s.start(it.start);s.stop(it.start+it.dur)}
      else{const buf=clipBufs.get(it.src);if(!buf)continue;const s=octx.createBufferSource();s.buffer=buf;const f=octx.createBiquadFilter();f.type='bandpass';f.frequency.value=1150;f.Q.value=it.q;const g=octx.createGain();s.connect(f).connect(g).connect(master);if(it.drop){const{d,len}=it.drop;g.gain.setValueAtTime(1,d);g.gain.linearRampToValueAtTime(.05,d+.006);g.gain.setValueAtTime(.05,d+len-.006);g.gain.linearRampToValueAtTime(1,d+len)}s.start(it.start)}
    }
    const rendered=await octx.startRendering()
    return {wav:encodeWav(rendered),srt:buildSrt(marks)}
  }
}

type PlanItem =
  | {type:'bed';start:number;dur:number;gain:number}
  | {type:'fx';name:'staticShort'|'staticLong'|'sweep';start:number;dur:number;gain:number}
  | {type:'clip';src:string;start:number;dur:number;q:number;drop?:{d:number;len:number}}
type Mark={start:number;end:number;text:string}

// Mono 16-bit PCM WAV — small, universally playable, and lossless for a spliced-speech mix.
function encodeWav(buffer:AudioBuffer):ArrayBuffer{
  const ch=buffer.getChannelData(0),sr=buffer.sampleRate,n=ch.length,ab=new ArrayBuffer(44+n*2),dv=new DataView(ab)
  const str=(o:number,s:string)=>{for(let i=0;i<s.length;i++)dv.setUint8(o+i,s.charCodeAt(i))}
  str(0,'RIFF');dv.setUint32(4,36+n*2,true);str(8,'WAVE');str(12,'fmt ');dv.setUint32(16,16,true);dv.setUint16(20,1,true);dv.setUint16(22,1,true);dv.setUint32(24,sr,true);dv.setUint32(28,sr*2,true);dv.setUint16(32,2,true);dv.setUint16(34,16,true);str(36,'data');dv.setUint32(40,n*2,true)
  let o=44;for(let i=0;i<n;i++){const v=Math.max(-1,Math.min(1,ch[i]));dv.setInt16(o,v<0?v*0x8000:v*0x7fff,true);o+=2}
  return ab
}
const srtTime=(sec:number):string=>{const ms=Math.max(0,Math.round(sec*1000)),p=(n:number,l=2)=>String(n).padStart(l,'0');return `${p(Math.floor(ms/3600000))}:${p(Math.floor(ms/60000)%60)}:${p(Math.floor(ms/1000)%60)},${p(ms%1000,3)}`}
function buildSrt(marks:Mark[]):string{return marks.map((m,i)=>`${i+1}\n${srtTime(m.start)} --> ${srtTime(m.end)}\n${m.text}`).join('\n\n')+'\n'}
