# BUILD.md — implementation brief

You are the sole implementer of this project. You own the entire codebase.

One exception: **`docs/` and `REVIEW.md` belong to a reviewer.** Never create, edit, or
delete anything there. Read `REVIEW.md` at the start of every session — it holds findings
against your work that you are expected to act on.

---

## 0. What you're building

A macOS Electron app that speaks by splicing together dialogue fragments from the user's
own film and TV library — the way Bumblebee talks through his radio after his voice
processor is destroyed. The user types a message; the app answers in a collage of borrowed
voices stitched with tuning static, while a terminal types the reply in sync and names the
source of every fragment.

Everything runs locally. No server, no cloud API, no network at runtime except model
downloads the user explicitly requests.

The pipeline is **Node orchestrating three CLI binaries** — `ffmpeg`, `whisper-cli`,
`ollama`. No Python anywhere. Packaging Python and torch inside a `.app` is miserable and
we are not doing it.

---

## 1. Stack

| Layer | Choice |
|---|---|
| Shell | Electron, macOS arm64 only |
| Build | electron-vite |
| Language | TypeScript throughout |
| Renderer | React + Zustand, plain CSS |
| DB | better-sqlite3 + FTS5 + sqlite-vec |
| Audio | raw Web Audio API — **do not add Tone.js**, it abstracts exactly the scheduling we do by hand |
| Clips | FLAC, 48 kHz mono |
| ASR | whisper.cpp (`whisper-cli`), spawned |
| LLM / embeddings | Ollama — chat model by RAM tier, `nomic-embed-text` for vectors |
| Packaging | electron-builder → arm64 dmg |

Setup:

```bash
npm create @quick-start/electron@latest . -- --template react-ts
npm i better-sqlite3 sqlite-vec zustand
npm i -D @types/better-sqlite3 electron-builder
```

Add no further runtime dependencies without a strong reason, and note any you add in your
commit message so the reviewer sees it.

---

## 2. Types — `src/shared/types.ts`

```ts
export type ClipId = string;   // "c_" + 6 hex
export type SourceId = string; // "s_" + slug

export interface Source {
  id: SourceId; label: string; title: string;
  era: number; kind: 'tv' | 'film';
}

export interface Clip {
  id: ClipId; phrase: string; dur: number;
  sourceId: SourceId; quality: number; phones?: string;
}

export type Segment =
  | { kind: 'clip'; text: string; clip: Clip; dur: number }
  | { kind: 'unmatched'; text: string; dur: number };

export interface Utterance {
  id: string; input: string; reply: string;
  fragments: ClipId[]; seed: number; model: string; createdAt: string;
}

export interface CorpusStats {
  clipCount: number; phraseCount: number; sourceCount: number; hours: number;
}

export interface IngestProgress {
  jobId: string;
  stage: 'scan'|'subtitles'|'audio'|'align'|'segment'|'cut'|'embed'|'done'|'error';
  file: string; fileIndex: number; fileTotal: number;
  pct: number; message: string;
}

export interface MachineInfo {
  chip: string; ramGB: number; cores: number;
  hasFfmpeg: boolean; hasWhisper: boolean; hasOllama: boolean;
  ollamaModels: string[]; whisperModels: string[];
  recommendedWhisper: string; recommendedChat: string;
}

export interface Settings {
  mediaFolders: string[];
  saveTranscripts: boolean;     // default true
  autoSaveAudio: boolean;       // default false
  exportFolder: string;
  exportFormat: 'wav' | 'mp3' | 'm4a';
  exportSrt: boolean;           // default true
  filenamePattern: string;      // default '{date}_{time}_{slug}'
  historyRetention: 'all' | '500' | '100';
  whisperModel: string; chatModel: string;
  replyMode: 'llm' | 'local';
}

export interface ReplyResult {
  reply: string; fragments: ClipId[]; seed: number; model: string;
}
```

## 3. IPC — `src/shared/ipc.ts`

Exposed by preload as `window.bridge`. `contextIsolation: true`, `nodeIntegration: false`,
no exceptions. Every method async.

```ts
export interface Bridge {
  corpus: {
    stats(): Promise<CorpusStats>;
    sources(): Promise<Source[]>;
    lookup(phraseKeys: string[]): Promise<Record<string, Clip[]>>;
    clipAudio(id: ClipId): Promise<ArrayBuffer>;
    fxAudio(name: 'staticShort'|'staticLong'|'sweep'|'bed'): Promise<ArrayBuffer>;
  };
  reply: { generate(input: string): Promise<ReplyResult>; };
  ingest: {
    pickFolder(): Promise<string | null>;
    start(folders: string[]): Promise<string>;
    cancel(jobId: string): Promise<void>;
    onProgress(cb: (p: IngestProgress) => void): () => void;
  };
  history: {
    list(limit: number, offset: number): Promise<Utterance[]>;
    save(u: Omit<Utterance,'id'|'createdAt'>): Promise<Utterance>;
    remove(id: string): Promise<void>;
    clear(): Promise<void>;
  };
  settings: {
    get(): Promise<Settings>;
    set(patch: Partial<Settings>): Promise<Settings>;
    pickExportFolder(): Promise<string | null>;
  };
  setup: {
    detect(): Promise<MachineInfo>;
    pullWhisper(model: string): Promise<void>;
    pullOllama(model: string): Promise<void>;
    onPullProgress(cb: (p: {name: string; pct: number}) => void): () => void;
  };
  review: {
    next(filter?: { untaggedOnly?: boolean; sourceId?: SourceId }): Promise<Clip | null>;
    tag(id: ClipId, tags: string[]): Promise<void>;
    reject(id: ClipId): Promise<void>;
  };
  exportAudio: {
    write(bytes: ArrayBuffer, ext: string, slug: string, srt?: string): Promise<string>;
  };
}
```

**Phrase key normalisation**, used everywhere, defined in exactly one exported function:
lowercase → remove every char except `[a-z0-9' ]` → collapse whitespace → trim.

---

## 4. Milestones

Build in this order. Each ends in something runnable. Tag each with
`git tag m0`, `m1`, … so the reviewer can diff against a known point.

### M0 — Foundations

SQLite at `app.getPath('userData')/corpus.db`, WAL mode:

```sql
sources(id TEXT PK, label, title, era INT, kind, path, hash, ingestedAt)
clips(id TEXT PK, phrase, phraseKey, dur REAL, sourceId, quality REAL,
      phones TEXT, file TEXT, rejected INT DEFAULT 0)
clip_tags(clipId, tag, PRIMARY KEY(clipId, tag))
phrase_vec(phraseKey TEXT PK, embedding BLOB)
utterances(id TEXT PK, input, reply, fragments TEXT, seed INT, model, createdAt)
settings(k TEXT PK, v TEXT)
```

Index `clips(phraseKey)` and `clips(sourceId)`. FTS5 over `clips.phrase`. sqlite-vec over
`phrase_vec` — if it fails to load, degrade to brute-force cosine in JS and log it; do not
crash.

Clip audio at `userData/clips/<sourceId>/<clipId>.flac`; DB holds paths. Settings store
with §2 defaults. Preload exposing the full `Bridge`. Three renderer routes: Setup, Radio,
Library.

### M1 — Setup and detection

`setup.detect()`: chip from `sysctl -n machdep.cpu.brand_string`, RAM from `hw.memsize`,
cores from `hw.ncpu`. Probe `ffmpeg`, `whisper-cli`, `ollama` on PATH — **also check
`/opt/homebrew/bin`**, because Electron's PATH is minimal when launched from Finder. This
bites every macOS Electron app; handle it explicitly. `ollama list` for models; scan
`~/.cache/whisper/` and `userData/models/` for ggml files.

Recommend by RAM: ≥32 GB → `large-v3` + `llama3.1:8b`; ≥16 GB → `medium.en` +
`llama3.1:8b`; ≥8 GB → `small.en` + `llama3.2:3b`; below → `base.en` + `llama3.2:3b`.

`pullWhisper` streams the ggml from HuggingFace with progress; `pullOllama` shells
`ollama pull` and parses progress. **Nothing downloads without an explicit renderer call.**
Show sizes first — `large-v3` is 3.1 GB and the user deserves to know.

Generate the four fx assets with ffmpeg on first run into `userData/fx/`: filtered white
noise (`staticShort` 0.4 s, `staticLong` 1.2 s), swept tone (`sweep` 0.8 s), and a
seamless-looping low `bed` (4 s, crossfaded ends). These must exist before any media is
ingested — without them the app cannot make a sound.

Setup wizard UI: chip, RAM, green/red for each binary, recommended vs installed models,
pull buttons with live progress, folder picker, ingest progress.

### M2 — Ingest, one file end to end

**This stage determines whether the product sounds good.** Be careful here.

**a. Probe** with `ffprobe`: channel count, subtitle stream present. Branch on both.

**b. Audio.** If a 5.1 track exists, take the centre channel — `-af "pan=mono|c0=FC"` — it
is near-pure dialogue and beats any separation model on this material. Stereo-only: normal
downmix. Output 48 kHz FLAC master plus a 16 kHz mono WAV for whisper.

**c. Subtitles.** Extract embedded (`-map 0:s:0 -c:s srt`), else a matching `.srt` beside
the video, else none. Clean: strip bracketed non-speech (`[DOOR SLAMS]`), speaker labels
(`JERRY:`), HTML and italics; merge cues split mid-sentence. **Discard subtitle timings
entirely** — they're tied to a specific release and unreliable. Keep ordered text only.

**d. Align.** `whisper-cli` with word timestamps and full JSON output. Where subtitle text
exists, correct ASR word text when timing overlaps within 120 ms and edit distance ≤ 2 —
this fixes proper nouns, which whisper mangles constantly. Keep whisper's timings
regardless. Cache JSON by file hash; never redo it.

**e. Segment.** Candidates: every unigram and every contiguous n-gram n ∈ [2,8] within one
whisper segment. Reject if:
- min word probability < 0.65
- < 60 ms low-energy margin before start or after end (RMS in 10 ms frames; low = under
  20% of span mean)
- unigram < 90 ms or > 2.0 s
- internal silence run > 600 ms
- spectral flatness above threshold (music sting, not speech)

**Sitcom-specific:** detect laugh-track onset — a broadband energy burst typically
150–300 ms after a line ends — and treat it as a hard right boundary. Laughs contaminating
clip tails is the most common failure mode on this material.

`quality` = weighted blend of mean word probability, boundary margin, inverse spectral
flatness, clamped 0..1. Keep the best 3 per phraseKey.

**f. Cut.** From the 48 kHz master. Snap to nearest zero crossing within ±5 ms. **10 ms
fade in, 12 ms fade out — non-negotiable**; without it every splice clicks and nothing
downstream can fix it. Normalise **per source, not per clip**, toward −18 LUFS,
deliberately leaving ±3 dB of variance between sources — flattening everything destroys
the different-station illusion the product depends on. Trim edge silence to ≤ 40 ms.

**g. Persist.** Rows, files, `IngestProgress` at every stage.

Build a CLI harness — `npm run ingest -- <file>` — so this is testable headlessly.

### M3 — Audio engine — the highest-value work in the project

```
clip buffer -> BiquadFilter(bandpass, 1150 Hz, Q jittered 0.6–1.1) -> gain -> master
fx / static -> gain ------------------------------------------------------> master
bed (loop)  -> gain (-38 dBFS) -------------------------------------------> master
master -> DynamicsCompressor (soft limiter) -> destination
```

**The bandpass is not optional and not a user setting.** Without it you have a playlist of
unrelated recordings. With it you have one damaged speaker. It is the single thing that
makes the concept work.

Build the entire timeline against `ctx.currentTime` before any sound starts.
**Never use `setTimeout` for audio.**

```ts
let t = ctx.currentTime + 0.15;
for (const seg of segments) {
  seg.audioStart = t;
  scheduleSegment(seg, t);
  t += seg.dur;
  const gap = gapFor(seg, next);
  if (gap > 0) { scheduleStatic(t, gap); t += gap; }
  seg.audioEnd = t;
}
```

| Transition | Gap |
|---|---|
| same `sourceId` | 0.04 s crossfade |
| different `sourceId`, mid-clause | 0.09 s static burst |
| different `sourceId`, at punctuation | 0.18 s static + sweep |
| `unmatched` | 0.25 s static squawk |

Continuous noise bed for the utterance duration. 5%-per-splice chance of a 40–80 ms
amplitude dropout for wear.

**All randomness seeded** — Q jitter, dropouts, gap micro-variation all draw from one
seeded PRNG, so the same seed reproduces the same audio exactly. Export depends on this.

Barge-in ramps master gain to zero over 30 ms before stopping sources; a hard stop clicks.
Decoded buffers LRU-cached, default ceiling 120 MB.

### M4 — Matcher

Turn a string into `Segment[]`. **Viterbi DP, not greedy** — greedy produces ransom-note
prosody and the project lives or dies on this sounding good.

`best[i]` = min cost to cover words `0..i`, spans up to 8 words back:

```
cost = SPLICE_PENALTY(1.0)
     + SOURCE_SWITCH_PENALTY(0.6)   if previous clip has a different sourceId
     + BOUNDARY_BONUS(-0.5)          if switching at a comma or full stop
     + REPEAT_PENALTY(0.4)           if this clip already used in this utterance
     - log(clip.quality)
```

The boundary bonus is what separates this from a soundboard: switching station at a clause
boundary reads as expressive, switching mid-phrase reads as a bug.

Batch all candidate keys into **one** `corpus.lookup()` call — never one call per span.

Fallback ladder: shorter phrase → single word → strip plural/`-ing`/`-ed` and retry →
emit `unmatched`. **Never silently drop a word.**

### M5 — Terminal and free-speak

- Input at the bottom, transcript above. Black ground, amber text, one yellow accent.
  Restrained — a well-made 1975 car receiver, not a Halloween page.
- **Typing driven by `requestAnimationFrame` reading `ctx.currentTime`** against each
  segment's `audioStart`/`audioEnd`; characters reveal linearly across their clip's
  duration. Timer-driven typing drifts out of sync within two sentences.
- **Station tag**, dim, right-aligned, changing with the source:
  `▮ WJRY 88.1 · Seinfeld S04E11`. This is what makes a viewer *understand* what they're
  looking at. If short on time, cut something else.
- Hue shift at fragment boundaries so text seams mirror audio seams. `unmatched` words dim
  and glitched. Signal meter from an `AnalyserNode`. Selectable text, not canvas. Respect
  `prefers-reduced-motion`.
- **Free-speak toggle**: skip reply generation, match the user's literal text. Most
  shareable feature in the app, nearly free once the matcher exists.

**This is the first genuinely shippable build.** Stop and enjoy it before continuing.

### M6 — Batch ingest and embeddings

Queue across folders, recursive scan, skip by content hash, cancel mid-run without DB
corruption, resume after crash. Parallelism capped at `min(4, cores/2)` — whisper already
saturates the GPU and oversubscribing makes it slower.

Then embed distinct phrases via Ollama `nomic-embed-text`, batched, into `phrase_vec`.

### M7 — Reply generation

`reply.generate(input)`:

1. Candidate vocabulary: vector search over `phrase_vec` plus FTS5 keyword hits on the
   input. Cap around 400 phrases.
2. Prompt the chat model:
   > You are a machine whose voice processor is destroyed. You can only speak by splicing
   > fragments of recorded television and film dialogue. Every fragment of your reply must
   > come verbatim from the AVAILABLE PHRASES list. Do not invent, inflect, or alter a
   > phrase. Saying something approximate is correct and in character — reaching for a
   > phrase that almost fits is how you have always spoken. Emotional accuracy matters more
   > than literal accuracy. Prefer longer phrases over chains of single words. Reply with
   > JSON only: `{"fragments":[...],"gloss":"..."}`
3. Validate every fragment. On a miss, one repair round-trip naming the invalid ones. On
   second failure, fall back to local selection — top vector hits assembled into 2–4
   fragments.
4. **Never throw.** Model or network failure returns a valid degraded `ReplyResult`.
5. Persist to `utterances` when `saveTranscripts`. Store the seed so audio reproduces.

### M8 — Export, settings, library

Render through `OfflineAudioContext` using the **identical graph and stored seed** — same
bandpass, same Q jitter, same gaps. The export is therefore bit-identical to what played,
not a re-recording, and renders faster than realtime.

Encode to the configured format; `exportAudio.write()` applies the filename pattern and
writes to the export folder. Generate an `.srt` sidecar from segment timings and station
labels when `exportSrt` is on — you already have every number, so it's nearly free and
makes exports shareable.

Settings panel over `settings.get/set`. Library view: corpus stats, sources, history with
replay and re-export per row (fragments and seed are stored, so any past utterance
reproduces exactly without regenerating), clip browser with search, review panel over
`review.next/tag/reject` with keyboard shortcuts.

### M9 — Packaging

electron-builder, arm64 dmg, app icon, first-run experience verified from a clean
`userData`.

---

## 5. Out of scope

Windows or Linux. Auto-update. Telemetry. Any web server. Cloud APIs. Distributing the
corpus. Python.

## 6. Commit convention

Small, focused commits. Imperative mood, lowercase.

Example: `add viterbi matcher with source-switch penalty`

Never commit media: no `.mkv .mp4 .flac .wav .mp3 .opus` outside `resources/`.

## 7. Working with the reviewer

- Read `REVIEW.md` at the start of every session and address open findings before new work.
- Tag each milestone (`git tag m3`) when you finish it.
- Never edit `docs/` or `REVIEW.md`. If a finding is wrong, reply in your commit message
  explaining why rather than deleting it.
