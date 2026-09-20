# Ingest

Ingest turns a video file into a set of short, clean dialogue clips. This stage decides
whether anything downstream sounds good — a clip with a click at the front or a laugh
bleeding into its tail can't be rescued later. The code is in `src/main/ingest.ts`, driven
from the app or from `npm run ingest -- <file>`.

## The stages

For each file:

1. **Probe** (`ffprobe`) — channel count and whether a subtitle stream exists. Both change
   what happens next.
2. **Extract audio** (`ffmpeg`) — if the track is 5.1, take the centre channel
   (`pan=mono|c0=FC`); it's almost pure dialogue and beats any separation model on this
   material. Otherwise downmix. Output is a 48 kHz FLAC master plus a 16 kHz WAV for whisper.
3. **Subtitles** — pull the embedded subtitle track, or a matching `.srt` beside the file.
   Strip bracketed noise (`[DOOR SLAMS]`), speaker labels, and markup; keep the text, discard
   the timings (they're tied to a specific release and unreliable).
4. **Transcribe** (`whisper-cli`) — word-level timestamps, full JSON. The result is cached by
   the file's content hash, so re-ingesting never transcribes twice.
5. **Segment** — build candidate phrases and reject the bad ones (below).
6. **Cut** (`ffmpeg`) — slice each surviving phrase from the master with fades and per-source
   normalisation.
7. **Persist** — write the source row, clip rows, and clip files; emit progress at every
   stage.

## Why clips get rejected

A phrase has to be clean to be useful. Candidates are every word and every 2–8 word run
inside a whisper segment, and one is dropped when:

- the least confident word scores under 0.65 (whisper isn't sure what was said),
- a single word is shorter than 90 ms or longer than 2 seconds (a fragment or a run-on), or
- there's an internal silence longer than 600 ms (two phrases with a gap, not one phrase).

The best three candidates per normalised phrase are kept, ranked by a quality score blended
from word confidence and duration.

## Cutting

Two things at cut time matter more than they look:

- **Fades: 10 ms in, 12 ms out.** Without them every splice clicks, and nothing downstream
  can undo it. This is the most commonly forgotten line in the whole project.
- **Normalise per source, not per clip.** Each source is levelled toward roughly −18 LUFS
  but deliberately left with a few dB of variance between sources. Flattening every source to
  the same loudness would erase the different-station feel the whole app is built on.

Edge silence is trimmed to at most 40 ms.

## Tuning the thresholds

The confidence floor (0.65), duration bounds, and silence limit are the dials worth turning
if ingest is too strict or too loose for your library. Raise the confidence floor and you get
fewer, cleaner clips; lower it and you get more coverage but more mush. They live inline in
`candidates()` in `src/main/ingest.ts`.

## Known gaps

A few things the design calls for aren't in yet, tracked in `REVIEW.md`/`AUDIT.md`:
zero-crossing snap at cut time, the low-energy boundary-margin and spectral-flatness
rejection rules, laugh-track onset detection, and correcting ASR text against the subtitles.
Fades and per-source normalisation — the two that most affect the sound — are in place.
