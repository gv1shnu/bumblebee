# Bumblebee Radio

A macOS app that can't speak in its own voice. You type a message; it answers by splicing
together fragments of dialogue from your own films and television — the way Bumblebee talks
through his radio after his voice box is destroyed. A terminal types the reply in sync with
the audio and names the station each fragment came from.

Half the point is that it's approximate. It reaches for the nearest phrase it has, stitches
the borrowed voices together with tuning static, and runs the whole thing through one
band-limited filter so a dozen unrelated recordings sound like a single damaged speaker.

## What it needs

Everything runs locally. Nothing leaves the machine except model downloads you ask for.

- macOS on Apple silicon (arm64)
- [`ffmpeg`](https://ffmpeg.org) (with `ffprobe`) — audio extraction and cutting
- [`whisper-cli`](https://github.com/ggml-org/whisper.cpp) — transcription (`brew install whisper-cpp`)
- [`ollama`](https://ollama.com) — reply generation, plus `nomic-embed-text` for search
- A whisper model and a chat model — the app recommends and installs the right ones for
  your RAM on first run

The corpus is built entirely from your own local media. It is never bundled with the app
and never distributed.

## Build and run

```bash
npm install
npm run dev      # develop against a live Electron window
npm run build    # type-check and bundle main, preload, renderer
npm test         # unit tests
npm run dist     # package an arm64 .dmg
```

First launch opens **Setup**: it checks for the three binaries, recommends models for your
Mac, and lets you point the receiver at a folder of media. Once a clip or two exists, the
**Radio** screen is where you talk to it.

## How it works

Two loops and one boundary. The renderer never touches Node — everything crosses a single
typed IPC bridge (`src/shared/ipc.ts`).

**Ingest** turns your video and audio files into a corpus of short clips. It pulls out the
dialogue (the centre channel on 5.1, a downmix otherwise), then gets the text: if a file
already ships an English subtitle it reads the cues and skips transcription, otherwise it
runs `whisper-cli`. Clean phrases are cut from a 48 kHz master with 10/12 ms fades and
normalised per source — deliberately leaving a few dB of variance between sources.

**Conversation** turns your message into speech. A cost-based matcher (Viterbi, not greedy)
covers the text with the clips it has, and the audio engine splices them with tuning static
and gaps. Every clip passes through one ~1150 Hz band-pass filter — that single line is
what makes a dozen unrelated recordings sound like one damaged speaker instead of a
playlist, so it is never optional. All randomness is seeded, so the same reply reproduces
the same audio exactly.

The corpus lives in SQLite at `app.getPath('userData')`, with clip audio on disk beside it.
