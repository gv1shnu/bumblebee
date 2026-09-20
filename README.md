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

## How it's put together

Two loops and one boundary. Ingest turns your video files into a corpus of short clips;
the conversation loop turns your message into spliced speech. The renderer never touches
Node — everything crosses a single typed IPC bridge. See [docs/architecture.md](docs/architecture.md)
for the map, [docs/ingest.md](docs/ingest.md) for how clips are made, and
[docs/audio-design.md](docs/audio-design.md) for why the radio sounds the way it does.
