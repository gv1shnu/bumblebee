# User guide

## Before you start

Bumblebee Radio leans on three command-line tools. Install them once:

```bash
brew install ffmpeg whisper-cpp ollama
```

Then start Ollama and pull a chat model (the app can also do this for you in Setup):

```bash
ollama pull llama3.1:8b
```

macOS launches apps with a minimal `PATH`, so the app also looks in `/opt/homebrew/bin`. If
a tool shows as "not found" in Setup but works in your terminal, that mismatch is usually
why — reinstalling through Homebrew fixes it.

## First run — Setup

Setup is the calibration screen. It shows:

- **Your machine** — chip, memory, cores. Memory decides which models are recommended.
- **Binary checks** — green when `ffmpeg`, `whisper-cli`, and `ollama` are found.
- **Recommended models** — a speech model and a reply model sized to your RAM. "Pull model"
  downloads and selects it; sizes are shown first because the largest speech model is
  several gigabytes.
- **Essentials** — reply mode, reply model, context length, how long the model stays in
  memory, and the Bumblebee persona. These have sensible defaults, but they're here so you
  can set them deliberately before anything runs.
- **Media library** — the folder to scan.

"Tune the library" stays disabled until the tools and the chosen speech model are actually
present, so ingest never starts against something that isn't there. When it's ready, pick a
folder and go.

## Adding media

Point Setup at a folder of films or TV you own. It scans recursively for `.mkv`, `.mp4`,
`.mov`, `.m4v`, `.avi`, and `.webm`, and works through each file: pull out the dialogue,
transcribe it, and cut clean phrases into clips. Progress shows the stage and file.

Only the folder you choose is scanned — never your whole disk. Re-running skips files it has
already ingested (matched by content hash), so you can add to the library over time.

A note on the speech model: `large-v3` is the most accurate and the slowest. On a long film
it can take a while. If ingest feels slow, switch to `small.en` or `medium.en` in Setup —
they're much faster and usually good enough for this material.

## Talking to it — Radio

Type a message and transmit. The app assembles a reply from clips it has, plays it through
the radio, and types it out in sync. The station plate names the source of whatever is
speaking, and the tuner needle swings between stations as the voice changes.

**Free-speak** (the toggle by the input) skips reply generation and speaks your literal
text back in borrowed voices. It's the most direct way to hear what the corpus can do.

## Settings

Everything from Setup's Essentials also lives under **Library → Settings**, alongside the
model names, transcript saving, and the persona toggle. Changes take effect on the next
reply.

- **Reply mode** — `LLM` uses Ollama to choose fragments; `local` skips the model and picks
  the strongest matches directly.
- **Context length** — `0` lets the app size the model's context window to your RAM. Larger
  windows use more memory.
- **Keep model loaded** — minutes the chat model stays resident between replies. Higher is
  faster to respond; lower frees memory sooner.
- **Persona** — the Bumblebee character prompt that runs before every reply.

## Library

The Library view holds corpus stats, your sources, saved conversation history, and a review
panel for approving or rejecting individual clips. Saved replies store their fragments and
random seed, so a past utterance can be reproduced exactly.
