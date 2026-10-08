export type ClipId = string
export type SourceId = string

export interface Source { id: SourceId; label: string; title: string; era: number; kind: 'tv' | 'film' }
export interface Clip { id: ClipId; phrase: string; dur: number; sourceId: SourceId; quality: number; phones?: string }
export type Segment =
  | { kind: 'clip'; text: string; clip: Clip; dur: number; audioStart?: number; audioClipEnd?: number; audioEnd?: number }
  | { kind: 'unmatched'; text: string; dur: number; audioStart?: number; audioClipEnd?: number; audioEnd?: number }
export interface Utterance { id: string; input: string; reply: string; fragments: ClipId[]; seed: number; model: string; createdAt: string }
export interface CorpusStats { clipCount: number; phraseCount: number; sourceCount: number; hours: number }
export interface IngestProgress {
  jobId: string; stage: 'scan'|'subtitles'|'audio'|'align'|'segment'|'cut'|'embed'|'done'|'error'
  file: string; fileIndex: number; fileTotal: number; pct: number; message: string
}
export interface MachineInfo {
  chip: string; ramGB: number; cores: number; hasFfmpeg: boolean; hasWhisper: boolean; hasOllama: boolean
  ollamaModels: string[]; whisperModels: string[]; recommendedWhisper: string; recommendedChat: string
  recommendedChatSizeGB: number; embedModel: string; recommendedContext: number
}
export interface Settings {
  mediaFolders: string[]; saveTranscripts: boolean; autoSaveAudio: boolean; exportFolder: string
  exportFormat: 'wav'|'mp3'|'m4a'; exportSrt: boolean; filenamePattern: string
  historyRetention: 'all'|'500'|'100'; whisperModel: string; chatModel: string; replyMode: 'llm'|'local'
  contextLength: number; keepAlive: number; persona: boolean
}
export interface ReplyResult { reply: string; fragments: ClipId[]; seed: number; model: string }
