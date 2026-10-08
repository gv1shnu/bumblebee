// On-device macOS Speech framework as a second transcriber. Whisper is the primary ASR;
// when it comes back thin, we hand the same audio to Apple's recogniser and fold in any
// phrases whisper missed. The helper (native/speech-transcribe.swift) is compiled at build time
// and ships in the app, so users never need Xcode. Everything here degrades to "whisper alone"
// when the helper, the framework, or Speech permission is absent.
import { spawn } from 'node:child_process'
import { tool } from './process'

export type SpeechWord = { word: string; start: number; end: number; probability: number }

export async function ensureSpeechHelper(): Promise<string | null> {
  return process.platform === 'darwin' ? await tool('speech-transcribe') : null
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
