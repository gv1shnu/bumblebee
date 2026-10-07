// Fetch a pinned Ollama release into vendor/ollama so electron-builder can ship it inside the
// app (Contents/Resources/ollama). Users then never install Ollama themselves.
// The download is checked against the release's published SHA-256, thinned to arm64 (the only
// arch the DMG targets), and x86-only libraries are dropped — roughly 520 MB down to ~430 MB.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const VERSION = '0.40.0'
const SHA256 = 'b490b4925a95c5f3dfcd889e566cf3dcd727848d59057fb00b03f1d6630326dc'
const URL = `https://github.com/ollama/ollama/releases/download/v${VERSION}/ollama-darwin.tgz`

const dir = join(import.meta.dirname, '..', 'vendor', 'ollama')
const stamp = join(dir, 'VERSION')
if (existsSync(stamp) && readFileSync(stamp, 'utf8').trim() === VERSION) process.exit(0)

console.log(`fetching ollama ${VERSION}…`)
const res = await fetch(URL)
if (!res.ok) throw new Error(`download failed: ${res.status}`)
const archive = Buffer.from(await res.arrayBuffer())
const digest = createHash('sha256').update(archive).digest('hex')
if (digest !== SHA256) throw new Error(`checksum mismatch: got ${digest}`)

rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true })
const tgz = join(dir, '..', 'ollama-darwin.tgz'); writeFileSync(tgz, archive)
execFileSync('tar', ['xzf', tgz, '-C', dir]); rmSync(tgz)

const archs = file => { try { return execFileSync('lipo', ['-archs', file], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().split(' ') } catch { return null } }
const walk = d => readdirSync(d).flatMap(n => { const p = join(d, n); return lstatSync(p).isDirectory() ? walk(p) : [p] })
for (const file of walk(dir)) {
  if (lstatSync(file).isSymbolicLink()) continue
  const a = archs(file); if (!a) continue
  if (!a.includes('arm64')) rmSync(file)
  else if (a.length > 1) execFileSync('lipo', ['-thin', 'arm64', file, '-output', file])
}
// Symlinks whose targets were x86-only now dangle.
for (const file of walk(dir)) if (lstatSync(file).isSymbolicLink() && !existsSync(file)) rmSync(file)

execFileSync(join(dir, 'ollama'), ['--version'], { stdio: 'ignore' })
writeFileSync(stamp, VERSION)
console.log(`ollama ${VERSION} ready in vendor/ollama`)
