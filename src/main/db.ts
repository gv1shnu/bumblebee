import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Clip, CorpusStats, Settings, Source, Utterance } from '../shared/types'

export const DEFAULT_SETTINGS: Settings = {
  mediaFolders: [], saveTranscripts: true, autoSaveAudio: false, exportFolder: '', exportFormat: 'wav',
  exportSrt: true, filenamePattern: '{date}_{time}_{slug}', historyRetention: 'all', whisperModel: '', chatModel: '', replyMode: 'llm'
}

export class CorpusDb {
  readonly db: Database.Database
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true })
    this.db = new Database(path)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.migrate()
  }
  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sources(id TEXT PRIMARY KEY,label TEXT,title TEXT,era INT,kind TEXT,path TEXT,hash TEXT UNIQUE,ingestedAt TEXT);
      CREATE TABLE IF NOT EXISTS clips(id TEXT PRIMARY KEY,phrase TEXT,phraseKey TEXT,dur REAL,sourceId TEXT,quality REAL,phones TEXT,file TEXT,rejected INT DEFAULT 0,FOREIGN KEY(sourceId) REFERENCES sources(id));
      CREATE TABLE IF NOT EXISTS clip_tags(clipId TEXT,tag TEXT,PRIMARY KEY(clipId,tag),FOREIGN KEY(clipId) REFERENCES clips(id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS phrase_vec(phraseKey TEXT PRIMARY KEY,embedding BLOB);
      CREATE TABLE IF NOT EXISTS utterances(id TEXT PRIMARY KEY,input TEXT,reply TEXT,fragments TEXT,seed INT,model TEXT,createdAt TEXT);
      CREATE TABLE IF NOT EXISTS settings(k TEXT PRIMARY KEY,v TEXT);
      CREATE INDEX IF NOT EXISTS idx_clips_phraseKey ON clips(phraseKey);
      CREATE INDEX IF NOT EXISTS idx_clips_sourceId ON clips(sourceId);
      CREATE VIRTUAL TABLE IF NOT EXISTS clips_fts USING fts5(phrase,content='clips',content_rowid='rowid');
      CREATE TRIGGER IF NOT EXISTS clips_ai AFTER INSERT ON clips BEGIN INSERT INTO clips_fts(rowid,phrase) VALUES(new.rowid,new.phrase); END;
      CREATE TRIGGER IF NOT EXISTS clips_ad AFTER DELETE ON clips BEGIN INSERT INTO clips_fts(clips_fts,rowid,phrase) VALUES('delete',old.rowid,old.phrase); END;
      CREATE TRIGGER IF NOT EXISTS clips_au AFTER UPDATE OF phrase ON clips BEGIN
        INSERT INTO clips_fts(clips_fts,rowid,phrase) VALUES('delete',old.rowid,old.phrase);
        INSERT INTO clips_fts(rowid,phrase) VALUES(new.rowid,new.phrase);
      END;
    `)
    const put = this.db.prepare('INSERT OR IGNORE INTO settings(k,v) VALUES(?,?)')
    const tx = this.db.transaction(() => Object.entries(DEFAULT_SETTINGS).forEach(([k,v]) => put.run(k, JSON.stringify(v))))
    tx()
    try {
      const vec = require('sqlite-vec') as { getLoadablePath(): string }
      const extensionPath = vec.getLoadablePath().replace('app.asar/', 'app.asar.unpacked/')
      this.db.loadExtension(extensionPath)
    } catch (error) { console.warn('Vector extension unavailable; using cosine fallback', error) }
  }
  settings(): Settings {
    const values = { ...DEFAULT_SETTINGS } as Record<string, unknown>
    for (const row of this.db.prepare('SELECT k,v FROM settings').all() as Array<{k:string;v:string}>) values[row.k] = JSON.parse(row.v)
    return values as unknown as Settings
  }
  setSettings(patch: Partial<Settings>): Settings {
    const allowed = new Set(Object.keys(DEFAULT_SETTINGS)); const stmt = this.db.prepare('INSERT OR REPLACE INTO settings(k,v) VALUES(?,?)')
    this.db.transaction(() => Object.entries(patch).forEach(([k,v]) => { if (allowed.has(k) && v !== undefined) stmt.run(k, JSON.stringify(v)) }))()
    return this.settings()
  }
  stats(): CorpusStats {
    const r = this.db.prepare(`SELECT count(*) clipCount,count(DISTINCT phraseKey) phraseCount,count(DISTINCT sourceId) sourceCount,coalesce(sum(dur),0)/3600 hours FROM clips WHERE rejected=0`).get() as CorpusStats
    return r
  }
  sources(): Source[] { return this.db.prepare('SELECT id,label,title,era,kind FROM sources ORDER BY title').all() as Source[] }
  lookup(keys: string[]): Record<string, Clip[]> {
    if (!keys.length) return {}
    const rows = this.db.prepare(`SELECT id,phrase,dur,sourceId,quality,phones,phraseKey FROM clips WHERE rejected=0 AND phraseKey IN (${keys.map(()=>'?').join(',')}) ORDER BY quality DESC`).all(...keys) as Array<Clip & {phraseKey:string}>
    return keys.reduce<Record<string,Clip[]>>((out,k) => (out[k]=rows.filter(r=>r.phraseKey===k).slice(0,3).map(({phraseKey:_,...clip})=>clip),out),{})
  }
  history(limit: number, offset: number): Utterance[] {
    return (this.db.prepare('SELECT * FROM utterances ORDER BY createdAt DESC LIMIT ? OFFSET ?').all(Math.max(1,Math.min(500,limit)),Math.max(0,offset)) as Array<Omit<Utterance,'fragments'> & {fragments:string}>).map(x=>({...x,fragments:JSON.parse(x.fragments)}))
  }
}
