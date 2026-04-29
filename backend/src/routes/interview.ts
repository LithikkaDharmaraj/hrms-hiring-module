import { Router, Request, Response } from "express";
import { randomUUID, randomBytes } from "crypto";
import multer from "multer";
import mammoth from "mammoth";
import {
  getInterview, getInterviewWithPhotos, saveInterview, updateInterview,
  getAllInterviews, getInterviewByToken, getProctoringViolationCount, Interview,
} from "../lib/store";
import { generateScorecard } from "../lib/ai";
import { startScoring, completeScoring, failScoring, getScoringStatus } from "../lib/scoring-tracker";
import { normalizeScorecard } from "../lib/normalize-scorecard";
import { parseScorecardJSON } from "../lib/parse-scorecard";
import { inferDomain } from "../lib/infer-domain";
import { sendInterviewInvite } from "../lib/email";
import { validateInterviewAccess, validateInterviewAccessPost, requireSession } from "../middleware/auth";
import { pool } from "../lib/db";
import { rateLimit } from "../lib/rate-limit";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

async function extractTextFromPDF(buffer: Buffer): Promise<string> {
  try {
    const pdfParse = require("pdf-parse/lib/pdf-parse.js");
    const data = await pdfParse(buffer);
    return data.text?.trim() || "Resume provided but could not be parsed.";
  } catch {
    return "Resume provided but could not be parsed.";
  }
}

// GET /api/interviews
router.get("/", async (req, res) => {
  try {
    const user = (req as any).user;
    const orgId = user?.orgId;
    const interviews = await getAllInterviews(orgId);
    return res.json(interviews);
  } catch (err) {
    console.error("[Interviews:list]", err);
    return res.status(500).json({ error: "Failed to fetch interviews" });
  }
});

// POST /api/create-interview
router.post("/create", upload.single("resume"), async (req, res) => {
  try {
    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || "unknown";
    if (!rateLimit(ip, 10, 60000)) {
      return res.status(429).json({ error: "Too many requests. Try again later." });
    }

    const {
      role, level, candidateEmail, candidateName = "", candidatePhone = "",
      focusAreas: focusAreasRaw, duration: durationRaw, roundType = "General",
      language = "", emailTemplateId = "", additionalContext = "", questionBankId,
    } = req.body;

    const focusAreas = (focusAreasRaw || "").split(",").map((s: string) => s.trim()).filter(Boolean);
    const duration = parseInt(durationRaw) || 30;

    if (!role || !level) {
      return res.status(400).json({ error: "Missing required fields: role, level" });
    }

    let resumeText = "";
    let resumeFileName = "";
    let resumeBuffer: Buffer | null = null;

    if (req.file) {
      resumeBuffer = req.file.buffer;
      resumeFileName = req.file.originalname;
      const ext = req.file.originalname.toLowerCase().split(".").pop();

      if (ext === "pdf") {
        resumeText = await extractTextFromPDF(resumeBuffer);
      } else if (ext === "docx") {
        const result = await mammoth.extractRawText({ buffer: resumeBuffer });
        resumeText = result.value;
      } else {
        resumeText = resumeBuffer.toString("utf-8");
      }
    }

    if (!resumeText) {
      resumeText = "No resume content available. Proceed with general interview questions for the role.";
    }

    // Load question bank
    let questionBankQuestions: string[] = [];
    if (questionBankId) {
      try {
        const { rows } = await pool.query("SELECT questions FROM question_banks WHERE id = $1", [questionBankId]);
        if (rows.length > 0 && rows[0].questions) {
          questionBankQuestions = Array.isArray(rows[0].questions) ? rows[0].questions : JSON.parse(rows[0].questions);
        }
      } catch (err) { console.error("Failed to load question bank:", err); }
    }

    if (questionBankQuestions.length > 0) {
      resumeText += `\n\n--- QUESTION BANK ---\nUse these questions during the interview:\n${questionBankQuestions.map((q, i) => `${i + 1}. ${q}`).join("\n")}`;
    }

    if (additionalContext) {
      resumeText += `\n\n--- INTERVIEWER NOTES ---\n${additionalContext}`;
    }

    const user = (req as any).user;
    const id = randomUUID();
    const token = randomBytes(32).toString("hex");

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    const interview: Interview = {
      id, resume: resumeText, resumeFileName,
      candidateEmail: candidateEmail || "", candidateName, candidatePhone,
      token, browserFingerprint: null,
      role, level, focusAreas, duration, roundType, language,
      status: "waiting", transcript: [], proctoring: [], scorecard: null,
      createdAt: new Date().toISOString(), startedAt: null, endedAt: null,
      expiresAt: expiresAt.toISOString(),
      orgId: user?.orgId || undefined, createdBy: user?.id || undefined,
    };

    // ATS scoring
    let atsResultData: any = null, atsScore: number | null = null,
      atsLabel: string | null = null, atsDomain: string | null = null;

    if (resumeBuffer !== null) {
      const atsUrl = process.env.ATS_API_URL || "http://localhost:8000";
      const jdText = `${level} ${role}${focusAreas.length ? `. Required skills: ${focusAreas.join(", ")}` : ""}`;

      const [kwRes, evalRes] = await Promise.all([
        fetch(`${atsUrl}/api/v1/ats/keywords`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ resume_text: resumeText.substring(0, 6000), job_text: jdText }),
        }),
        fetch(`${atsUrl}/api/v1/ats/evaluate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ resume_text: resumeText.substring(0, 6000), job_text: jdText }),
        }),
      ]);

      if (!kwRes.ok || !evalRes.ok) {
        const detail = !kwRes.ok ? `keywords ${kwRes.status}` : `evaluate ${evalRes.status}`;
        throw new Error(`ATSv4 unavailable (${detail}) — cannot create interview without ATS scoring`);
      }

      const kw = await kwRes.json();
      const ev = await evalRes.json();

      atsScore = Math.max(0, Math.min(100, Number(ev.score) || 0));
      atsLabel = atsScore >= 50 ? "Pass" : "Reject";
      atsDomain = (ev.domain as string) || inferDomain(`${role} ${jdText}`);

      const matched_skills = (kw.keyword_matches || [])
        .filter((m: any) => !m.match_type || m.match_type !== "traversal")
        .map((m: any) => m.job_keyword);
      const inferred_skills: string[] = kw.traversal_matches || [];

      atsResultData = {
        score: atsScore, grade: ev.grade, label: atsLabel,
        overall_summary: ev.overall_summary, strengths: ev.strengths, risks: ev.risks,
        interview_focus: ev.interview_focus, matched_skills,
        missing_skills: kw.missing_keywords || [], inferred_skills,
        skill_coverage: Number(kw.keyword_coverage) || 0,
        keyword_coverage: Number(kw.keyword_coverage) || 0,
        domain: atsDomain, explanation: ev.overall_summary || "", _source: "atsv4",
      };
    }

    if (atsScore !== null && atsScore < 50) {
      return res.status(422).json({ qualified: false, atsScore, atsLabel, atsResult: atsResultData, atsDomain });
    }

    await saveInterview(interview);

    if (atsResultData) {
      await updateInterview(id, { atsScore, atsLabel, atsResult: atsResultData, atsDomain } as any);
    }

    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
    const interviewUrl = `/interview/${id}?token=${token}`;

    if (candidateEmail && emailTemplateId) {
      const fullUrl = `${frontendUrl}${interviewUrl}`;
      const { rows: tplRows } = await pool.query("SELECT subject, body FROM email_templates WHERE id = $1", [emailTemplateId]);
      if (tplRows.length > 0) {
        const tpl = tplRows[0];
        const orgName = user?.orgName || "InterviewAI";
        const firstName = (candidateName || "").split(" ")[0] || "there";
        const subject = tpl.subject.replace(/\{\{role\}\}/g, role).replace(/\{\{orgName\}\}/g, orgName)
          .replace(/\{\{candidateName\}\}/g, candidateName || "Candidate").replace(/\{\{firstName\}\}/g, firstName)
          .replace(/\{\{level\}\}/g, level).replace(/\{\{duration\}\}/g, String(duration));
        const bodyText = tpl.body.replace(/\{\{role\}\}/g, role).replace(/\{\{orgName\}\}/g, orgName)
          .replace(/\{\{candidateName\}\}/g, candidateName || "Candidate").replace(/\{\{firstName\}\}/g, firstName)
          .replace(/\{\{level\}\}/g, level).replace(/\{\{duration\}\}/g, String(duration));
        const { sendCustomEmail } = await import("../lib/email");
        sendCustomEmail(candidateEmail, subject, bodyText, fullUrl, orgName).catch(console.error);
      } else {
        sendInterviewInvite(candidateEmail, candidateName || candidateEmail, fullUrl, role, duration).catch(console.error);
      }
    } else if (candidateEmail) {
      const fullUrl = `${frontendUrl}${interviewUrl}`;
      sendInterviewInvite(candidateEmail, candidateName || candidateEmail, fullUrl, role, duration).catch(console.error);
    }

    return res.json({ id, token, url: interviewUrl, candidateEmail, qualified: true, atsScore, atsLabel, atsResult: atsResultData, atsDomain });
  } catch (err) {
    console.error("[Interview:create]", err);
    return res.status(500).json({ error: "Failed to create interview" });
  }
});

// GET /api/interview/:id
router.get("/:id", async (req, res) => {
  const { id } = req.params;
  const shareMode = req.query.share === "true";

  if (shareMode) {
    const interview = await getInterview(id);
    if (interview && interview.status === "completed") {
      return res.json({ ...interview, resume: "", token: "", browserFingerprint: null });
    }
    return res.status(404).json({ error: "Not available for sharing" });
  }

  const { authorized, session } = await validateInterviewAccess(req, id);
  if (!authorized) return res.status(401).json({ error: "Unauthorized" });

  const includePhotos = req.query.photos === "true";
  const interview = includePhotos ? await getInterviewWithPhotos(id) : await getInterview(id);
  if (!interview) return res.status(404).json({ error: "Interview not found" });

  if (!session && interview.expiresAt && new Date(interview.expiresAt) < new Date()) {
    return res.status(410).json({ error: "This interview link has expired", expired: true });
  }

  return res.json(interview);
});

// DELETE /api/interview/:id
router.delete("/:id", async (req, res) => {
  const { id } = req.params;
  const { authorized, session } = await validateInterviewAccess(req, id);
  if (!authorized || !session) return res.status(401).json({ error: "Unauthorized — admin access required" });

  await pool.query("DELETE FROM interviews WHERE id = $1", [id]);
  return res.json({ ok: true });
});

// POST /api/interview/:id/start
router.post("/:id/start", async (req, res) => {
  const { id } = req.params;
  const token = req.body?.token || req.query.token;

  const authorized = await validateInterviewAccessPost(req, id, token);
  if (!authorized) return res.status(401).json({ error: "Unauthorized" });

  try {
    const { rows: statusRows } = await pool.query("SELECT status FROM interviews WHERE id = $1", [id]);
    if (statusRows.length > 0 && statusRows[0].status === "completed") {
      return res.status(403).json({ error: "This interview has already been completed. Re-entry is not allowed." });
    }
  } catch (err) { console.warn("[interview/start] completed check failed:", err); }

  try {
    const eligibility = await pool.query(
      `SELECT ja.status FROM job_applications ja
       JOIN interview_tokens it ON it.id = ja.interview_token_id
       JOIN interviews i ON i.token = it.token
       WHERE i.id = $1`,
      [id]
    );
    if (eligibility.rows.length > 0 && eligibility.rows[0].status === "ats_failed") {
      return res.status(403).json({ error: "Interview not available: ATS screening was not passed." });
    }
  } catch (err) { console.warn("[interview/start] eligibility check failed:", err); }

  await updateInterview(id, { status: "in_progress", startedAt: new Date().toISOString() });
  return res.json({ ok: true });
});

// POST /api/interview/:id/end
router.post("/:id/end", async (req, res) => {
  const { id } = req.params;
  const token = req.body?.token;
  let authorized = await validateInterviewAccessPost(req, id, token);
  if (!authorized) return res.status(401).json({ error: "Unauthorized" });

  const interview = await getInterview(id);
  if (!interview) return res.status(404).json({ error: "Interview not found" });

  await updateInterview(id, { status: "completed", endedAt: new Date().toISOString() });

  // Sync job_applications status
  try {
    await pool.query(
      `UPDATE job_applications ja SET status='interview_completed', updated_at=NOW()
       FROM interview_tokens it JOIN interviews i ON i.token=it.token
       WHERE it.id=ja.interview_token_id AND i.id=$1
         AND ja.status NOT IN ('selected','rejected','ats_failed')`,
      [id]
    );
  } catch (err) { console.error("[Interview/end] Failed to sync job_application:", err); }

  // Auto-assign task from job config
  try {
    const { rows: tokenRows } = await pool.query(
      `SELECT it.job_id, ja.id AS application_id FROM interview_tokens it
       JOIN interviews i ON i.token=it.token
       LEFT JOIN job_applications ja ON ja.interview_token_id=it.id
       WHERE i.id=$1 LIMIT 1`,
      [id]
    );
    const jobId = tokenRows[0]?.job_id;
    const applicationId = tokenRows[0]?.application_id || null;

    if (jobId) {
      const { rows: jobRows } = await pool.query(
        "SELECT task_enabled, task_title, task_description, task_duration_hours FROM jobs WHERE id=$1",
        [jobId]
      );
      const job = jobRows[0];
      if (job?.task_enabled && job.task_title && job.task_description) {
        let candidateId: string | null = null;
        if (interview.candidateEmail) {
          const { rows: userRows } = await pool.query(
            "SELECT id FROM users WHERE email=$1 AND role='candidate' LIMIT 1",
            [interview.candidateEmail]
          );
          candidateId = userRows[0]?.id || null;
        }
        if (candidateId) {
          const { rows: existingRows } = await pool.query(
            "SELECT id FROM tasks WHERE candidate_id=$1 AND application_id=$2 LIMIT 1",
            [candidateId, applicationId]
          );
          if (existingRows.length === 0) {
            const durationHours = job.task_duration_hours || 48;
            const deadline = new Date(Date.now() + durationHours * 3600 * 1000);
            await pool.query(
              "INSERT INTO tasks (title, description, deadline, duration_hours, created_by, candidate_id, application_id) VALUES ($1,$2,$3,$4,'system',$5,$6)",
              [job.task_title, job.task_description, deadline, durationHours, candidateId, applicationId]
            );
          }
        }
      }
    }
  } catch (err) { console.error("[Interview/end] Failed to auto-assign task:", err); }

  // Auto-generate scorecard in background
  setTimeout(async () => {
    try {
      const freshInterview = await getInterview(id);
      if (freshInterview && freshInterview.transcript.length > 0 && !freshInterview.scorecard) {
        await generateScorecardInBackground(id, freshInterview);
      }
    } catch (err) { console.error("[Auto-Score] Failed:", err); }
  }, 3000);

  return res.json({ ok: true });
});

// POST /api/interview/:id/decision
router.post("/:id/decision", requireSession, async (req, res) => {
  const user = (req as any).user;
  const { id } = req.params;
  const { decision } = req.body;

  if (decision !== "selected" && decision !== "rejected" && decision !== null) {
    return res.status(400).json({ error: "decision must be 'selected', 'rejected', or null" });
  }

  await pool.query(
    `UPDATE interviews SET hiring_decision=$1, hiring_decision_at=CASE WHEN $1 IS NULL THEN NULL ELSE NOW() END, hiring_decision_by=$2 WHERE id=$3`,
    [decision, user.email, id]
  );
  return res.json({ ok: true, decision });
});

// GET /api/interview/:id/violations
router.get("/:id/violations", async (req, res) => {
  const { id } = req.params;
  const { authorized } = await validateInterviewAccess(req, id);
  if (!authorized) return res.status(401).json({ error: "Unauthorized" });
  const count = await getProctoringViolationCount(id);
  return res.json({ count });
});

// GET /api/scoring-status/:id
router.get("/scoring-status/:id", async (req, res) => {
  const { id } = req.params;
  const status = await getScoringStatus(id);
  return res.json(status);
});

// POST /api/scorecard — manual scorecard generation
router.post("/scorecard", requireSession, async (req, res) => {
  let interviewId: string | undefined;
  try {
    interviewId = req.body?.interviewId;
    if (!interviewId) return res.status(400).json({ error: "Missing interviewId" });

    if (!(await startScoring(interviewId))) {
      return res.status(409).json({ error: "Scoring already in progress" });
    }

    const interview = await getInterview(interviewId);
    if (!interview) {
      failScoring(interviewId, "Interview not found");
      return res.status(404).json({ error: "Interview not found" });
    }

    const scorecardRaw = await generateScorecard(interview);
    const parsed = parseScorecardJSON(scorecardRaw);
    const scorecard = normalizeScorecard(parsed);

    await updateInterview(interviewId, { scorecard, status: "completed", endedAt: new Date().toISOString() });
    await completeScoring(interviewId);
    return res.json(scorecard);
  } catch (err) {
    console.error("[Scorecard]", err);
    if (interviewId) { try { await failScoring(interviewId, (err as Error).message); } catch {} }
    return res.status(500).json({ error: "Failed to generate scorecard" });
  }
});

// GET /api/recording/:id
router.get("/recording/:id", requireSession, async (req, res) => {
  const { id } = req.params;
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_REGEX.test(id)) return res.status(400).json({ error: "Invalid ID" });

  const { rows } = await pool.query("SELECT recording_data, recording_mime FROM interviews WHERE id=$1", [id]);
  if (rows.length === 0 || !rows[0].recording_data) return res.status(404).json({ error: "Recording not found" });

  const buffer: Buffer = rows[0].recording_data;
  const mime: string = rows[0].recording_mime || "audio/webm";

  res.setHeader("Content-Type", mime);
  res.setHeader("Content-Length", buffer.length);
  res.setHeader("Content-Disposition", `attachment; filename="interview-${id}.webm"`);
  return res.send(buffer);
});

// POST /api/upload-recording
router.post("/upload-recording", upload.single("audio"), async (req, res) => {
  try {
    const interviewId = req.body?.interviewId;
    const token = req.body?.token;

    if (!req.file || !interviewId) return res.status(400).json({ error: "Missing audio or interviewId" });

    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_REGEX.test(interviewId)) return res.status(400).json({ error: "Invalid interview ID" });

    if (!(await validateInterviewAccessPost(req, interviewId, token))) {
      return res.status(403).json({ error: "Invalid interview" });
    }

    const buffer = req.file.buffer;
    const mime = req.file.mimetype || "audio/webm";

    await pool.query(
      "UPDATE interviews SET recording_data=$1, recording_mime=$2 WHERE id=$3",
      [buffer, mime, interviewId]
    );

    return res.json({ success: true });
  } catch (err) {
    console.error("[Upload-recording]", err);
    return res.status(500).json({ error: "Failed to save recording" });
  }
});

// GET /api/questions
router.get("/questions", requireSession, async (req, res) => {
  try {
    const user = (req as any).user;
    const { rows } = await pool.query(
      "SELECT id, org_id, name, role, level, round_type, questions FROM question_banks WHERE org_id=$1 ORDER BY name ASC",
      [user.orgId]
    );
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ error: "Failed to fetch question banks" });
  }
});

// POST /api/questions
router.post("/questions", requireSession, async (req, res) => {
  try {
    const user = (req as any).user;
    const { name, role, level, roundType, questions } = req.body;
    if (!name || !role || !level || !roundType) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    const { rows } = await pool.query(
      `INSERT INTO question_banks (name, role, level, round_type, questions, org_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, org_id, name, role, level, round_type, questions`,
      [name, role, level, roundType, JSON.stringify(questions || []), user.orgId]
    );
    return res.status(201).json(rows[0]);
  } catch (err) {
    return res.status(500).json({ error: "Failed to create question bank" });
  }
});

// GET /api/questions/:id
router.get("/questions/:id", requireSession, async (req, res) => {
  const user = (req as any).user;
  const { rows } = await pool.query("SELECT * FROM question_banks WHERE id=$1 AND org_id=$2", [req.params.id, user.orgId]);
  if (rows.length === 0) return res.status(404).json({ error: "Not found" });
  return res.json(rows[0]);
});

// PUT /api/questions/:id
router.put("/questions/:id", requireSession, async (req, res) => {
  const user = (req as any).user;
  const { name, role, level, roundType, questions } = req.body;
  const { rows } = await pool.query(
    `UPDATE question_banks SET name=$1, role=$2, level=$3, round_type=$4, questions=$5
     WHERE id=$6 AND org_id=$7 RETURNING id, org_id, name, role, level, round_type, questions`,
    [name, role, level, roundType, JSON.stringify(questions || []), req.params.id, user.orgId]
  );
  if (rows.length === 0) return res.status(404).json({ error: "Not found" });
  return res.json(rows[0]);
});

// DELETE /api/questions/:id
router.delete("/questions/:id", requireSession, async (req, res) => {
  const user = (req as any).user;
  const { rowCount } = await pool.query("DELETE FROM question_banks WHERE id=$1 AND org_id=$2", [req.params.id, user.orgId]);
  if (rowCount === 0) return res.status(404).json({ error: "Not found" });
  return res.json({ success: true });
});

// POST /api/task-submit/:interviewId
router.post("/task-submit/:interviewId", async (req, res) => {
  const { interviewId } = req.params;
  const { repoUrl, token } = req.body;
  const TASK_EVAL_API_URL = process.env.TASK_EVAL_API_URL || "http://localhost:9000";

  try {
    if (!repoUrl?.trim()) return res.status(400).json({ error: "repoUrl is required" });

    const ghMatch = repoUrl.trim().match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)/);
    if (!ghMatch) return res.status(400).json({ error: "Please enter a valid GitHub repository URL" });
    const githubUsername = ghMatch[1];

    const { rows } = await pool.query(
      `SELECT i.id, i.token, i.task_id, i.task_deadline_at, i.task_submitted_at,
              i.candidate_name, ht.title as task_title, ht.description as task_description
         FROM interviews i LEFT JOIN hiring_tasks ht ON ht.id=i.task_id WHERE i.id=$1`,
      [interviewId]
    );
    const interview = rows[0];
    if (!interview) return res.status(404).json({ error: "Interview not found" });
    if (interview.token !== token) return res.status(401).json({ error: "Unauthorized" });
    if (!interview.task_id) return res.status(400).json({ error: "No task assigned" });
    if (interview.task_deadline_at && new Date() > new Date(interview.task_deadline_at)) {
      return res.status(410).json({ error: "Submission deadline has passed" });
    }
    if (interview.task_submitted_at) return res.status(409).json({ error: "Task already submitted" });

    const ghRes = await fetch(`https://api.github.com/users/${githubUsername}`, {
      headers: { "User-Agent": "InterviewAI-TaskEval", Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(8000),
    }).catch(() => null);

    if (!ghRes || !ghRes.ok) {
      return res.status(400).json({ error: `GitHub user "${githubUsername}" not found.` });
    }

    const ghUser = await ghRes.json();
    if (!namesMatch(interview.candidate_name || "", ghUser.name || "", ghUser.login || githubUsername)) {
      return res.status(400).json({ error: `The GitHub account doesn't appear to belong to you.` });
    }

    await pool.query(
      "UPDATE interviews SET task_eval_repo_url=$1, task_submitted_at=NOW(), task_eval_status='pending' WHERE id=$2",
      [repoUrl.trim(), interviewId]
    );

    // Trigger evaluation async
    (async () => {
      try {
        const evalRes = await fetch(`${TASK_EVAL_API_URL}/api/evaluate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            repo_url: repoUrl.trim(),
            project_title: interview.task_title || "Hiring Task",
            project_description: interview.task_description || "Evaluate this candidate's code.",
          }),
          signal: AbortSignal.timeout(30000),
        });
        if (evalRes.ok) {
          const evalData = await evalRes.json();
          await pool.query(
            "UPDATE interviews SET task_eval_id=$1, task_eval_status=$2 WHERE id=$3",
            [evalData.id, evalData.status || "pending", interviewId]
          );
        } else {
          await pool.query("UPDATE interviews SET task_eval_status='failed' WHERE id=$1", [interviewId]);
        }
      } catch (err) { console.error("[TaskSubmit] Eval trigger failed:", err); }
    })();

    return res.json({ ok: true, message: "Submission received. Evaluation in progress." });
  } catch (err) {
    console.error("[TaskSubmit]", err);
    return res.status(500).json({ error: "Submission failed" });
  }
});

// GET /api/task-submit/:interviewId
router.get("/task-submit/:interviewId", async (req, res) => {
  const { interviewId } = req.params;
  const token = req.query.token as string;

  const { rows } = await pool.query(
    `SELECT i.token, i.task_id, i.task_deadline_at, i.task_submitted_at,
            i.task_eval_repo_url, i.task_eval_status, i.task_eval_score,
            i.task_eval_grade, i.task_eval_result, i.candidate_name,
            ht.title as task_title, ht.description as task_description, ht.deadline_hours
       FROM interviews i LEFT JOIN hiring_tasks ht ON ht.id=i.task_id WHERE i.id=$1`,
    [interviewId]
  );
  const row = rows[0];
  if (!row) return res.status(404).json({ error: "Not found" });
  if (token && row.token !== token) return res.status(401).json({ error: "Unauthorized" });

  return res.json({
    hasTask: !!row.task_id, candidateName: row.candidate_name || null,
    taskTitle: row.task_title, taskDescription: row.task_description,
    deadlineAt: row.task_deadline_at, submittedAt: row.task_submitted_at,
    repoUrl: row.task_eval_repo_url, evalStatus: row.task_eval_status,
    evalScore: row.task_eval_score, evalGrade: row.task_eval_grade, evalResult: row.task_eval_result,
  });
});

function namesMatch(candidateName: string, displayName: string, login: string): boolean {
  if (!candidateName?.trim()) return true;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
  const parts = candidateName.split(/\s+/).filter((p) => p.length > 2).map(norm);
  if (parts.length === 0) return true;
  const combined = norm((displayName || "") + " " + (login || ""));
  return parts.filter((p) => combined.includes(p)).length >= Math.min(2, parts.length);
}

async function generateScorecardInBackground(id: string, interview: any) {
  if (!(await startScoring(id))) return;
  try {
    const scorecardRaw = await generateScorecard(interview);
    const parsed = parseScorecardJSON(scorecardRaw);
    const scorecard = normalizeScorecard(parsed);

    let atsScore: number | null = null;
    try {
      const { rows: atsRows } = await pool.query(
        `SELECT ae.score FROM ats_evaluations ae JOIN job_applications ja ON ja.ats_evaluation_id=ae.id
         JOIN interview_tokens it ON it.id=ja.interview_token_id
         WHERE it.token=$1 AND ae.is_global=false ORDER BY ae.created_at DESC LIMIT 1`,
        [interview.token]
      );
      atsScore = atsRows[0]?.score ?? null;
    } catch {}

    if (atsScore !== null) {
      const combined = Math.round((0.7 * scorecard.overall + 0.3 * (atsScore / 20)) * 10) / 10;
      (scorecard as any).combinedScore = combined;
      (scorecard as any).atsScore = Math.round(atsScore);
    }

    await updateInterview(id, { scorecard });
    await completeScoring(id);

    try {
      const { sendInterviewComplete, sendRejectionEmail } = await import("../lib/email");
      const { rows: userRows } = await pool.query(
        "SELECT u.email, u.name, o.name as org_name FROM users u JOIN interviews i ON u.id=i.created_by JOIN organizations o ON u.org_id=o.id WHERE i.id=$1",
        [id]
      );
      if (userRows.length > 0 && userRows[0].email) {
        const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
        const reviewUrl = `${frontendUrl}/review/${id}`;
        const candidateLabel = interview.candidateName || interview.candidateEmail || "A candidate";
        await sendInterviewComplete(userRows[0].email, userRows[0].name || "", candidateLabel, reviewUrl);
      }
      const rec = scorecard?.recommendation as string | undefined;
      if (rec && (rec === "no_hire" || rec === "strong_no_hire") && interview.candidateEmail) {
        const orgName = userRows[0]?.org_name || "InterviewAI";
        await sendRejectionEmail(interview.candidateEmail, interview.candidateName || interview.candidateEmail, interview.role, orgName);
      }
    } catch (emailErr) { console.error("[Auto-Score] Email failed:", emailErr); }
  } catch (err) {
    await failScoring(id, (err as Error).message);
  }
}

export default router;
