import { Router, Request, Response } from "express";
import { sessionMiddleware, requireSession, requireAdmin } from "../middleware/auth";
import { pool } from "../lib/db";
import { getInterview } from "../lib/store";
import { sendSelectionEmail, sendRejectionEmail } from "../lib/email";
import { generateScorecard } from "../lib/ai";
import { normalizeScorecard } from "../lib/normalize-scorecard";
import { startScoring, completeScoring, failScoring } from "../lib/scoring-tracker";

const router = Router();

let lastStaleCheck = 0;

async function completeStaleInterviews() {
  const now = Date.now();
  if (now - lastStaleCheck < 30 * 60 * 1000) return;
  lastStaleCheck = now;

  try {
    const { rows } = await pool.query(`
      UPDATE interviews SET status = 'completed', ended_at = NOW()
      WHERE status = 'in_progress'
        AND started_at IS NOT NULL
        AND started_at + (duration || ' minutes')::interval < NOW()
      RETURNING id`);

    if (rows.length > 0) {
      console.log(`[Stale] Auto-completed ${rows.length} stale interview(s): ${rows.map((r: any) => r.id).join(", ")}`);
      for (const row of rows) {
        try {
          const interview = await getInterview(row.id);
          if (interview && interview.transcript.length > 0 && !interview.scorecard) {
            if (await startScoring(row.id)) {
              const raw = await generateScorecard(interview);
              let parsed;
              try { parsed = JSON.parse(raw); } catch {
                const match = raw.match(/\{[\s\S]*\}/);
                if (match) parsed = JSON.parse(match[0]);
              }
              if (parsed) {
                const scorecard = normalizeScorecard(parsed);
                await pool.query("UPDATE interviews SET scorecard = $1 WHERE id = $2", [JSON.stringify(scorecard), row.id]);
                completeScoring(row.id);
                console.log(`[Stale] Scorecard generated for ${row.id}`);
              }
            }
          }
        } catch (err) {
          console.error(`[Stale] Scorecard failed for ${row.id}:`, err);
          await failScoring(row.id, (err as Error).message);
        }
      }
    }
  } catch (err) {
    console.error("[Stale] Cleanup failed:", err);
  }
}

// GET /api/health
router.get("/health", async (req: Request, res: Response) => {
  try {
    await pool.query("SELECT 1");
    completeStaleInterviews().catch(() => {});
    return res.json({ status: "ok" });
  } catch {
    return res.status(503).json({ status: "error", message: "Database connection failed" });
  }
});

// GET /api/config
router.get("/config", (req: Request, res: Response) => {
  return res.json({
    maxProctoringStrikes: parseInt(process.env.MAX_PROCTORING_STRIKES || "25"),
    sttProviders: (process.env.STT_CLIENT_PROVIDERS || "soniox,browser").split(",").map((s: string) => s.trim()),
    sttBackend: process.env.STT_PROVIDER || "soniox",
    silenceDelayMs: parseInt(process.env.SILENCE_DELAY_MS || "3000"),
    appUrl: process.env.FRONTEND_URL || "",
    environment: process.env.NODE_ENV || "development",
  });
});

// POST /api/client-log
router.post("/client-log", (req: Request, res: Response) => {
  try {
    const { level, message, interviewId, data } = req.body;
    const prefix = interviewId ? `[Client:${String(interviewId).substring(0, 8)}]` : "[Client]";
    if (level === "error") console.error(`${prefix} ${message}`, data || "");
    else if (level === "warn") console.warn(`${prefix} ${message}`, data || "");
    else console.log(`${prefix} ${message}`, data || "");
    return res.json({ ok: true });
  } catch {
    return res.status(400).json({ ok: false });
  }
});

// GET /api/email-templates
router.get("/email-templates", sessionMiddleware, requireSession, async (req: Request, res: Response) => {
  try {
    const orgId = (req as any).user.orgId;
    const { rows } = await pool.query(
      "SELECT id, name, subject, body, description, is_default FROM email_templates WHERE org_id = $1 ORDER BY is_default DESC, name ASC",
      [orgId]
    );
    return res.json(rows);
  } catch {
    return res.status(500).json({ error: "Failed" });
  }
});

// POST /api/email-templates
router.post("/email-templates", sessionMiddleware, requireAdmin, async (req: Request, res: Response) => {
  try {
    const orgId = (req as any).user.orgId;
    const { name, subject, body, description } = req.body;
    if (!name || !subject || !body) return res.status(400).json({ error: "Name, subject, and body are required" });
    const { rows } = await pool.query(
      "INSERT INTO email_templates (org_id, name, subject, body, description) VALUES ($1,$2,$3,$4,$5) RETURNING *",
      [orgId, name, subject, body, description || ""]
    );
    return res.status(201).json(rows[0]);
  } catch {
    return res.status(500).json({ error: "Failed" });
  }
});

// PUT /api/email-templates
router.put("/email-templates", sessionMiddleware, requireAdmin, async (req: Request, res: Response) => {
  try {
    const orgId = (req as any).user.orgId;
    const { id, name, subject, body, description } = req.body;
    if (!id || !name || !subject || !body) return res.status(400).json({ error: "Missing required fields" });
    await pool.query(
      "UPDATE email_templates SET name=$1, subject=$2, body=$3, description=$4 WHERE id=$5 AND org_id=$6",
      [name, subject, body, description || "", id, orgId]
    );
    return res.json({ ok: true });
  } catch {
    return res.status(500).json({ error: "Failed" });
  }
});

// DELETE /api/email-templates
router.delete("/email-templates", sessionMiddleware, requireAdmin, async (req: Request, res: Response) => {
  try {
    const orgId = (req as any).user.orgId;
    const id = req.query.id as string;
    if (!id) return res.status(400).json({ error: "Missing id" });
    await pool.query("DELETE FROM email_templates WHERE id=$1 AND org_id=$2 AND is_default=false", [id, orgId]);
    return res.json({ ok: true });
  } catch {
    return res.status(500).json({ error: "Failed" });
  }
});

// POST /api/send-outcome-email
router.post("/send-outcome-email", sessionMiddleware, requireSession, async (req: Request, res: Response) => {
  try {
    const { interviewId, type } = req.body;
    if (!interviewId || !["selection", "rejection"].includes(type)) {
      return res.status(400).json({ error: "Invalid request" });
    }
    const interview = await getInterview(interviewId);
    if (!interview) return res.status(404).json({ error: "Interview not found" });
    if (!interview.candidateEmail) return res.status(400).json({ error: "No candidate email on file" });

    const { rows } = await pool.query(
      "SELECT o.name FROM organizations o JOIN users u ON u.org_id = o.id WHERE u.id = $1",
      [(req as any).user.id]
    );
    const orgName = rows[0]?.name || "InterviewAI";

    if (type === "selection") {
      await sendSelectionEmail(interview.candidateEmail, interview.candidateName || interview.candidateEmail, interview.role, orgName);
    } else {
      await sendRejectionEmail(interview.candidateEmail, interview.candidateName || interview.candidateEmail, interview.role, orgName);
    }
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: "Failed to send email" });
  }
});

// GET /api/organizations
router.get("/organizations", async (req: Request, res: Response) => {
  const { rows } = await pool.query("SELECT id, name FROM organizations ORDER BY name ASC");
  return res.json(rows);
});

export default router;
