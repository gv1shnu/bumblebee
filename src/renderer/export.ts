// Export helpers: turn a rendered reply into a WAV file and a matching SRT. Shared by the
// audio engine's offline render (see RadioEngine.renderOffline).

export type Mark = { start: number; end: number; text: string }

// Interleaved 16-bit PCM WAV. Mono or multi-channel — the offline render is mono, but this
// stays general so any AudioBuffer round-trips losslessly.
export function encodeWav(buffer:AudioBuffer):ArrayBuffer{const channels=buffer.numberOfChannels,length=buffer.length*channels*2,out=new ArrayBuffer(44+length),v=new DataView(out);const str=(o:number,s:string)=>{for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i))};str(0,'RIFF');v.setUint32(4,36+length,true);str(8,'WAVE');str(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,channels,true);v.setUint32(24,buffer.sampleRate,true);v.setUint32(28,buffer.sampleRate*channels*2,true);v.setUint16(32,channels*2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,length,true);let p=44;for(let i=0;i<buffer.length;i++)for(let c=0;c<channels;c++){const x=Math.max(-1,Math.min(1,buffer.getChannelData(c)[i]));v.setInt16(p,x<0?x*32768:x*32767,true);p+=2}return out}

const srtTime=(sec:number):string=>{const ms=Math.max(0,Math.round(sec*1000)),p=(n:number,l=2)=>String(n).padStart(l,'0');return `${p(Math.floor(ms/3600000))}:${p(Math.floor(ms/60000)%60)}:${p(Math.floor(ms/1000)%60)},${p(ms%1000,3)}`}

// One cue per spoken fragment, timed to the rendered audio.
export function buildSrt(marks:Mark[]):string{return marks.map((m,i)=>`${i+1}\n${srtTime(m.start)} --> ${srtTime(m.end)}\n${m.text}`).join('\n\n')+'\n'}
