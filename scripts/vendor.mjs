// Build everything the app runs besides itself into vendor/, so the installed app needs nothing
// else on the Mac. electron-builder ships vendor/ollama as Contents/Resources/ollama and
// vendor/bin as Contents/Resources/bin.
//   ollama       pinned release, SHA-256 checked, thinned to arm64 (the only arch we ship)
//   ffmpeg/probe built from source as an LGPL, static, system-libraries-only binary
//   whisper-cli  built from source, static, with the Metal shaders embedded
//   speech-transcribe  the on-device Speech helper, compiled here instead of on users' Macs
// Each part is cached under vendor/ with a stamp, so re-runs are instant. Building needs the
// Xcode command-line tools; cmake is installed into a private venv if it's missing.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { cpus } from 'node:os'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const vendor = join(root, 'vendor'), bin = join(vendor, 'bin'), work = join(vendor, '.build')
const MIN_MACOS = '12.0'
const jobs = String(cpus().length)

const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...opts })
const fresh = (name, version) => { try { return readFileSync(join(vendor, `.${name}`), 'utf8').trim() === version } catch { return false } }
const stamp = (name, version) => writeFileSync(join(vendor, `.${name}`), version)

async function download(url, sha256, dest) {
  console.log(`fetching ${url}`)
  const res = await fetch(url); if (!res.ok) throw new Error(`download failed: ${res.status} ${url}`)
  const data = Buffer.from(await res.arrayBuffer())
  const digest = createHash('sha256').update(data).digest('hex')
  if (digest !== sha256) throw new Error(`checksum mismatch for ${url}: got ${digest}`)
  writeFileSync(dest, data)
}
async function source(name, url, sha256) {
  const dir = join(work, name), archive = join(work, `${name}.tar`)
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true })
  await download(url, sha256, archive); sh('tar', ['xf', archive, '-C', dir, '--strip-components', '1']); rmSync(archive)
  return dir
}
const walk = d => readdirSync(d).flatMap(n => { const p = join(d, n); return lstatSync(p).isDirectory() ? walk(p) : [p] })
const archs = file => { try { return execFileSync('lipo', ['-archs', file], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().split(' ') } catch { return null } }

async function ollama() {
  const VERSION = '0.40.0', SHA256 = 'b490b4925a95c5f3dfcd889e566cf3dcd727848d59057fb00b03f1d6630326dc'
  if (fresh('ollama', VERSION)) return
  const dir = join(vendor, 'ollama'), tgz = join(work, 'ollama.tgz')
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true })
  await download(`https://github.com/ollama/ollama/releases/download/v${VERSION}/ollama-darwin.tgz`, SHA256, tgz)
  sh('tar', ['xzf', tgz, '-C', dir]); rmSync(tgz)
  // ~520 MB universal → ~430 MB: drop x86-only libraries, thin the rest to arm64.
  for (const file of walk(dir)) {
    if (lstatSync(file).isSymbolicLink()) continue
    const a = archs(file); if (!a) continue
    if (!a.includes('arm64')) rmSync(file)
    else if (a.length > 1) sh('lipo', ['-thin', 'arm64', file, '-output', file])
  }
  for (const file of walk(dir)) if (lstatSync(file).isSymbolicLink() && !existsSync(file)) rmSync(file)
  execFileSync(join(dir, 'ollama'), ['--version'], { stdio: 'ignore' })
  stamp('ollama', VERSION)
}

async function ffmpeg() {
  const VERSION = '9.0.2', SHA256 = '8c3850283eb25fa026482078a04051e0be17347b09ef81a0849bec15a96e002e'
  if (fresh('ffmpeg', VERSION)) return
  const dir = await source('ffmpeg', `https://ffmpeg.org/releases/ffmpeg-${VERSION}.tar.xz`, SHA256)
  // LGPL (no --enable-gpl), no autodetected Homebrew libraries, only the encoders/muxers the
  // app writes (flac, wav, srt); every decoder, demuxer and filter stays in, plus the lavfi
  // input that generates the radio's static.
  sh('./configure', ['--arch=arm64', '--cc=clang', '--disable-autodetect', '--enable-zlib', '--enable-iconv', '--extra-libs=-liconv',
    '--disable-doc', '--disable-network', '--disable-ffplay', '--disable-indevs', '--enable-indev=lavfi', '--disable-outdevs',
    '--disable-encoders', '--enable-encoder=flac,pcm_s16le,pcm_s24le,pcm_f32le,srt,subrip,ass,text',
    '--disable-muxers', '--enable-muxer=flac,wav,srt,ass,null',
    `--extra-cflags=-mmacosx-version-min=${MIN_MACOS}`, `--extra-ldflags=-mmacosx-version-min=${MIN_MACOS}`], { cwd: dir })
  sh('make', ['-j', jobs, 'ffmpeg', 'ffprobe'], { cwd: dir })
  for (const b of ['ffmpeg', 'ffprobe']) copyFileSync(join(dir, b), join(bin, b))
  copyFileSync(join(dir, 'COPYING.LGPLv2.1'), join(bin, 'FFMPEG_LICENSE'))
  stamp('ffmpeg', VERSION)
}

function cmake() {
  try { execFileSync('cmake', ['--version'], { stdio: 'ignore' }); return 'cmake' } catch { /* use a private copy */ }
  const venv = join(work, 'tools'), local = join(venv, 'bin', 'cmake')
  if (!existsSync(local)) { sh('python3', ['-m', 'venv', venv]); sh(join(venv, 'bin', 'pip'), ['install', '-q', 'cmake==4.1.2']) }
  return local
}

async function whisper() {
  const VERSION = '1.9.5', SHA256 = 'ff1a9053feb509ff9d7729703355541ae9690073a6b1c40eb692c962e0dc1720'
  if (fresh('whisper', VERSION)) return
  const dir = await source('whisper', `https://github.com/ggml-org/whisper.cpp/archive/refs/tags/v${VERSION}.tar.gz`, SHA256)
  const make = cmake()
  sh(make, ['-B', 'build', '-DCMAKE_BUILD_TYPE=Release', '-DBUILD_SHARED_LIBS=OFF', '-DGGML_METAL=ON', '-DGGML_METAL_EMBED_LIBRARY=ON',
    '-DGGML_NATIVE=OFF', '-DGGML_BLAS=OFF', '-DWHISPER_BUILD_TESTS=OFF', '-DWHISPER_BUILD_SERVER=OFF', '-DWHISPER_SDL2=OFF', '-DWHISPER_CURL=OFF',
    '-DCMAKE_OSX_ARCHITECTURES=arm64', `-DCMAKE_OSX_DEPLOYMENT_TARGET=${MIN_MACOS}`], { cwd: dir })
  sh(make, ['--build', 'build', '-j', jobs, '--target', 'whisper-cli'], { cwd: dir })
  copyFileSync(join(dir, 'build', 'bin', 'whisper-cli'), join(bin, 'whisper-cli'))
  copyFileSync(join(dir, 'LICENSE'), join(bin, 'WHISPER_LICENSE'))
  stamp('whisper', VERSION)
}

function speech() {
  const src = join(root, 'native', 'speech-transcribe.swift')
  const version = createHash('sha256').update(readFileSync(src)).digest('hex')
  if (fresh('speech', version)) return
  // Locale.language needs macOS 13; on 12 the helper won't launch and ingest uses whisper alone.
  sh('swiftc', ['-O', '-target', 'arm64-apple-macos13.0', '-o', join(bin, 'speech-transcribe'), src])
  stamp('speech', version)
}

mkdirSync(bin, { recursive: true }); mkdirSync(work, { recursive: true })
await ollama(); await ffmpeg(); await whisper(); speech()
rmSync(work, { recursive: true, force: true })
console.log('vendor/ ready')
