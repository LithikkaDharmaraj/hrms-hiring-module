import type { TTSProvider } from "./types";

export class OpenAITTS implements TTSProvider {
  name = "openai";
  contentType = "audio/mpeg";

  async synthesize(text: string): Promise<Buffer> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY not configured");
    const baseUrl = "https://api.openai.com";
    if (!text || !text.trim()) throw new Error("Empty text for TTS");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    try {
      const res = await fetch(`${baseUrl}/v1/audio/speech`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini-tts",
          input: text.trim(),
          voice: "alloy",
          response_format: "mp3",
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        throw new Error(`OpenAI TTS error: ${res.status} ${errBody.substring(0, 200)}`);
      }
      return Buffer.from(await res.arrayBuffer());
    } finally {
      clearTimeout(timeout);
    }
  }
}
