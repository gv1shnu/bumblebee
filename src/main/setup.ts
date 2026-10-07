import { createWriteStream } from 'node:fs'
import { mkdir, readdir, rename, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { get } from 'node:https'
import type { MachineInfo } from '../shared/types'
import { findBinary, run } from './process'
import { recommendChat } from './models'
import { ensureServer, installedModels, ollamaBinary } from './ollama'
import { replyContext } from './reply'

const sysctl = async (key:string): Promise<string> => { const bin=await findBinary('sysctl'); return bin ? (await run(bin,['-n',key])).trim() : '' }
export async function detect(userData: string): Promise<MachineInfo> {
  const [chip,ram,cores,ffmpeg,whisper,ollama] = await Promise.all([sysctl('machdep.cpu.brand_string'),sysctl('hw.memsize'),sysctl('hw.ncpu'),findBinary('ffmpeg'),findBinary('whisper-cli'),ollamaBinary()])
  const ramGB=Math.round(Number(ram)/1073741824)
  const ollamaModels=ollama&&await ensureServer()?await installedModels():[]
  const whisperModels:string[]=[]
  for (const dir of [join(homedir(),'.cache/whisper'),join(userData,'models')]) try { for(const f of await readdir(dir)) if(/^ggml-.*\.bin$/.test(f)) whisperModels.push(f.replace(/^ggml-|\.bin$/g,'')) } catch {}
  const recommendedWhisper=ramGB>=32?'large-v3':ramGB>=16?'medium.en':ramGB>=8?'small.en':'base.en'
  const recommendedContext=replyContext()
  const chat=recommendChat(ramGB,chip,recommendedContext)
  return {chip:chip||process.arch,ramGB,cores:Number(cores)||1,hasFfmpeg:!!ffmpeg,hasWhisper:!!whisper,hasOllama:!!ollama,ollamaModels,whisperModels,recommendedWhisper,recommendedChat:chat.tag,recommendedChatSizeGB:chat.sizeGB,recommendedContext}
}
export async function pullWhisper(userData:string,model:string,onProgress:(pct:number)=>void): Promise<void> {
  if(!/^[a-z0-9.-]+$/i.test(model)) throw new Error('Invalid model name')
  const dir=join(userData,'models'); await mkdir(dir,{recursive:true}); const target=join(dir,`ggml-${model}.bin`); const temp=`${target}.partial`
  await new Promise<void>((resolve,reject)=>{ const request=(url:string):void=>{ get(url,res=>{ if(res.statusCode && res.statusCode>=300 && res.statusCode<400 && res.headers.location) return request(res.headers.location)
      if(res.statusCode!==200) return reject(new Error(`Download failed: ${res.statusCode}`)); const total=Number(res.headers['content-length'])||0; let received=0; const file=createWriteStream(temp)
      res.on('data',d=>{received+=d.length;if(total)onProgress(Math.round(received/total*100))}); res.pipe(file); file.on('finish',()=>file.close(()=>resolve())); file.on('error',reject)
    }).on('error',reject)}; request(`https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${model}.bin`) })
  await rename(temp,target); onProgress(100)
}
export async function ensureFx(userData:string): Promise<void> {
  const ffmpeg=await findBinary('ffmpeg'); if(!ffmpeg)return; const dir=join(userData,'fx'); await mkdir(dir,{recursive:true})
  const jobs: Array<[string,string[]]> = [
    ['staticShort',['-f','lavfi','-i','anoisesrc=color=white:duration=0.4:sample_rate=48000','-af','highpass=f=500,lowpass=f=6000,volume=.18','-ac','1']],
    ['staticLong',['-f','lavfi','-i','anoisesrc=color=white:duration=1.2:sample_rate=48000','-af','highpass=f=500,lowpass=f=6000,volume=.16','-ac','1']],
    ['sweep',['-f','lavfi','-i','aevalsrc=0.1*sin(2*PI*(300*t+1687.5*t*t)):s=48000:d=0.8','-ac','1']],
    ['bed',['-f','lavfi','-i','anoisesrc=color=pink:duration=4:sample_rate=48000','-af','highpass=f=100,lowpass=f=2800,volume=.012','-ac','1']]
  ]
  for(const [name,args] of jobs){const p=join(dir,`${name}.wav`);try{await stat(p)}catch{await run(ffmpeg,[...args,'-y',p])}}
}
