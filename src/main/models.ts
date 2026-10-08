import { cpus, totalmem } from 'node:os'

// Picks the reply model for this Mac the way llmfit does: a model must fit in the memory the
// GPU can actually use, run fast enough to answer in seconds, and among those the best one
// wins. Only non-reasoning instruct models are listed — thinking models spend minutes on
// hidden reasoning before a reply that only needs ~20 tokens.

export interface ChatModel {
  tag: string
  sizeGB: number      // download / weights on disk
  activeGB: number    // weights read per token (lower than sizeGB for mixture-of-experts)
  kvGBPer4k: number   // KV cache at 4096 tokens of context
}

// Best first. Each tier is a real step up in quality, so more capable hardware gets a better model.
export const CHAT_MODELS: ChatModel[] = [
  { tag: 'qwen3:235b-instruct', sizeGB: 142.2, activeGB: 13.5, kvGBPer4k: 0.8 },
  { tag: 'qwen3:30b-instruct', sizeGB: 18.6, activeGB: 2.0, kvGBPer4k: 0.4 },
  { tag: 'gemma3:12b', sizeGB: 8.2, activeGB: 8.2, kvGBPer4k: 0.4 },
  { tag: 'qwen3:4b-instruct', sizeGB: 2.5, activeGB: 2.5, kvGBPer4k: 0.6 },
  { tag: 'llama3.2:3b', sizeGB: 2.0, activeGB: 2.0, kvGBPer4k: 0.45 },
  { tag: 'gemma3:1b', sizeGB: 0.8, activeGB: 0.8, kvGBPer4k: 0.1 }
]
export const EMBED_MODEL = 'nomic-embed-text'

// Memory bandwidth (GB/s) by chip; token generation is bandwidth-bound.
const BANDWIDTH: Record<string, number> = {
  'M1': 68, 'M1 Pro': 200, 'M1 Max': 400, 'M1 Ultra': 800,
  'M2': 100, 'M2 Pro': 200, 'M2 Max': 400, 'M2 Ultra': 800,
  'M3': 100, 'M3 Pro': 150, 'M3 Max': 400, 'M3 Ultra': 819,
  'M4': 120, 'M4 Pro': 273, 'M4 Max': 546,
  'M5': 153
}
export function bandwidthGBps(chip: string): number {
  const m = chip.match(/\b(M\d+)(?:\s+(Pro|Max|Ultra))?\b/)
  if (!m) return 68
  const known = BANDWIDTH[m[2] ? `${m[1]} ${m[2]}` : m[1]]
  return known ?? ({ Pro: 200, Max: 400, Ultra: 800 } as Record<string, number>)[m[2] ?? ''] ?? 100
}

// macOS lets Metal wire about two thirds of unified memory on smaller Macs, three quarters on larger.
export const gpuBudgetGB = (ramGB: number): number => ramGB * (ramGB > 36 ? 0.75 : 2 / 3)

// Fraction of peak bandwidth llama.cpp reaches in practice (measured ~11 tok/s for a 2.5 GB model on an M1).
const EFFICIENCY = 0.4
const OVERHEAD_GB = 1
const MIN_TPS = 8

export const loadedGB = (m: ChatModel, ctx: number): number => m.sizeGB + m.kvGBPer4k * ctx / 4096 + OVERHEAD_GB
export const estimateTps = (m: ChatModel, chip: string): number => bandwidthGBps(chip) * EFFICIENCY / m.activeGB

export function recommendChat(ramGB: number, chip: string, ctx: number): ChatModel {
  const budget = gpuBudgetGB(ramGB)
  return CHAT_MODELS.find(m => loadedGB(m, ctx) <= budget && estimateTps(m, chip) >= MIN_TPS) ?? CHAT_MODELS[CHAT_MODELS.length - 1]
}

// The prompt is bounded (persona + at most PHRASE_CAP phrases ≈ a couple thousand tokens), so a
// huge window just wastes load time and memory. Scale modestly with RAM.
export const autoContext = (ramGB: number): number => ramGB >= 16 ? 8192 : ramGB >= 8 ? 4096 : 2048
export const recommendWhisper = (ramGB: number): string => ramGB >= 32 ? 'large-v3' : ramGB >= 16 ? 'medium.en' : ramGB >= 8 ? 'small.en' : 'base.en'
export const WHISPER_SIZES: Record<string, string> = { 'large-v3': '3.1 GB', 'medium.en': '1.5 GB', 'small.en': '488 MB', 'base.en': '148 MB' }

export const machine = (): { ramGB: number; chip: string } => ({ ramGB: Math.round(totalmem() / 1073741824), chip: cpus()[0]?.model ?? '' })
// What the app and the installer both use when the user hasn't chosen: the same answer everywhere.
export const defaultChatModel = (): string => { const m = machine(); return recommendChat(m.ramGB, m.chip, autoContext(m.ramGB)).tag }
