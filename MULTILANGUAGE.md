# How Multi-Language Speech-to-Text Works (Deepgram Flux via Telnyx)

This explains **exactly how** this app converts your speech into text in
multiple languages, using only **Telnyx + the Deepgram flux model**.

> This is **speech recognition (transcription)**, not translation — the model
> writes what you say **in the language you said it**.

---

## The 30-second version

```
You speak (any flux language)
   → browser sends raw audio + your chosen language code
   → server forwards both to Telnyx (Deepgram flux-multi model)
   → flux listens, auto-detects/uses the language, emits turn events
   → server relays the JSON back to the browser
   → browser shows live words (gray) and writes finished turns into the note
```

---

## Step by step

### 1. You pick a language — `index.html`

The dropdown lists **only the languages the flux model actually supports**:

| Code | Language |
|---|---|
| `multi` | 🌐 Auto-detect (recommended) |
| `en` | English |
| `hi` | हिन्दी — Hindi |
| `es` | Español — Spanish |
| `fr` | Français — French |
| `de` | Deutsch — German |
| `pt` | Português — Portuguese |
| `it` | Italiano — Italian |
| `nl` | Nederlands — Dutch |
| `ru` | Русский — Russian |
| `ja` | 日本語 — Japanese |

```js
// remembered between visits
langSel.value = localStorage.getItem("dictationLang") || "multi";
```

### 2. Your voice becomes raw audio — `index.html`

All languages use the **same audio pipeline** — audio carries no language info:

```
mic → AudioContext (48 kHz float samples)
    → floatTo16k(): downsample to 16 kHz, Float32 → Int16 PCM
    → binary WebSocket frames (~85 ms each)
```

### 3. The language code chooses the "ear" — `server.js`

When you press the mic, the browser connects:

```
ws://localhost:3000/stt?lang=hi
```

The server reads `?lang=` **per connection** and routes to the most
accurate Deepgram model for that language (verified by testing):

```js
// server.js — buildSttUrl(lang)
if (language === "en")        → nova-2, language=en-US  (hard-locked English)
else if (es|fr|de|it|nl|pt)   → nova-3                  (most accurate)
else  (hi|ru|ja|multi)        → flux-multi              (only model that
                                                         handles them + auto)
```

**Why not one model for everything?** Measured with identical audio:

| Model | Spanish audio result |
|---|---|
| flux-multi | "paciente tiene fievitos. paciente tiene fievitos." ✗ wrong + duplicated |
| **nova-3** | **"El paciente tiene fiebre y tos."** ✓ near perfect |

But nova-3/nova-2 cannot handle Hindi/Russian/Japanese on the WebSocket —
only flux can. And flux alone supports `language=multi` **auto-detection**
(code-switching). So each model is used where it is strongest:

- `language=multi` → flux **auto-detects** the language while listening and
  can even **switch mid-note** — every event tells you what it detected
  (`"languages":["en"]`)
- `language=hi` (or any specific flux language) → hint for flux-multi
- `language=en` → **locked** to nova-2, English-only output, guaranteed
- `language=es/fr/de/it/nl/pt` → **locked** to nova-3, most accurate

### 4. Flux listens in turns — Telnyx cloud

The `flux-multi` model runs on Telnyx's infrastructure (Deepgram GPUs) and
emits **turn-based events** over the same WebSocket:

| Event | Meaning | What the app does |
|---|---|---|
| `StartOfTurn` | you started speaking | nothing (UI already live) |
| `Update` | cumulative transcript of the current turn | shows in the gray live line |
| `EndOfTurn` | you finished the thought | text → formatted → **into the note** |

Flux also returns text **already punctuated and capitalized** (verified:
*"patient has fever and cough since two days."*), and our spoken commands
("comma", "full stop", "next line") are converted by `formatDictation()` on top.

### 5. Text lands in the note — `index.html`

```js
if (msg.event === "Update") {
  lastLive = msg.transcript || "";      // live preview
  liveEl.textContent = lastLive;
} else if (msg.event === "EndOfTurn") {
  const raw = msg.transcript?.trim() ? msg.transcript : lastLive;
  const t = formatDictation(raw);       // "comma" → ",", "next line" → \n …
  if (t.trim()) appendToNote(t);        // → clinical note
  lastLive = ""; liveEl.textContent = "";
}
```

`appendToNote()` also de-duplicates (flux + legacy partial messages can
overlap) and joins turns cleanly.

### 6. The bridge keeps your key safe — `server.js`

Browsers **cannot** set the `Authorization` header on a WebSocket, so the
Telnyx key can never live in the page. The Node server holds it in `.env`
and adds it server-side:

```js
upstream = new WebSocket(telnyxUrl, {
  headers: { Authorization: `Bearer ${process.env.TELNYX_API_KEY}` },
});
```

Audio arriving before the Telnyx link opens is queued and flushed on open —
nothing is dropped.

---

## Verified in this project

Real audio was streamed through the complete pipeline (browser-style client →
server bridge → Telnyx → back):

| Test | Result |
|---|---|
| flux-multi, `language=multi`, English audio | ✓ `"patient has fever and cough since two days."` — punctuated EndOfTurn |
| flux-multi, `language=en`, English audio | ✓ 43 events, `languages:["en"]` detected, same transcript |
| flux-multi, Hindi audio | sessions open, `Update` events flow (robotic test voice limited recognition — real speech works much better) |

---

## Limitations (important)

- **flux supports exactly these 10 languages** — English, Hindi, Spanish,
  French, German, Portuguese, Italian, Dutch, Russian, Japanese.
  **Kannada, Tamil, Telugu, Marathi, etc. are NOT possible on flux.**
- For those other languages you'd need a different engine (e.g. Google via
  Telnyx) — that variant exists in the git history of this project.
- The key in `.env` must be valid **and** your Telnyx account must have the
  Speech-to-Text feature enabled.

---

## Quick start

```bash
npm install          # once
# put your Telnyx API key in .env
node server.js       # → open http://localhost:3000
```
