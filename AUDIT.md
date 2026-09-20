# Audit — 2026-09-19

Reviewed against design intent. Tree is flat (`src/renderer/audio.ts`, `src/main/ingest.ts`
…), not the `src/**/audio/` layout the brief assumes; mapped accordingly. I could not
*listen* — no corpus/media present and the app was not built/run — so click/laugh-bleed
verdicts are code-based only.

## Verdict
The hard core is right: bandpass, one seeded PRNG, genuine Viterbi DP, sample-accurate
`ctx.currentTime` scheduling, and 10/12 ms cut-time fades are all present and unconditional —
it will sound like one damaged radio, not a soundboard. But audio export is absent entirely,
two of five rejection rules and zero-crossing snap are missing, and the clause-boundary
audio behaviour is dead code, so it does not yet fully deliver the spec.

## Blockers
None. The five make-or-break intents (bandpass, fades, per-source loudness, Viterbi,
sample-accurate scheduling) are all present.

## Major
- **audio.ts:11 + matcher.ts:9** — clause-boundary gap behaviour is dead. The engine keys
  the 0.18 s static+sweep on `/[,.!?;:]$/.test(s.text)`, but the matcher strips all
  punctuation from `words` (line 9) so `s.text` never ends in punctuation. Punctuation gaps
  never fire; every source switch gets the 0.09 s mid-clause static regardless of boundary.
  Source switches are not audibly differentiated at clause boundaries as specified.
- **ingest.ts:22** — rejection rules are a subset: word-prob<0.65, unigram 90 ms–2.0 s, and
  internal-silence>600 ms are present; the <60 ms boundary-margin rule and the spectral-flatness
  rule are missing.
- **ingest.ts (candidates)** — no laugh-track onset detection; laughter is never treated as a
  hard right boundary. Only subtitle `(laughter)` *text* is stripped (cleanSubtitles), which
  does not bound the audio.
- **ingest.ts:42** — fades present (`afade` 10/12 ms) but no zero-crossing snapping at cut
  time; a specified de-click mechanism is silently absent.

## Minor
- **ingest.ts:40,42** — loudness runs single-pass `loudnorm` *per clip* toward a per-source
  target (`sourceGain` ∈ ±3 dB from source hash). Cross-source ±3 dB variance (the intent) is
  preserved, but clip-to-clip dynamics within a source are flattened and single-pass loudnorm
  on sub-2 s clips is imprecise.
- **App.tsx:8** — whisper model sizes shown before pull; the Ollama chat model shows no size.
- **db.ts:23 / ingest.ts:41** — `clips.phones` column is never populated or read; no phonetic
  fallback. `phraseKey` fallback ladder (shorter→word→strip -s/-ed/-ing→unmatched) is what
  actually runs, and it is correct.
- **matcher.ts:5** — `stem` regex `(?:ing|ed|s)$` over-stems short words ("this"→"thi"); harmless
  (junk keys just miss) but pollutes the lookup set.
- **db.ts:30-32** — `clips_fts` has INSERT/DELETE triggers but no UPDATE trigger; safe only
  while `clips.phrase` is never updated.

## Not built
- **Audio export — absent.** `grep OfflineAudioContext` → none. `export.ts` contains only
  `encodeWav` (an AudioBuffer→WAV encoder); nothing renders an utterance, no seed pass-through,
  no SRT-from-timeline, and there is no export control anywhere in `App.tsx`. The `exportWrite`
  IPC handler and the `exportAudio.write` bridge exist but are never called. The brief's
  "reuse the live graph in OfflineAudioContext" MAJOR is unevaluable because no export path
  exists at all.
- **Subtitle text — computed then discarded.** `ingest.ts:37` cleans subtitles to
  `work/subtitles.txt`, but nothing reads that file; clips derive solely from whisper ASR.
  Subtitle *text* is not actually used.
- **Semantic/vector search — scaffolded, dead.** `phrase_vec` table and the sqlite-vec loader
  exist, but no embedding is ever generated or queried. Lookup is exact `phraseKey`; reply
  retrieval is FTS bm25.
- **`BUILD.md` — not committed.** The spec every check verifies against is not in the repo;
  numeric intents were taken from this audit brief instead.

## Vision check
1. **One damaged radio or a soundboard?** One radio. Every clip passes an unconditional
   ~1150 Hz bandpass with per-clip Q jitter from a single seeded PRNG, over a continuous pink-noise
   bed through a shared limiter — unrelated recordings are unified. Splices carry baked 10/12 ms
   fades. (Code-based; not heard.)
2. **Switches audible and visible, landing at clause boundaries?** Visible yes — the station tag
   updates per playing clip (`App.tsx:10`). Audible yes — cross-source switches insert static.
   But *not at clause boundaries*: the punctuation branch is dead (see Major), so boundary and
   mid-clause switches sound identical.
3. **Free-speak?** Yes, works. The FREE-SPEAK toggle feeds typed text straight through
   `matchText`→`engine.play` with a locally-minted seed, bypassing Ollama. The most shareable
   path is intact.
4. **Quiet network dependency at runtime?** No. Reply uses local Ollama; ASR/LLM are local
   CLIs. Network access is confined to explicit, user-triggered model pulls
   (`setup.ts` huggingface/`ollama pull`). The "NO NETWORK" claim holds.
5. **Specified but never built?** Audio export (entirely), subtitle-text usage, laugh-track
   boundary detection, spectral-flatness and boundary-margin rejection, zero-crossing snap,
   and semantic vector search. See Not built / Major.
