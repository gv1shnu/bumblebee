// On-device macOS Speech framework as a second transcriber. Whisper is the primary ASR;
// when it comes back thin, we hand the same audio to Apple's recogniser and fold in any
// phrases whisper missed. A tiny Swift helper is compiled once and cached — everything here
// degrades to "whisper alone" when swiftc, the framework, or Speech permission is absent.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { findBinary } from './process'

export type SpeechWord = { word: string; start: number; end: number; probability: number }

// Backslash-free on purpose: this is embedded in a JS template literal, so Swift string
// interpolation and escapes are avoided in favour of plain concatenation and Data(_.utf8).
const SWIFT_SOURCE = `import Foundation
import Speech

let args = CommandLine.arguments
if args.count < 2 { FileHandle.standardError.write(Data("usage: speech-transcribe <wav> [lang]".utf8)); exit(2) }
let url = URL(fileURLWithPath: args[1])
let hint = args.count >= 3 ? args[2] : ""

func pickLocale(_ hint: String) -> Locale {
  let supported = SFSpeechRecognizer.supportedLocales()
  if !hint.isEmpty, let m = supported.first(where: { $0.language.languageCode?.identifier == hint }) { return m }
  if supported.contains(Locale.current) { return Locale.current }
  return Locale(identifier: "en-US")
}

let authSem = DispatchSemaphore(value: 0)
var authorized = false
SFSpeechRecognizer.requestAuthorization { status in authorized = (status == .authorized); authSem.signal() }
authSem.wait()
if !authorized { FileHandle.standardError.write(Data("speech authorization not granted".utf8)); exit(3) }

let locale = pickLocale(hint)
guard let rec = SFSpeechRecognizer(locale: locale), rec.isAvailable else { FileHandle.standardError.write(Data(("recognizer unavailable for " + locale.identifier).utf8)); exit(4) }
rec.defaultTaskHint = .dictation
let req = SFSpeechURLRecognitionRequest(url: url)
req.shouldReportPartialResults = false
req.addsPunctuation = true
if rec.supportsOnDeviceRecognition { req.requiresOnDeviceRecognition = true }

let done = DispatchSemaphore(value: 0)
var code: Int32 = 0
rec.recognitionTask(with: req) { result, error in
  if let error = error { FileHandle.standardError.write(Data(("recognition error: " + error.localizedDescription).utf8)); code = 5; done.signal(); return }
  guard let result = result, result.isFinal else { return }
  var words: [[String: Any]] = []
  for seg in result.bestTranscription.segments {
    let w = seg.substring.trimmingCharacters(in: .whitespaces)
    if w.isEmpty { continue }
    let conf = Double(seg.confidence)
    words.append(["word": w, "start": seg.timestamp, "end": seg.timestamp + seg.duration, "probability": conf > 0 ? min(1.0, conf) : 0.8])
  }
  let out: [String: Any] = ["language": locale.identifier, "words": words]
  if let data = try? JSONSerialization.data(withJSONObject: out) { FileHandle.standardOutput.write(data) }
  done.signal()
}
done.wait()
exit(code)
`

// Compile the helper once and cache the binary under userData/bin. Returns null (rather than
// throwing) whenever the platform, toolchain, or compile step can't produce it.
export async function ensureSpeechHelper(userData: string): Promise<string | null> {
  if (process.platform !== 'darwin') return null
  const binDir = join(userData, 'bin'); const bin = join(binDir, 'speech-transcribe')
  try { await stat(bin); return bin } catch { /* needs building */ }
  const swiftc = (await findBinary('swiftc')) ?? (existsSync('/usr/bin/swiftc') ? '/usr/bin/swiftc' : null)
  if (!swiftc) return null
  try {
    await mkdir(binDir, { recursive: true })
    const src = join(binDir, 'speech-transcribe.swift'); await writeFile(src, SWIFT_SOURCE)
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(swiftc, ['-O', '-o', bin, src]); let err = ''
      proc.stderr.on('data', d => { err += d })
      proc.on('error', reject); proc.on('close', c => c === 0 ? resolve() : reject(new Error(err.trim() || `swiftc exited ${c}`)))
    })
    return bin
  } catch (error) { console.warn('speech helper build failed', error); return null }
}

// Run the helper on a 16 kHz wav. Never rejects — on any failure (auth, unsupported locale,
// timeout, bad output) it resolves to an empty list so ingest keeps whatever whisper found.
export function speechTranscribe(bin: string, wav: string, lang?: string, timeoutMs = 120000): Promise<SpeechWord[]> {
  return new Promise(resolve => {
    const proc = spawn(bin, lang ? [wav, lang] : [wav]); let out = ''; let err = ''
    const timer = setTimeout(() => { try { proc.kill('SIGKILL') } catch { /* already gone */ } resolve([]) }, timeoutMs)
    proc.stdout.on('data', d => { out += d }); proc.stderr.on('data', d => { err += d })
    proc.on('error', () => { clearTimeout(timer); resolve([]) })
    proc.on('close', () => {
      clearTimeout(timer)
      try { const j = JSON.parse(out); resolve(Array.isArray(j.words) ? j.words : []) }
      catch { if (err.trim()) console.warn('speech:', err.trim()); resolve([]) }
    })
  })
}
