# Clinical Note — Live Speech-to-Text (Telnyx · Deepgram Flux)

A minimal web app that turns your speech into a clinical note **live**.
You talk into the microphone, the audio streams through a tiny Node server to
**Telnyx's Speech-to-Text WebSocket API running the Deepgram Flux model**, and
the transcript is written directly into a blank clinical note — with spoken
punctuation commands.

- **Model:** Deepgram **`flux-multi`** — lowest latency, built-in end-of-turn
  detection, **automatic language detection** across 10 languages:
  English, Hindi, Spanish, French, German, Portuguese, Japanese, Italian,
  Russian, Dutch.

---

## Features

- **Live transcription** — text appears as you speak (no record/stop/upload)
- **Language dropdown** — Auto-detect + the 10 flux languages (English, Hindi, Spanish, French, German, Portuguese, Italian, Dutch, Russian, Japanese)
- **Blank clinical note** — one clean textarea, filled only by your dictation
- **Voice punctuation commands** — say "comma", "full stop", "next line"…
- **Auto-capitalization** — after sentence ends and line breaks
- **Interim preview** — the current turn shows in gray before it's finalized
- **Download note** — save as `.txt`
- **API key stays private** — the browser never sees your Telnyx key

> Full multi-language explanation: see **[MULTILANGUAGE.md](MULTILANGUAGE.md)**

---

## Project structure

```
GITCommit/
├── index.html   → the web page (mic button, blank note, flux parsing, formatting)
├── server.js    → Node server (only dependency: ws)
│                   • serves the page
│                   • proxies WebSocket /stt  ⇄  Telnyx STT WebSocket (Deepgram flux)
├── .env         → Telnyx API key + model name
└── package.json → npm project file (ws dependency)
```

---

## Requirements

- [Node.js](https://nodejs.org) v18+ (tested on v20)
- A [Telnyx](https://telnyx.com) account with an **API key**
- Chrome / Edge / Firefox (microphone access)

---

## Setup

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Add your Telnyx API key** to the `.env` file:
   ```
   TELNYX_API_KEY=your_key_here
   STT_MODEL=flux-multi        # or "flux" for English-only
   ```

3. **Start the server**
   ```bash
   node server.js
   ```

4. **Open the app** → [http://localhost:3000](http://localhost:3000)

---

## How to use

1. Click the **red mic button** — the status changes to *Listening…*
2. Speak your clinical summary — text streams live into the note
3. Press the **■ button** to stop
4. Use **Clear Note** to empty it, or **Download Note (.txt)** to save it

---

## Voice commands

| You say | You get |
|---|---|
| "full stop" / "period" | `.` |
| "comma" | `,` |
| "next line" / "new line" | line break |
| "new paragraph" | blank line |
| "question mark" | `?` |
| "exclamation mark" | `!` |
| "colon" | `:` |
| "semicolon" | `;` |
| "hyphen" | `-` |

Commands work anywhere in the sentence, and the next word is automatically
capitalized.

**Example** — saying:

> "patient has chest pain full stop he takes aspirin comma metformin
> next line no allergies question mark"

produces:

```
Patient has chest pain. He takes aspirin, metformin
No allergies?
```

---

## How it works

```
Browser                        Node server                     Telnyx
───────                        ───────────                     ──────
getUserMedia (mic)
   │
AudioContext → PCM16 @16kHz
   │  (binary frames)
   ├────────── ws://…/stt ───────────► wss://api.telnyx.com/
   │                                   v2/speech-to-text/transcription
   │                                   ?transcription_engine=Deepgram
   │                                   &model=flux-multi
   ◄───────── JSON events ────────────┤
   │
flux events → formatDictation() → clinical note
```

### Implementation details

**1. Audio capture — `index.html`**
- `getUserMedia` → `AudioContext` → `ScriptProcessor` (4096 samples, ~85 ms)
- `floatTo16k()` downsamples to 16 kHz and converts Float32 → Int16 PCM
- binary frames stream to the server; recording starts only after the
  server replies `{type:"ready"}` so nothing is lost

**2. WebSocket bridge — `server.js`**
- Browsers cannot set the `Authorization` header on WebSockets, so the key
  would be exposed in the page — the bridge keeps it in `.env`
- Relays binary audio ⇄ JSON events frame-by-frame
- Audio arriving before the Telnyx link opens is queued and flushed on open
- Closing one side closes the other

**3. Flux event handling — `index.html`**
Flux emits turn-based events (not `{transcript, is_final}`):
- `StartOfTurn` — user began speaking (ignored)
- `Update` — cumulative transcript of the current turn → gray live line
- `EndOfTurn` — turn complete → `formatDictation()` → appended to the note

**4. Dictation formatter — `formatDictation()`**
- Ordered regex pipeline: line-break commands first, then punctuation,
  then cleanup, then capitalization
- Trims spaces but **never newlines**, so "next line" said at the end of a
  sentence survives
- `appendToNote()` joins turns with a space, or honors leading line breaks

---

## Supported languages & accuracy routing

The dropdown offers **Auto-detect** plus 10 languages. The server picks the
most accurate Deepgram model per language (verified by testing):

| You select | Model | Why |
|---|---|---|
| English | `nova-2` (en-US) | Hard-locked English — cannot output Hindi script |
| Spanish, French, German, Italian, Dutch, Portuguese | `nova-3` | Most accurate: *"El paciente tiene fiebre y tos."* — near perfect |
| Hindi, Russian, Japanese, 🌐 Auto-detect | `flux-multi` | Only model that handles them / code-switching |

> Deep explanation: **[MULTILANGUAGE.md](MULTILANGUAGE.md)**

---

## Troubleshooting

| Problem | Fix |
|---|---|
| "Microphone access denied" | Allow mic in browser; use `localhost` or HTTPS |
| Nothing appears while speaking | Check the mic is not muted; speak continuously until a turn completes |
| `EADDRINUSE: port 3000` | Stop the old server: `fuser -k 3000/tcp`, then `node server.js` |
| "TELNYX_API_KEY is not set" | Put your key in `.env` and restart the server |
| Telnyx auth error (10009) | API key is wrong/revoked |
| Telnyx feature error (10038) | Enable the **AI / Speech-to-Text** feature in the Telnyx portal |
| Flux error 40006 | Audio format not supported by flux — this app already sends linear16, which works |

---

## Notes

- Audio never leaves your machine except to Telnyx for transcription.
- This is a **testing/demo** tool — not a certified medical records system.
- For production, serve over HTTPS (browsers require it for mic access on
  non-localhost domains) and add authentication.
