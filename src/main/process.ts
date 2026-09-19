import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import { delimiter, join } from 'node:path'

export const augmentedPath = (): string => ['/opt/homebrew/bin','/usr/local/bin',process.env.PATH ?? ''].join(delimiter)
export async function findBinary(name: string): Promise<string|null> {
  for (const dir of augmentedPath().split(delimiter)) { const p=join(dir,name); try { await access(p); return p } catch {} }
  return null
}
export function run(binary: string, args: string[], onLine?: (line:string)=>void): Promise<string> {
  return new Promise((resolve,reject)=>{ const child=spawn(binary,args,{env:{...process.env,PATH:augmentedPath()}}); let out=''; let err=''
    child.stdout.on('data',d=>{out+=d; onLine?.(String(d))}); child.stderr.on('data',d=>{err+=d; onLine?.(String(d))})
    child.on('error',reject); child.on('close',code=>code===0?resolve(out):reject(new Error(`${binary} exited ${code}: ${err.slice(-1000)}`)))
  })
}
