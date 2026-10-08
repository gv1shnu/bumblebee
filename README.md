# Bumblebee

A macOS app that can't speak in its own voice. You type a message; it answers by splicing
together fragments of dialogue from your own films and television — the way Bumblebee talks
through his radio after his voice box is destroyed. A terminal types the reply in sync with
the audio and names the station each fragment came from.

Half the point is that it's approximate. It reaches for the nearest phrase it has, stitches
the borrowed voices together with tuning static, and runs the whole thing through one
band-limited filter so a dozen unrelated recordings sound like a single damaged speaker.

## Demo

<!--
  Demo video goes here. To embed it on GitHub:
  1. Record a 30–60s screen capture (see the shot list below), export MP4, H.264, ≤ ~10 MB.
  2. On github.com, edit this file (or open a throwaway issue) and drag the MP4 into the
     text box. GitHub uploads it and inserts a URL like
     https://github.com/gv1shnu/bumblebee/assets/<id>.
  3. Paste that URL on its own line, right below this comment. GitHub renders an inline
     player from a bare asset URL — no <video> tag or markdown needed.
  Shot list: Setup (green checks, installed models) → pick a folder → Tune the library
  (progress) → Radio: type a line, hear the spliced reply while the terminal types in sync
  and the station tag changes → flip Free-speak and speak a literal line.
-->

_Demo video coming soon._

## Install

Download `Bumblebee-<version>-arm64.pkg` from the
[latest release](https://github.com/gv1shnu/bumblebee/releases/latest) and open it. It needs a
Mac with Apple silicon and nothing else: Ollama, ffmpeg, whisper and the on-device Speech helper
are all inside the app.

While it installs, the installer looks at your Mac's chip and memory and downloads the models
that suit it: a reply model, `nomic-embed-text` for search, and a whisper speech model. On an
8 GB Mac that's about 3.3 GB, and the installer sits on "Running package scripts" for a few
minutes while it downloads. If a download can't finish (say you're offline), the install still
completes and **Setup** in the app offers the same downloads. The installer's log is at
`~/Library/Logs/Bumblebee/install.log`.

The installer isn't signed with an Apple Developer ID yet, so macOS will refuse to open it the
first time. Go to **System Settings → Privacy & Security**, scroll down to the message about
Bumblebee, and click **Open Anyway**.

### How the reply model is chosen

The pick works like [llmfit](https://github.com/AlexsJones/llmfit): the model has to fit in the
memory the GPU can use and run at a usable speed on your chip, and the best model that does
wins. Bigger Macs get bigger models, from `qwen3:4b-instruct` on an 8 GB Mac up to
`qwen3:235b-instruct` on a 256 GB Mac Studio. Only instruct models are on the list: reasoning
models spend minutes thinking before a reply that needs about twenty tokens. The app uses an
Ollama that's already running if there is one, otherwise it starts its own; models are kept in
the standard `~/.ollama` folder either way.

Everything runs locally. Nothing leaves the machine except those model downloads. The corpus
is built entirely from your own local media. It is never bundled with the app and never
distributed.

## Build and run

```bash
npm install
npm run dev      # develop against a live Electron window
npm run build    # type-check and bundle main, preload, renderer
npm test         # unit tests
npm run vendor   # build the bundled tools into vendor/ (cached; first run takes a few minutes)
npm run dist     # vendor + build, then package an arm64 .pkg installer
```

`npm run vendor` downloads a pinned, checksum-verified Ollama and builds ffmpeg (LGPL, audio
only), whisper-cli (Metal) and the Speech helper from source. It needs the Xcode command-line
tools; cmake is set up privately if it isn't installed. In dev the app uses `vendor/` when it
exists, and falls back to tools on your `PATH` when it doesn't.

First launch opens **Setup**: it shows your Mac, the installed models, and lets you point the
receiver at a folder of media. Once a clip or two exists, the **Radio** screen is where you
talk to it.

## How it works

Two loops and one boundary. The renderer never touches Node — everything crosses a single
typed IPC bridge (`src/shared/ipc.ts`).

**Ingest** turns your video and audio files into a corpus of short clips. It pulls out the
dialogue (the centre channel on 5.1, a downmix otherwise), then gets the text: if a file
already ships an English subtitle it reads the cues and skips transcription, otherwise it
runs `whisper-cli` with automatic language detection. When whisper covers little of a file —
common with non-English audio — the same clip is handed to macOS's on-device Speech
recogniser as a second pass, and any phrases whisper missed are added to the corpus. Clean
phrases are cut from a 48 kHz master with 10/12 ms fades and normalised per source —
deliberately leaving a few dB of variance between sources. Distinct phrases are embedded
with `nomic-embed-text` so replies can reach for them by meaning, not just keywords.

**Conversation** turns your message into speech. A cost-based matcher (Viterbi, not greedy)
covers the text with the clips it has, and the audio engine splices them with tuning static
and gaps. Every clip passes through one ~1150 Hz band-pass filter — that single line is
what makes a dozen unrelated recordings sound like one damaged speaker instead of a
playlist, so it is never optional. All randomness is seeded, so the same reply reproduces
the same audio exactly — which is also how **Export** works: it re-renders a finished reply
offline to a WAV with a matching SRT of the spoken fragments.

The chat and embedding models are warmed into memory at startup so the first reply isn't
slowed by a cold load. The corpus lives in SQLite at `app.getPath('userData')`, with clip
audio on disk beside it.

## License

[MIT](LICENSE) © Vishnu Gandarapu. The code is MIT-licensed; the dialogue corpus is built
from your own local media, stays on your machine, and is never part of this project.

The app bundles third-party tools under their own licenses, each shipped next to it in
`Bumblebee.app/Contents/Resources`: [Ollama](https://github.com/ollama/ollama) (MIT),
[whisper.cpp](https://github.com/ggml-org/whisper.cpp) (MIT) and
[FFmpeg](https://ffmpeg.org) (LGPL 2.1 or later). FFmpeg is the unmodified 9.0.2 release from
<https://ffmpeg.org/releases/>, built as a separate program with the configuration in
[`scripts/vendor.mjs`](scripts/vendor.mjs).
