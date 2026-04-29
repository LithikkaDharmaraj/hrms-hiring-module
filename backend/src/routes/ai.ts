import { Router, Request, Response } from "express";
import { rateLimit } from "../lib/rate-limit";
import { getInterview, addTranscriptEntry, getProctoringViolationCount, updateInterview, addProctoringEvent } from "../lib/store";
import { getAIResponse, stripThinking, buildInterviewPrompt, generateScorecard } from "../lib/ai";
import { getTTSProvider, getSTTConfig } from "../lib/providers";
import { validateInterviewAccessPost } from "../middleware/auth";
import { pool } from "../lib/db";
import { startScoring, completeScoring, failScoring } from "../lib/scoring-tracker";
import { normalizeScorecard } from "../lib/normalize-scorecard";
import { parseScorecardJSON } from "../lib/parse-scorecard";

const router = Router();

function cleanForTTS(text: string): string {
  return text
    .replace(/[*#_~`|<>{}[\]\\]/g, "")
    .replace(/\bhttps?:\/\/\S+/g, "")
    .replace(/\b[\w.-]+@[\w.-]+\.\w+/g, "")
    .replace(/(\d+)-(\w+)/g, "$1 $2")
    .replace(/(\w+)-(\w+)/g, "$1 $2")
    .replace(/[()]/g, "")
    .replace(/[/:;]/g, " ")
    .replace(/\.\.\./g, ".")
    .replace(/—|–/g, ", ")
    .replace(/\n+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// POST /api/ai-response
router.post("/ai-response", async (req: Request, res: Response) => {
  try {
    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
    if (!rateLimit(ip, 30, 60000)) return res.status(429).json({ error: "Too many requests" });

    const { interviewId, transcript, token } = req.body;
    if (!interviewId) return res.status(400).json({ error: "Missing interviewId" });
    if (!(await validateInterviewAccessPost(req, interviewId, token))) return res.status(403).json({ error: "Invalid interview" });

    const interview = await getInterview(interviewId);
    if (!interview) return res.status(404).json({ error: "Interview not found" });

    const MAX_STRIKES = parseInt(process.env.MAX_PROCTORING_STRIKES || "25");
    const violations = await getProctoringViolationCount(interviewId);
    if (violations >= MAX_STRIKES) {
      await updateInterview(interviewId, { status: "completed", endedAt: new Date().toISOString() });
      return res.status(403).json({ error: "Interview terminated due to proctoring violations" });
    }

    const { rows: hbRows } = await pool.query("SELECT last_heartbeat_at FROM interviews WHERE id = $1", [interviewId]);
    if (hbRows.length > 0 && hbRows[0].last_heartbeat_at) {
      const elapsed = Date.now() - new Date(hbRows[0].last_heartbeat_at).getTime();
      if (elapsed > 45000) {
        addProctoringEvent(interviewId, {
          type: "heartbeat_missing", severity: "flag",
          message: `No proctoring heartbeat for ${Math.round(elapsed / 1000)}s`,
          timestamp: new Date().toISOString(),
        }).catch(() => {});
      }
    }

    if (transcript?.length > 0) {
      const lastEntry = transcript[transcript.length - 1];
      if (lastEntry.role === "candidate" && lastEntry.text) {
        await addTranscriptEntry(interviewId, {
          role: "candidate", text: lastEntry.text, timestamp: new Date().toISOString(),
        });
      }
    }

    const aiRaw = await getAIResponse(interview, transcript ?? interview.transcript);
    const hasEndSignal = aiRaw.includes("[END_INTERVIEW]");
    const aiResponse = aiRaw.replace(/\[END_INTERVIEW\]/g, "").trim();

    await addTranscriptEntry(interviewId, { role: "ai", text: aiResponse, timestamp: new Date().toISOString() });
    if (hasEndSignal) await updateInterview(interviewId, { status: "completed", endedAt: new Date().toISOString() });

    return res.json({ text: aiResponse, endInterview: hasEndSignal });
  } catch (err) {
    console.error("AI response error:", err);
    return res.status(500).json({ error: "Failed to get AI response" });
  }
});

// POST /api/ai-speak
router.post("/ai-speak", async (req: Request, res: Response) => {
  try {
    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
    if (!rateLimit(ip, 30, 60000)) return res.status(429).json({ error: "Too many requests" });

    const { interviewId, transcript, token, skipSave } = req.body;
    if (!interviewId) return res.status(400).json({ error: "Missing interviewId" });
    if (!(await validateInterviewAccessPost(req, interviewId, token))) return res.status(403).json({ error: "Invalid interview" });

    const [interview, violations, hbResult] = await Promise.all([
      getInterview(interviewId),
      getProctoringViolationCount(interviewId),
      pool.query("SELECT last_heartbeat_at FROM interviews WHERE id = $1", [interviewId]),
    ]);

    if (!interview) return res.status(404).json({ error: "Interview not found" });

    const MAX_STRIKES = parseInt(process.env.MAX_PROCTORING_STRIKES || "25");
    if (violations >= MAX_STRIKES) {
      await updateInterview(interviewId, { status: "completed", endedAt: new Date().toISOString() });
      return res.status(403).json({ error: "Interview terminated due to proctoring violations" });
    }

    const hbRows = hbResult.rows;
    if (hbRows.length > 0 && hbRows[0].last_heartbeat_at) {
      const elapsed = Date.now() - new Date(hbRows[0].last_heartbeat_at).getTime();
      if (elapsed > 45000) {
        addProctoringEvent(interviewId, {
          type: "heartbeat_missing", severity: "flag",
          message: `No proctoring heartbeat for ${Math.round(elapsed / 1000)}s`,
          timestamp: new Date().toISOString(),
        }).catch(() => {});
      }
    }

    if (!skipSave && transcript?.length > 0) {
      const lastEntry = transcript[transcript.length - 1];
      if (lastEntry.role === "candidate" && lastEntry.text) {
        addTranscriptEntry(interviewId, {
          role: "candidate", text: lastEntry.text, timestamp: new Date().toISOString(),
        }).catch(() => {});
      }
    }

    const aiRaw = await getAIResponse(interview, transcript ?? interview.transcript);
    const hasEndSignal = aiRaw.includes("[END_INTERVIEW]");
    const aiText = aiRaw.replace(/\[END_INTERVIEW\]/g, "").trim();
    const cleanedText = stripThinking(aiText);
    const ttsText = cleanForTTS(cleanedText);

    try {
      const ttsProvider = getTTSProvider();
      const [audioBuffer] = await Promise.all([
        ttsProvider.synthesize(ttsText || cleanedText),
        addTranscriptEntry(interviewId, { role: "ai", text: aiText, timestamp: new Date().toISOString() }),
      ]);
      const audioBase64 = audioBuffer.toString("base64");
      if (hasEndSignal) await updateInterview(interviewId, { status: "completed", endedAt: new Date().toISOString() });
      return res.json({ audio: audioBase64, text: aiText, contentType: ttsProvider.contentType, endInterview: hasEndSignal });
    } catch (err) {
      console.warn("TTS failed:", (err as Error).message);
      return res.json({ text: aiText, audio: null, contentType: null });
    }
  } catch (err) {
    console.error("AI speak error:", err);
    return res.status(500).json({ error: "Failed" });
  }
});

// POST /api/ai-speak-stream (SSE)
router.post("/ai-speak-stream", async (req: Request, res: Response) => {
  try {
    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
    if (!rateLimit(ip, 30, 60000)) return res.status(429).json({ error: "Too many requests" });

    const { interviewId, transcript, token, skipSave } = req.body;
    if (!interviewId) return res.status(400).json({ error: "Missing interviewId" });
    if (!(await validateInterviewAccessPost(req, interviewId, token))) return res.status(403).json({ error: "Unauthorized" });

    const [interview, violations, hbResult] = await Promise.all([
      getInterview(interviewId),
      getProctoringViolationCount(interviewId),
      pool.query("SELECT last_heartbeat_at FROM interviews WHERE id = $1", [interviewId]),
    ]);

    if (!interview) return res.status(404).json({ error: "Not found" });

    const MAX_STRIKES = parseInt(process.env.MAX_PROCTORING_STRIKES || "25");
    if (violations >= MAX_STRIKES) {
      return res.status(403).json({ error: "Interview terminated" });
    }

    const hbRows = hbResult.rows;
    if (hbRows.length > 0 && hbRows[0].last_heartbeat_at) {
      const elapsed = Date.now() - new Date(hbRows[0].last_heartbeat_at).getTime();
      if (elapsed > 45000) {
        addProctoringEvent(interviewId, {
          type: "heartbeat_missing", severity: "flag",
          message: `No heartbeat for ${Math.round(elapsed / 1000)}s`,
          timestamp: new Date().toISOString(),
        }).catch(() => {});
      }
    }

    if (!skipSave && transcript?.length > 0) {
      const lastEntry = transcript[transcript.length - 1];
      if (lastEntry.role === "candidate" && lastEntry.text) {
        addTranscriptEntry(interviewId, {
          role: "candidate", text: lastEntry.text, timestamp: new Date().toISOString(),
        }).catch(() => {});
      }
    }

    const aiMessages = buildInterviewPrompt(interview, transcript || interview.transcript);

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const ttsProvider = getTTSProvider();
    const startTime = Date.now();

    const makeAICall = async (attempt: number) => {
      const abort = new AbortController();
      const timeout = setTimeout(() => abort.abort(), 35000);
      console.log(`[Stream] AI call attempt ${attempt} for ${interviewId}`);
      try {
        const r = await fetch(`${process.env.AI_BASE_URL}/v1/chat/completions`, {
          method: "POST",
          headers: { Authorization: `Bearer ${process.env.AI_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: process.env.AI_MODEL || "gpt-4o",
            messages: aiMessages,
            max_tokens: 500,
            temperature: 0.3,
            stream: true,
            ...((process.env.AI_MODEL || "").includes("minimax") ? { thinking: { type: "disabled" } } : {}),
          }),
          signal: abort.signal,
        });
        clearTimeout(timeout);
        return r;
      } catch (err) {
        clearTimeout(timeout);
        throw err;
      }
    };

    try {
      let aiRes: Response;
      try { aiRes = await makeAICall(1) as any; }
      catch { aiRes = await makeAICall(2) as any; }

      if (!(aiRes as any).ok || !(aiRes as any).body) {
        res.write(`data: ${JSON.stringify({ error: "AI failed" })}\n\n`);
        return res.end();
      }

      const reader = (aiRes as any).body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullText = "";
      let sentenceIdx = 0;
      const ttsPromises: Promise<void>[] = [];

      const processSentence = (sentence: string) => {
        const cleaned = stripThinking(sentence).replace(/\[END_INTERVIEW\]/g, "").trim();
        if (!cleaned) return;
        const idx = sentenceIdx++;
        res.write(`data: ${JSON.stringify({ type: "text", text: cleaned, idx })}\n\n`);
        const ttsText = cleanForTTS(cleaned);
        if (!ttsText) return;
        const p = ttsProvider.synthesize(ttsText).then((audioBuffer) => {
          const audioBase64 = audioBuffer.toString("base64");
          res.write(`data: ${JSON.stringify({ type: "audio", audio: audioBase64, contentType: ttsProvider.contentType, idx })}\n\n`);
        }).catch((err: any) => {
          console.warn(`[Stream] TTS failed for sentence ${idx}:`, err.message);
          res.write(`data: ${JSON.stringify({ type: "audio_skip", idx })}\n\n`);
        });
        ttsPromises.push(p);
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split("\n")) {
          if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
          try {
            const json = JSON.parse(line.slice(6));
            const delta = json.choices?.[0]?.delta || {};
            const tok = delta.content || "";
            if (!tok) continue;
            buffer += tok;
            fullText += tok;
            const sentenceMatch = buffer.match(/[.!?]\s/);
            if (sentenceMatch) {
              const idx = sentenceMatch.index! + 1;
              const sentence = buffer.slice(0, idx).trim();
              buffer = buffer.slice(idx);
              if (sentence) processSentence(sentence);
            }
          } catch {}
        }
      }

      if (buffer.trim()) processSentence(buffer.trim());

      console.log(`[Stream] AI done for ${interviewId} in ${Date.now() - startTime}ms (${sentenceIdx} sentences)`);
      await Promise.all(ttsPromises);
      console.log(`[Stream] TTS done for ${interviewId} in ${Date.now() - startTime}ms total`);

      const hasEndSignal = fullText.includes("[END_INTERVIEW]");
      const cleanedFull = stripThinking(fullText).replace(/\[END_INTERVIEW\]/g, "").trim();

      if (cleanedFull) {
        await addTranscriptEntry(interviewId, { role: "ai", text: cleanedFull, timestamp: new Date().toISOString() });
      }

      if (hasEndSignal) {
        console.log(`[Stream] AI ended interview ${interviewId}`);
        await updateInterview(interviewId, { status: "completed", endedAt: new Date().toISOString() });
        setTimeout(async () => {
          try {
            const freshInterview = await getInterview(interviewId);
            if (freshInterview && freshInterview.transcript.length > 0 && !freshInterview.scorecard) {
              if (await startScoring(interviewId)) {
                const raw = await generateScorecard(freshInterview);
                let parsed;
                try { parsed = parseScorecardJSON(raw); } catch (parseErr) {
                  console.error(`[Stream] Scorecard parse failed for ${interviewId}:`, parseErr);
                }
                if (parsed) {
                  const scorecard = normalizeScorecard(parsed);
                  await updateInterview(interviewId, { scorecard });
                  await completeScoring(interviewId);
                  console.log(`[Stream] Scorecard generated for ${interviewId}`);
                } else {
                  await failScoring(interviewId, "Scorecard parse returned null");
                }
              }
            }
          } catch (err) {
            console.error(`[Stream] Scorecard failed for ${interviewId}:`, err);
            await failScoring(interviewId, (err as Error).message);
          }
        }, 3000);
      }

      res.write(`data: ${JSON.stringify({ type: "done", fullText: cleanedFull, endInterview: hasEndSignal })}\n\n`);
      res.end();
    } catch (err) {
      console.error("[Stream] Error:", err);
      if (!res.headersSent) return res.status(500).json({ error: "Stream failed" });
      res.write(`data: ${JSON.stringify({ error: "Stream failed" })}\n\n`);
      res.end();
    }
  } catch (err) {
    console.error("Stream error:", err);
    if (!res.headersSent) return res.status(500).json({ error: "Failed" });
    res.end();
  }
});

// POST /api/tts
router.post("/tts", async (req: Request, res: Response) => {
  try {
    const { text, interviewId, token } = req.body;
    if (interviewId && token) {
      if (!(await validateInterviewAccessPost(req, interviewId, token))) {
        return res.status(403).json({ error: "Unauthorized" });
      }
    }
    if (!text) return res.status(400).json({ error: "Missing text" });
    const cleanedText = stripThinking(text);
    const ttsProvider = getTTSProvider();
    const audioBuffer = await ttsProvider.synthesize(cleanedText);
    return res.json({ audio: audioBuffer.toString("base64"), contentType: ttsProvider.contentType });
  } catch (err) {
    console.error("TTS error:", err);
    return res.status(500).json({ error: "Failed to generate speech" });
  }
});

// GET /api/stt-proxy
router.get("/stt-proxy", async (req: Request, res: Response) => {
  try {
    const token = req.query.token as string;
    if (!token) return res.status(401).json({ error: "Unauthorized" });

    const { rows } = await pool.query(
      "SELECT id FROM interviews WHERE token = $1 AND status IN ('in_progress', 'waiting')",
      [token]
    );
    if (rows.length === 0) return res.status(403).json({ error: "Interview not active" });

    const config = getSTTConfig();
    return res.json({ provider: config.provider });
  } catch (err) {
    console.error("STT proxy error:", err);
    return res.status(500).json({ error: "Failed" });
  }
});

export default router;
