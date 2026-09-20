# Audio design

This is the part of the app that makes a pile of unrelated clips sound like one voice. If a
future change breaks the character of the sound, it almost certainly touched something here.

## The graph

Every reply is built as a Web Audio graph in `src/renderer/audio.ts`, scheduled ahead of
time and then played. Per clip:

```
clip buffer → BiquadFilter(bandpass, 1150 Hz, Q 0.6–1.1) → gain → master
static / sweep → gain ─────────────────────────────────→ master
bed (looped, ~ -38 dBFS) ──────────────────────────────→ master
master → DynamicsCompressor (soft limiter) → destination
```

### The bandpass is not optional

Each clip passes through a band-pass filter centred around 1150 Hz. This is the single most
important line in the audio path. Different films, different mics, different decades — run
them all through the same narrow band and they stop sounding like a playlist and start
sounding like one damaged speaker on a table. It is never exposed as a setting and never
bypassed. Remove it and the illusion is gone.

The filter's Q is jittered slightly per clip so the tone wavers, which reads as a struggling
receiver rather than a clean effect.

## Timing

The whole timeline is laid out against `ctx.currentTime` before the first sound plays —
never with `setTimeout`. Timers drift against the audio clock, and within a couple of
sentences the terminal typing would fall out of sync with the voice. So the engine walks the
segments, assigns each an absolute start time, and schedules everything up front.

## Gaps between fragments

The silence between clips carries as much character as the clips. What fills it depends on
whether the voice is changing station and whether we're at a clause boundary:

| Transition | Gap |
|---|---|
| Same source | 0.04 s overlap (the baked-in fades cross) |
| Different source, mid-clause | 0.09 s static burst |
| Different source, at punctuation | 0.18 s static + a tuning sweep |
| Unmatched word | 0.25 s static squawk |

Switching station at a comma or full stop reads as expressive; switching mid-word reads as a
bug. A continuous low noise bed runs underneath the whole utterance so the silence is never
truly silent, and there's a small per-splice chance of a brief amplitude dropout for wear.

## Seeding

All the randomness — the Q jitter, the dropouts, the micro-variation in gap length — is
driven by one seeded PRNG (`mulberry32`). Given the same seed, the same reply produces the
same audio down to the sample. That reproducibility is why replies store their seed: it's
what lets a past utterance be replayed, and what an offline export would need to match what
was heard.

## Stopping

New input interrupts whatever is playing. Rather than cutting sources dead — which clicks —
the engine ramps the master gain to zero over about 30 ms first, then stops the sources.
Decoded audio buffers are held in an LRU cache (120 MB ceiling) so repeated clips don't
decode twice.

## Known rough edge

The punctuation branch of the gap table keys off trailing punctuation in a segment's text,
but the matcher strips punctuation out before segments are built — so the clause-boundary
gap doesn't currently fire, and switches sound the same at boundaries as mid-clause. It's
recorded in `REVIEW.md`; fixing it means carrying a boundary flag through from the matcher.
