const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer, WebSocket } = require("ws");

for (const line of (() => {
  try { return fs.readFileSync(path.join(__dirname, ".env"), "utf8").split("\n"); }
  catch { return []; }
})()) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const PORT = process.env.PORT || 3000;

function buildSttUrl(lang) {
  const language = lang || process.env.STT_LANGUAGE || "multi";
  const base = "wss://api.telnyx.com/v2/speech-to-text/transcription";
  const tail = "&input_format=linear16&sample_rate=16000&interim_results=true";

  // Accuracy routing (verified by testing):
  // - "en"  -> nova-2: hard-locked English, cannot output Hindi script
  // - EU languages -> nova-3: most accurate (es/de/it near-perfect)
  // - flux can only HINT languages (code-switches anyway), but it is the
  //   only model that produces output for hi/ru/ja and auto-detect.
  if (language === "en") {
    return base + "?transcription_engine=Deepgram&model=nova-2&language=en-US" + tail;
  }
  if (["es", "fr", "de", "it", "nl", "pt"].includes(language)) {
    return base + "?transcription_engine=Deepgram&model=nova-3" +
      `&language=${encodeURIComponent(language)}` + tail;
  }
  return (
    base +
    "?transcription_engine=Deepgram" +
    `&model=${process.env.STT_MODEL || "flux-multi"}` +
    `&language=${encodeURIComponent(language)}` +
    tail
  );
}

function json(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    res.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" });
    fs.createReadStream(path.join(__dirname, "index.html")).pipe(res);
    return;
  }
  if (req.method === "GET" && req.url === "/health") {
    return json(res, 200, { ok: true, telnyxKey: !!process.env.TELNYX_API_KEY });
  }
  json(res, 404, { error: "Not found" });
});

const wss = new WebSocketServer({ server, path: "/stt" });

wss.on("connection", (client, req) => {
  if (!process.env.TELNYX_API_KEY) {
    client.close(1011, "TELNYX_API_KEY is not set");
    return;
  }

  let lang = null;
  let upstream;
  try {
    lang = new URL(req.url, "http://localhost").searchParams.get("lang");
    upstream = new WebSocket(buildSttUrl(lang), {
      headers: { Authorization: `Bearer ${process.env.TELNYX_API_KEY}` },
    });
  } catch (e) {
    client.close(1011, e.message);
    return;
  }
  console.log(`[stt] client connected (lang=${lang || "multi"})`);

  const pending = [];
  upstream.on("open", () => {
    client.send(JSON.stringify({ type: "ready", model: process.env.STT_MODEL || "flux-multi" }));
    while (pending.length && upstream.readyState === WebSocket.OPEN) {
      upstream.send(pending.shift());
    }
  });

  upstream.on("message", (data, isBinary) => {
    if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary });
  });

  upstream.on("error", (e) => {
    console.error("[stt] upstream error:", e.message);
    try { client.close(1011, e.message); } catch {}
  });
  upstream.on("close", (code, reason) => {
    console.log(`[stt] upstream closed: code=${code} reason=${reason.toString().slice(0, 100)}`);
    try { client.close(1000); } catch {}
  });

  client.on("message", (data, isBinary) => {
    if (upstream.readyState === WebSocket.OPEN) {
      upstream.send(data, { binary: isBinary });
    } else if (upstream.readyState === WebSocket.CONNECTING) {
      pending.push(isBinary ? Buffer.from(data) : Buffer.from(data.toString()));
    }
  });

  client.on("close", () => {
    if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) {
      try { upstream.close(); } catch {}
    }
  });
});

server.listen(PORT, () => {
  console.log(`Clinical note app running:  http://localhost:${PORT}`);
  console.log(`Model: ${process.env.STT_MODEL || "flux-multi"} | Telnyx key: ${process.env.TELNYX_API_KEY ? "loaded" : "MISSING"}`);
});
