import type { Clip, ClipId, CorpusStats, IngestProgress, MachineInfo, ReplyResult, Settings, Source, SourceId, Utterance } from './types'

export interface Bridge {
  corpus: { stats(): Promise<CorpusStats>; sources(): Promise<Source[]>; lookup(keys: string[]): Promise<Record<string, Clip[]>>; clipAudio(id: ClipId): Promise<ArrayBuffer>; fxAudio(name: 'staticShort'|'staticLong'|'sweep'|'bed'): Promise<ArrayBuffer>; reset(): Promise<boolean> }
  reply: { generate(input: string): Promise<ReplyResult> }
  ingest: { pickFolder(): Promise<string|null>; start(folders: string[]): Promise<string>; cancel(jobId: string): Promise<void>; onProgress(cb: (p: IngestProgress) => void): () => void }
  history: { list(limit: number, offset: number): Promise<Utterance[]>; save(u: Omit<Utterance,'id'|'createdAt'>): Promise<Utterance>; remove(id: string): Promise<void>; clear(): Promise<void> }
  settings: { get(): Promise<Settings>; set(patch: Partial<Settings>): Promise<Settings>; pickExportFolder(): Promise<string|null> }
  setup: { detect(): Promise<MachineInfo>; pullWhisper(model: string): Promise<void>; pullOllama(model: string): Promise<void>; onPullProgress(cb: (p: {name:string;pct:number}) => void): () => void }
  review: { next(filter?: {untaggedOnly?:boolean;sourceId?:SourceId}): Promise<Clip|null>; tag(id: ClipId, tags: string[]): Promise<void>; reject(id: ClipId): Promise<void> }
  exportAudio: { write(bytes: ArrayBuffer, ext: string, slug: string, srt?: string): Promise<string> }
}

export const IPC = {
  stats:'corpus:stats',sources:'corpus:sources',lookup:'corpus:lookup',clipAudio:'corpus:clipAudio',fxAudio:'corpus:fxAudio',resetLibrary:'corpus:reset',
  generate:'reply:generate',pickFolder:'ingest:pickFolder',startIngest:'ingest:start',cancelIngest:'ingest:cancel',ingestProgress:'ingest:progress',
  historyList:'history:list',historySave:'history:save',historyRemove:'history:remove',historyClear:'history:clear',
  settingsGet:'settings:get',settingsSet:'settings:set',pickExport:'settings:pickExport',detect:'setup:detect',pullWhisper:'setup:pullWhisper',pullOllama:'setup:pullOllama',pullProgress:'setup:pullProgress',
  reviewNext:'review:next',reviewTag:'review:tag',reviewReject:'review:reject',exportWrite:'export:write'
} as const
