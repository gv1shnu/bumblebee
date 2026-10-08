// Run by the .pkg installer's postinstall script (build/pkg-scripts/postinstall), as the user
// who is installing, through the app's own Electron in ELECTRON_RUN_AS_NODE mode. Downloads the
// models this Mac should use, so the app is ready the moment it first opens.
// Uses the same recommendation code as the app, so the installer and Setup always agree.
import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { EMBED_MODEL, defaultChatModel, machine, recommendWhisper } from './models'
import { ensureServer, installedModels, pullModel, stopServer } from './ollama'
import { pullWhisper } from './setup'

// Electron's app.getPath('userData') for this app (named after package.json "name").
const userData = join(homedir(), 'Library', 'Application Support', 'bumblebee-radio')

const log = (msg: string) => console.log(`[bumblebee] ${msg}`)
const progress = (name: string) => { let last = -10; return (pct: number) => { if (pct >= last + 10 || (pct === 100 && last !== 100)) { last = pct; log(`${name} ${pct}%`) } } }

async function main(): Promise<void> {
  const { ramGB, chip } = machine()
  const chat = defaultChatModel(), whisper = recommendWhisper(ramGB)
  log(`${chip}, ${ramGB} GB: reply ${chat}, search ${EMBED_MODEL}, speech ${whisper}`)

  if (!existsSync(join(userData, 'models', `ggml-${whisper}.bin`))) await pullWhisper(userData, whisper, progress(whisper))
  if (!await ensureServer()) throw new Error('could not start the bundled Ollama')
  const have = await installedModels()
  for (const m of [EMBED_MODEL, chat]) if (!have.includes(m)) await pullModel(m, progress(m))
  log('models ready')
}

// Never fail the installation over a download: the app's Setup screen offers the same pulls.
main().catch(e => log(`model download incomplete: ${e instanceof Error ? e.message : e}`)).finally(() => { stopServer(); process.exit(0) })
