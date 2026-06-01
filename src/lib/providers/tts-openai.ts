import type { TTSProvider } from "./types";

export class OpenAITTS implements TTSProvider {
  name = "openai";
  contentType = "audio/mpeg";

  async synthesize(text: string): Promise<Buffer> {
    // Fallback to the general AI API key if a specific OpenAI key isn't provided
    const apiKey = process.env.OPENAI_API_KEY || process.env.AI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY or AI_API_KEY not configured for TTS");
    }

    const model = process.env.OPENAI_TTS_MODEL || "tts-1"; // or tts-1-hd for higher quality
    const voice = process.env.OPENAI_TTS_VOICE || "nova"; // options: alloy, echo, fable, onyx, nova, shimmer

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      const res = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          input: text,
          voice,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`OpenAI TTS error: ${res.status} - ${errorText}`);
      }

      const arrayBuffer = await res.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } finally {
      clearTimeout(timeout);
    }
  }
}