import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'

export const augmentedPath = (): string => ['/opt/homebrew/bin','/usr/local/bin',process.env.PATH ?? ''].join(delimiter)
export async function findBinary(name: string): Promise<string|null> {
  for (const dir of augmentedPath().split(delimiter)) { const p=join(dir,name); try { await access(p); return p } catch {} }
  return null
}
// Contents/Resources of the installed app. Electron sets resourcesPath; the installer's
// ELECTRON_RUN_AS_NODE entry doesn't, so derive it from Contents/MacOS/<exe>.
export const resourcesDir = (): string => process.resourcesPath ?? join(dirname(process.execPath),'..','Resources')
// Tools ship inside the app (see scripts/vendor.mjs): Resources/bin when installed, vendor/bin
// in dev. A tool on PATH is only a fallback for dev checkouts that haven't run the vendor step.
export async function tool(name: string): Promise<string|null> {
  return [join(resourcesDir(),'bin',name),join(process.cwd(),'vendor','bin',name)].find(p=>existsSync(p)) ?? await findBinary(name)
}
export function run(binary: string, args: string[], onLine?: (line:string)=>void): Promise<string> {
  return new Promise((resolve,reject)=>{ const child=spawn(binary,args,{env:{...process.env,PATH:augmentedPath()}}); let out=''; let err=''
    child.stdout.on('data',d=>{out+=d; onLine?.(String(d))}); child.stderr.on('data',d=>{err+=d; onLine?.(String(d))})
    child.on('error',reject); child.on('close',code=>code===0?resolve(out):reject(new Error(`${binary} exited ${code}: ${err.slice(-1000)}`)))
  })
}
