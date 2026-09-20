# REVIEW.md

Reviewer log. Append-only, newest checkpoint on top. Severity: **BLOCKER** (product
does not work as designed), **MAJOR** (a stated non-negotiable violated or a design
intent silently lost), MINOR (correctness/maintenance).

## First-run gap — 2026-09-20

- [x] **MAJOR** App.tsx Setup — Setup pulls the recommended models but never persists
      `whisperModel`/`chatModel`; only `mediaFolders` is saved. So an essential setting is
      unset before first ingest: `settings.whisperModel` stays `''`, ingest falls back to
      `base.en` ([ingest.ts:39](src/main/ingest.ts:39)), and on any tier above base the user
      pulled a different model → `whisper-cli` can't find the ggml file → ingest fails on a
      clean install. Fixed: Setup now selects the recommended model on pull and persists
      model choice (set-if-empty) alongside `mediaFolders` when starting ingest.
- [x] **MINOR** App.tsx Setup — "Tune the library" now gated on ffmpeg + whisper-cli present
      *and* the chosen whisper model installed, with an inline reason when blocked; Setup
      re-detects after a pull completes so the gate opens without a manual reload.
- [x] Essentials surfaced in first-run Setup (reply mode, reply model, context length,
      keep-alive, persona) so they're explicit choices before ingest, not silent defaults.

## Feature work (handoff) — 2026-09-19

Requested features, built additively (nothing existing removed; amber/chrome design and the
voice's deliberate unevenness preserved). Build/typecheck/tests green; **not** run in the GUI
(no display, no corpus), so runtime look/animation unverified.

- Bumblebee character pre-prompt (`reply.ts` `PERSONA`), on by default, toggle in Settings.
- Host-aware context/memory: `contextLength` (0=auto by RAM) + `keepAlive` in Settings;
  `MachineInfo.recommendedContext` from RAM tier (`setup.ts`).
- Animated Bumblebee face (`DeviceRadio.tsx` `BumblebeeFace`) in the tuner, driven by the
  existing AnalyserNode level; per-bar mouth variance keeps the motion uneven; reduced-motion
  respected.
- Restrained glow polish + settings-input styling in `device-overrides.css`.
- Chat model standardised to `llama3.1:8b` for all RAM tiers (fallback + recommendation);
  `llama3.2:3b` dropped. Caveat: 8b is heavy for <8 GB Macs — whisper stays RAM-tiered.

- [ ] **MAJOR (accepted deviation, flag for human)** reply.ts — generation now calls the local
      Ollama **HTTP API** (`127.0.0.1:11434`) to pass `num_ctx`/`keep_alive`, with CLI
      `ollama run` fallback. BUILD.md §1 frames Ollama as a spawned CLI; §M7 does anticipate
      "network failure" degradation, and loopback is still local (no egress). Called out so the
      human can confirm the approach before it hardens.

Open findings from Ground truth (M2 rules, M3 punctuation-gap defect, M6 embeddings/parallelism,
M7 vector half, M8 export) are **unchanged** — not addressed by this feature pass.

## Ground truth (handoff) — 2026-09-19

Executed, not trusted. Tags are fiction: `m0`–`m4` point at commit `4015550`, `m5`–`m9` at
`d2c64b8` — milestones were never tagged at real completion points, so they carry no
information. `BUILD.md` is now committed (`d2c64b8`) and read in full.

**2. Build & run.** `node_modules` present (Node v26). `tsc --noEmit` clean. `vitest run`
4/4 pass. `npm run build` (electron-vite) exit 0. Did **not** launch `npm run dev` — it's a
GUI Electron app needing a display + native rebuild; runtime behaviour is therefore
**not** verified, only static + build.

**3. Corpus.** NONE. No `~/Library/Application Support/bumblebee-radio` (or `Bumblebee
Radio`) dir, no `corpus.db`, no `clips/`. App has never run/ingested. No media file was
provided to me, so **M2–M8 cannot be evaluated by ear or integration test** — downstream
review below is static analysis only.

**4. Deps vs §1.** Runtime deps are exactly the sanctioned set (better-sqlite3, sqlite-vec,
zustand, react, react-dom). No Tone.js, no Python — clean. Extra devDeps:
`@fontsource/barlow-condensed`, `@fontsource/jetbrains-mono` (bundled local fonts, benign,
not in §1's template), `tsx` (justified — powers the §M2 `npm run ingest` harness). Fonts
non-blocking; noted only.

**1. Milestones — claimed (all tagged) vs actual:**

| M | Actual | Notes |
|---|---|---|
| M0 | **Complete** | schema/indexes/FTS5/sqlite-vec-degrade/preload Bridge/3 routes/settings defaults present |
| M1 | **Complete** | detect + `/opt/homebrew/bin` probe, RAM recommend, pulls, fx-on-first-run, wizard UI (minor: no size shown for Ollama model) |
| M2 | **Partial** | runs end-to-end; MISSING: ASR↔subtitle text correction (§d), zero-crossing snap (§f), 2 of 5 rejection rules (60 ms low-energy margin, spectral flatness), laugh-track onset boundary, spectral term in `quality`. Present: fades 10/12 ms, per-source norm, centre-channel, timing-discard, JSON cache |
| M3 | **Substantial + defect** | bandpass/`ctx.currentTime`/seeded PRNG/bed/dropouts/barge-in/LRU all present. DEFECT: punctuation gap branch (0.18 static+sweep) never fires — matcher strips punctuation from `segment.text`, so clause-boundary differentiation is dead |
| M4 | **Complete** | genuine Viterbi DP, all 4 cost terms, one batched lookup, stem fallback, no dropped words |
| M5 | **Complete** | `DeviceRadio` mounted: rAF on `ctx.currentTime`, station/frequency tag, hue shift, unmatched dim, AnalyserNode meter, selectable text, reduced-motion, free-speak. NOTE: old `Radio` in App.tsx is dead code |
| M6 | **Partial** | batch scan/skip-by-hash/cancel/resume present. ABSENT: parallelism cap `min(4,cores/2)` (ingest is sequential); embeddings via `nomic-embed-text` (phrase_vec never populated, `embed` stage never emitted) |
| M7 | **Mostly complete** | prompt/validate/one-repair/fallback/never-throw/seed-persist present. Vocabulary is FTS-only — vector search absent (blocked on M6 embeddings) |
| M8 | **Largely absent** | export via `OfflineAudioContext` ABSENT (only `encodeWav` util; no render, no UI, IPC handler never called); SRT-from-timeline absent. Settings panel present; Library has stats/sources/history/review but no per-row replay/re-export, no clip browser/search, no review keyboard shortcuts |
| M9 | **Config only** | electron-builder mac arm64 dmg + icon configured; not built from clean userData here |

Headline: the hard audio/matcher core (M3/M4/M5) is real and largely correct; the gaps are
M2 ingest quality rules, M6 embeddings + parallelism, M7 vector half, and all of M8 export.
Phase 1 will open a numbered finding per gap before any fix.

## m0 — 2026-09-19

Reviewed the working tree at HEAD as de-facto m0 (all tags m0–m9 exist; reviewed the
named m0 files plus two cheap grep-first spot checks for m2/m3).

Named m0 checks — all pass:
- Preload isolation ✓ `main/index.ts:27` — `contextIsolation:true, nodeIntegration:false, sandbox:true`, preload set.
- `Bridge`↔`shared/ipc.ts` parity ✓ — `preload/index.ts` implements every group exactly, no extra methods.
- Single `phraseKey` normaliser ✓ — one exported fn in `shared/normalize.ts`; all sites import it (`main/ingest.ts`, `renderer/matcher.ts`). No duplicated normalisation logic.
- Indexes present ✓ `main/db.ts:28-29` — `idx_clips_phraseKey`, `idx_clips_sourceId`; FTS5 `clips_fts` present.
- sqlite-vec degrades ✓ `main/db.ts:37-41` — `loadExtension` in try/catch, warns and continues.
- No media committed ✓.

Open findings:

- [ ] **MAJOR** repo — `BUILD.md` is not tracked in the repo. It is the spec every
      checkpoint verifies against (schema §M0, gap table §M3, rejection rules, cost
      terms). Without it, spec-conformance checks are unverifiable — I can only confirm
      the code is internally coherent, not that it matches intent. Implementer: commit
      the brief.
- [ ] MINOR db.ts:30-32 — `clips_fts` external-content FTS has INSERT/DELETE triggers
      but no UPDATE trigger. Safe only while `clips.phrase` is never `UPDATE`d; will
      silently desync the index if that ever changes. Add a `clips_au` trigger or note
      the invariant.
- [ ] MINOR package.json — new runtime deps for the human to confirm: `zustand`,
      `react`/`react-dom` (renderer UI), `better-sqlite3`, `sqlite-vec`.

Spot checks (not full checkpoints — deferred to their own sessions):
- m2 `main/ingest.ts:42` — fades ARE applied at cut time (`afade t=in d=.01`, `t=out
  d=.012` = 10/12 ms), the single most common omission. Good. Still to verify at m2:
  normalisation per-source vs per-clip (`loudnorm` is inside the per-clip cut — needs
  the `sourceGain` derivation checked), zero-crossing snap (only ±40 ms pad + silenceremove
  seen), the five rejection rules, laugh-track/centre-channel branches, ASR cache.
- m3 — audio path (`renderer/audio.ts` `RadioEngine`, `renderer/App.tsx`) has no
  `setTimeout`/`setInterval` and no `Math.random` in the scheduling path; the one
  `Math.random` (`App.tsx:10`) only mints a free-speak seed, which is then the
  reproducible driver — acceptable. Still to verify at m3: bandpass on clip path,
  single seeded PRNG for jitter/dropouts/gaps, gap table, barge-in gain ramp.
