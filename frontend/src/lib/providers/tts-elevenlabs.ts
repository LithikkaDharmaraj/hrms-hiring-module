import type { TTSProvider } from "./types";
import { promisify } from "util";
import { execFile } from "child_process";
import { readFile, unlink } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";
import os from "os";

const execFileAsync = promisify(execFile);

async function synthesizeEdgeFallback(text: string): Promise<Buffer> {
  const voice = process.env.EDGE_TTS_VOICE || "en-IN-NeerjaNeural";
  const rate = process.env.EDGE_TTS_RATE || "+10%";
  const tmpFile = join(os.tmpdir(), `edge-tts-${randomUUID()}.mp3`);
  try {
    await execFileAsync("edge-tts", [
      "--voice", voice,
      "--rate", rate,
      "--pitch=-6Hz",
      "--text", text,
      "--write-media", tmpFile,
    ], { timeout: 15000 });
    return await readFile(tmpFile);
  } finally {
    unlink(tmpFile).catch(() => {});
  }
}

export class ElevenLabsTTS implements TTSProvider {
  name = "elevenlabs";
  contentType = "audio/mpeg";

  async synthesize(text: string): Promise<Buffer> {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      console.warn("[TTS] ELEVENLABS_API_KEY not set, using Edge TTS fallback");
      return synthesizeEdgeFallback(text);
    }
    if (!text || !text.trim()) throw new Error("Empty text for TTS");

    const voiceId = process.env.ELEVENLABS_VOICE_ID || "JBFqnCBsd6RMkjVDRZzb";
    const modelId = process.env.ELEVENLABS_MODEL_ID || "eleven_turbo_v2_5";

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text: text.trim(),
          model_id: modelId,
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            style: 0.0,
            use_speaker_boost: true,
          },
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        console.warn(`[TTS] ElevenLabs failed (${res.status}): ${errBody.substring(0, 200)} — falling back to Edge TTS`);
        return synthesizeEdgeFallback(text);
      }
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      console.warn("[TTS] ElevenLabs error, falling back to Edge TTS:", err);
      return synthesizeEdgeFallback(text);
    } finally {
      clearTimeout(timeout);
    }
  }
}
