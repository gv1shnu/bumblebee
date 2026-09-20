# Architecture

Two loops and one IPC boundary. That is the whole shape of the app.

## The ingest loop (main process)

Turns the user's local film/TV files into a corpus of short dialogue clips.

`scanFolders` walks the chosen folders for media → for each file: `ffmpeg` extracts and
transcodes audio → `whisper-cli` produces word-timed ASR (cached by file hash, so
re-ingest is cheap) → `candidates()` (`main/ingest.ts`) selects spans on confidence,
duration and gap heuristics, keyed by `phraseKey` → `ffmpeg` cuts one FLAC per span with
edge fades and loudness normalisation.

Output: FLAC clip files on disk under the app's user-data dir, plus `sources` and `clips`
rows in SQLite. Entry points: the `ingest:start` IPC handler and the `src/cli/ingest.ts`
CLI.

## The conversation loop (renderer)

Turns a typed message into speech spliced from those clips.

User input → a reply is produced (Ollama via `reply.generate` in main, or the raw input
in free-speak mode) → `matchText` (`renderer/matcher.ts`) breaks the reply into spans,
normalises each with `phraseKey`, and asks the corpus for matching clips →
`RadioEngine.play(segments, seed)` schedules the clips on the Web Audio graph → a
`requestAnimationFrame` loop reveals the transcript and updates the station tag by reading
`ctx.currentTime`.

The `seed` makes a playback reproducible — the same seed must reproduce the same jitter,
dropouts and gaps, which is what lets an export match what the user heard.

## The IPC boundary

The renderer never touches Node. `preload/index.ts` uses `contextBridge` to expose a
single typed `window.bridge` object whose methods are thin `ipcRenderer.invoke` calls over
the channel names in `shared/ipc.ts`. The `Bridge` interface in that same file is the
contract; the main process registers the matching `ipcMain.handle`s in `main/index.ts`.
The window runs with `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.

Keep the three in lockstep: a method on `Bridge`, its implementation in the preload, and
its handler in main. Drift between them is the failure this boundary exists to prevent.

## Where data lives

One SQLite database (`CorpusDb`, `main/db.ts`) in the app's user-data dir:

- `sources` — one row per ingested file (label, title, era, kind, path, hash).
- `clips` — one row per dialogue fragment (`phrase`, `phraseKey`, `dur`, `sourceId`,
  `quality`, file path, `rejected` flag). Indexed on `phraseKey` and `sourceId`.
- `clips_fts` — FTS5 mirror of `clips.phrase` for text search.
- `clip_tags` — review tags per clip.
- `phrase_vec` — embeddings for semantic lookup (sqlite-vec; degrades gracefully if the
  extension is absent).
- `utterances` — saved conversation history, including the `seed` and `model`.
- `settings` — key/value app settings.

Audio is on the filesystem, not in the database: clips under `clips/<sourceId>/`, the ASR
cache under `cache/<hash>/`. The corpus is built from the user's own media and is never
distributed with the app.
