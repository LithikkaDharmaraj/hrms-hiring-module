import http from "http";
import { WebSocket, WebSocketServer } from "ws";
import { parse } from "url";
import { Pool } from "pg";
import app from "./app";

const PORT = parseInt(process.env.PORT || "8000", 10);

const dbPool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://postgres@localhost:5432/ai_interview_platform",
  max: 3,
});

function getSTTConfig() {
  const provider = process.env.STT_PROVIDER || "soniox";
  const language = process.env.STT_LANGUAGE || "en-IN";

  if (provider === "soniox") {
    const k = process.env.SONIOX_API_KEY || "";
    return {
      provider: "soniox",
      wsUrl: "wss://stt-rt.soniox.com/transcribe-websocket",
      initConfig: {
        api_key: k,
        model: "stt-rt-v4",
        audio_format: "auto",
        num_channels: 1,
        language_hints: [language.split("-")[0]],
        language_hints_strict: false,
        enable_endpoint_detection: true,
        max_endpoint_delay_ms: 3000,
      },
    };
  }
  if (provider === "sarvam") {
    const k = process.env.SARVAM_API_KEY || "";
    return {
      provider: "sarvam",
      wsUrl: `wss://api.sarvam.ai/speech-to-text-streaming/transcribe/ws?api_subscription_key=${k}&language_code=${language}&model=saaras:v3`,
      headers: { "Api-Subscription-Key": k },
    };
  }
  const k = process.env.DEEPGRAM_API_KEY || "";
  return {
    provider: "deepgram",
    wsUrl: `wss://api.deepgram.com/v1/listen?model=nova-3&language=${language}&punctuate=true&interim_results=true&endpointing=800&vad_events=true&diarize=true&utterance_end_ms=4000`,
    protocols: ["token", k],
  };
}

function createSonioxNormalizer() {
  let utteranceText = "";

  return function normalize(raw: string | Buffer): string[] {
    try {
      const msg = JSON.parse(typeof raw === "string" ? raw : raw.toString());
      if (msg.error_code) {
        console.error(`[STT-WS:soniox] Error ${msg.error_code}: ${msg.error_message}`);
        return [];
      }
      if (!msg.tokens || msg.tokens.length === 0) return [];

      const results: string[] = [];
      const realTokens = msg.tokens.filter((t: any) => !t.text.startsWith("<"));
      const hasEnd = msg.tokens.some((t: any) => t.text === "<end>");
      const fullText = realTokens.map((t: any) => t.text).join("").trim();

      if (hasEnd) {
        const finalText = (utteranceText + " " + fullText).trim() || fullText;
        if (finalText) {
          results.push(JSON.stringify({
            type: "Results", is_final: true, speech_final: true,
            channel: { alternatives: [{ transcript: finalText, confidence: 0.95 }] },
          }));
        }
        results.push(JSON.stringify({ type: "UtteranceEnd" }));
        utteranceText = "";
      } else if (fullText) {
        utteranceText = fullText;
        results.push(JSON.stringify({
          type: "Results", is_final: false, speech_final: false,
          channel: { alternatives: [{ transcript: fullText, confidence: 0.8 }] },
        }));
      }
      return results;
    } catch (e) {
      console.error("[STT-WS:soniox] Parse error:", (e as Error).message);
      return [];
    }
  };
}

function addWSProxy(server: http.Server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", async (req, socket, head) => {
    const { pathname, query } = parse(req.url || "", true);
    if (pathname !== "/api/stt-ws") return;

    if (!query.token) { socket.write("HTTP/1.1 401\r\n\r\n"); socket.destroy(); return; }
    try {
      const { rows } = await dbPool.query(
        "SELECT id FROM interviews WHERE token=$1 AND status IN ('in_progress','waiting')",
        [query.token]
      );
      if (!rows.length) { socket.write("HTTP/1.1 403\r\n\r\n"); socket.destroy(); return; }
    } catch { socket.write("HTTP/1.1 500\r\n\r\n"); socket.destroy(); return; }

    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws));
  });

  wss.on("connection", (clientWs) => {
    const cfg = getSTTConfig() as any;
    console.log(`[STT-WS] Proxying to ${cfg.provider}`);

    let upstream: WebSocket;
    try {
      if (cfg.protocols) {
        upstream = new WebSocket(cfg.wsUrl, cfg.protocols);
      } else if (cfg.headers) {
        upstream = new WebSocket(cfg.wsUrl, { headers: cfg.headers });
      } else {
        upstream = new WebSocket(cfg.wsUrl);
      }
    } catch { clientWs.close(1011, "STT error"); return; }

    upstream.on("unexpected-response", (_: any, r: any) => {
      let b = ""; r.on("data", (c: any) => b += c);
      r.on("end", () => { console.error(`[STT-WS] Rejected: ${r.statusCode}`); clientWs.close(1011); });
    });

    const buf: { data: any; isBinary: boolean }[] = [];
    let ready = false;

    upstream.on("open", () => {
      ready = true;
      console.log(`[STT-WS] Connected to ${cfg.provider}`);
      if (cfg.initConfig) {
        upstream.send(JSON.stringify(cfg.initConfig));
        console.log(`[STT-WS:soniox] Sent init config (model=${cfg.initConfig.model}, lang=${cfg.initConfig.language_hints})`);
      }
      if (buf.length) { buf.forEach(c => upstream.send(c.isBinary ? c.data : c.data.toString())); buf.length = 0; }
    });

    clientWs.on("message", (d: any, isBinary: boolean) => {
      if (ready && upstream.readyState === WebSocket.OPEN) {
        if (isBinary) {
          upstream.send(d);
        } else {
          const text = d.toString();
          if (cfg.provider === "soniox") {
            try {
              const parsed = JSON.parse(text);
              if (parsed.type === "KeepAlive") {
                upstream.send(JSON.stringify({ type: "keepalive" }));
              } else if (parsed.type === "CloseStream") {
                upstream.send("");
              } else {
                upstream.send(text);
              }
            } catch { upstream.send(text); }
          } else {
            upstream.send(text);
          }
        }
      } else if (buf.length < 20) {
        buf.push({ data: d, isBinary });
      }
    });

    const sonioxNormalize = cfg.provider === "soniox" ? createSonioxNormalizer() : null;

    upstream.on("message", (d: any, bin: boolean) => {
      if (clientWs.readyState !== WebSocket.OPEN) return;
      if (sonioxNormalize) {
        const rawStr = typeof d === "string" ? d : d.toString();
        const messages = sonioxNormalize(rawStr);
        for (const m of messages) clientWs.send(m);
      } else {
        clientWs.send(bin ? d : d.toString());
      }
    });

    const ping = setInterval(() => {
      if (clientWs.readyState === WebSocket.OPEN) clientWs.ping();
      if (upstream?.readyState === WebSocket.OPEN) {
        upstream.ping();
        if (cfg.provider === "deepgram") upstream.send(JSON.stringify({ type: "KeepAlive" }));
        if (cfg.provider === "soniox") upstream.send(JSON.stringify({ type: "keepalive" }));
      }
    }, 5000);

    const cleanup = () => { clearInterval(ping); };
    clientWs.on("close", () => { cleanup(); if (upstream.readyState <= 1) upstream.terminate(); });
    upstream.on("close", () => { cleanup(); if (clientWs.readyState === WebSocket.OPEN) clientWs.close(); });
    clientWs.on("error", (e: Error) => console.error("[STT-WS]", e.message));
    upstream.on("error", (e: Error) => { cleanup(); console.error("[STT-WS]", e.message); if (clientWs.readyState === WebSocket.OPEN) clientWs.close(1011); });
  });

  console.log(`> STT WebSocket proxy active on /api/stt-ws (${getSTTConfig().provider})`);
}

const server = http.createServer(app);
addWSProxy(server);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`> Backend API ready on http://0.0.0.0:${PORT}`);
});

const shutdown = () => {
  (wssRef as any)?.clients?.forEach((ws: WebSocket) => ws.close(1001));
  server.close(() => { dbPool.end(); process.exit(0); });
  setTimeout(() => process.exit(1), 5000);
};
const wssRef = null;
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

export default server;
