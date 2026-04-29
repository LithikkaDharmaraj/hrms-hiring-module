import { Router, Request, Response } from "express";
import { requireSession } from "../middleware/auth";
import { pool } from "../lib/db";
import { v4 as uuidv4 } from "uuid";
import multer from "multer";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

const INTERNAL_KEY = process.env.INTERNAL_SERVICE_KEY || "ats-internal-key";
const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";
const TASK_EVAL_API_URL = process.env.TASK_EVAL_API_URL || "http://localhost:9000";

async function callService(path: string, body: unknown) {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-internal-key": INTERNAL_KEY },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Service error ${res.status}`);
  return data;
}

// POST /api/candidate/apply
router.post("/apply", requireSession, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (user.role !== "candidate") return res.status(403).json({ error: "Candidates only" });

    const { jobId } = req.body;
    if (!jobId) return res.status(400).json({ error: "jobId required" });

    const existing = await pool.query(
      `SELECT ja.*, ae.score as ats_score, ae.label as ats_label, ae.suggestions,
              it.interview_url, it.status as interview_status, it.result as interview_result
       FROM job_applications ja
       LEFT JOIN ats_evaluations ae ON ae.id = ja.ats_evaluation_id
       LEFT JOIN interview_tokens it ON it.id = ja.interview_token_id
       WHERE ja.candidate_id=$1 AND ja.job_id=$2`,
      [user.id, jobId]
    );
    if (existing.rows.length > 0) {
      const prev = existing.rows[0];
      if (prev.status === "ats_error") {
        await pool.query("DELETE FROM job_applications WHERE id=$1", [prev.id]);
      } else {
        return res.json({ application: prev, alreadyApplied: true });
      }
    }

    const jobRes = await pool.query("SELECT * FROM jobs WHERE id=$1 AND status='open'", [jobId]);
    if (jobRes.rows.length === 0) return res.status(404).json({ error: "Job not found or closed" });
    const job = jobRes.rows[0];

    const profileRes = await pool.query("SELECT * FROM candidate_profiles WHERE user_id=$1", [user.id]);
    const profile = profileRes.rows[0];
    if (!profile?.resume_text) return res.status(422).json({ error: "Please upload your resume before applying" });

    const appId = uuidv4();
    await pool.query("INSERT INTO job_applications (id, candidate_id, job_id, status) VALUES ($1,$2,$3,'applied')", [appId, user.id, jobId]);

    let atsResult: any;
    try {
      atsResult = await callService("/api/services/ats/evaluate", {
        resumeText: profile.resume_text,
        jobDescription: `${job.title}\n\n${job.description}\n\n${job.requirements || ""}`,
        candidateId: user.id, jobId,
      });
    } catch (err) {
      await pool.query("UPDATE job_applications SET status='ats_error', updated_at=NOW() WHERE id=$1", [appId]);
      return res.status(500).json({ error: "ATS evaluation failed", detail: String(err) });
    }

    await pool.query("UPDATE job_applications SET ats_evaluation_id=$1, updated_at=NOW() WHERE id=$2", [atsResult.evaluationId, appId]);

    if (!atsResult.eligible) {
      await pool.query("UPDATE job_applications SET status='ats_failed', updated_at=NOW() WHERE id=$1", [appId]);
      return res.json({
        applicationId: appId, eligible: false, atsScore: atsResult.score,
        atsLabel: atsResult.label, matched_skills: atsResult.matched_skills,
        missing_skills: atsResult.missing_skills, suggestions: atsResult.suggestions,
        explanation: atsResult.explanation,
        message: "Your ATS score is below the minimum threshold (50). Improve your resume and re-apply.",
      });
    }

    let interviewResult: any;
    try {
      interviewResult = await callService("/api/services/interview/create", {
        candidateId: user.id, jobId, applicationId: appId,
        candidateName: user.name, candidateEmail: user.email,
        jobTitle: job.title, jobDescription: job.description,
        orgId: job.org_id, roleTag: job.role_tag, levelTag: job.level_tag,
        interviewDuration: job.interview_duration,
        atsInterviewFocus: atsResult.interview_focus || null,
      });
    } catch (err) {
      await pool.query("UPDATE job_applications SET status='interview_error', updated_at=NOW() WHERE id=$1", [appId]);
      return res.status(500).json({ error: "Interview creation failed", detail: String(err) });
    }

    await pool.query(
      "UPDATE job_applications SET interview_token_id=$1, status='interview_scheduled', updated_at=NOW() WHERE id=$2",
      [interviewResult.tokenId, appId]
    );
    await pool.query("UPDATE interview_tokens SET application_id=$1 WHERE id=$2", [appId, interviewResult.tokenId]);

    return res.json({
      applicationId: appId, eligible: true, atsScore: atsResult.score,
      atsLabel: atsResult.label, matched_skills: atsResult.matched_skills,
      missing_skills: atsResult.missing_skills, suggestions: atsResult.suggestions,
      interviewUrl: interviewResult.interviewUrl, interviewToken: interviewResult.token,
      expiresAt: interviewResult.expiresAt,
      message: "Congratulations! You are eligible. Your interview link is ready.",
    });
  } catch (err) {
    console.error("[Apply]", err);
    return res.status(500).json({ error: "Application failed", detail: String(err) });
  }
});

// GET /api/candidate/profile
router.get("/profile", requireSession, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (user.role !== "candidate") return res.status(403).json({ error: "Candidates only" });
    const { rows } = await pool.query(
      `SELECT u.id, u.email, u.name, cp.* FROM users u
       LEFT JOIN candidate_profiles cp ON cp.user_id = u.id WHERE u.id = $1`,
      [user.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Profile not found" });
    return res.json({ profile: rows[0] });
  } catch (err) {
    return res.status(500).json({ error: "Failed to fetch profile" });
  }
});

// POST /api/candidate/profile
router.post("/profile", requireSession, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (user.role !== "candidate") return res.status(403).json({ error: "Candidates only" });

    const { resumeText, resumeFilename, phone, linkedin_url, portfolio_url, bio, recomputeAts, name } = req.body;

    await pool.query(
      `INSERT INTO candidate_profiles (id, user_id, resume_text, resume_filename, phone, linkedin_url, portfolio_url, bio, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         resume_text     = COALESCE(EXCLUDED.resume_text, candidate_profiles.resume_text),
         resume_filename = COALESCE(EXCLUDED.resume_filename, candidate_profiles.resume_filename),
         phone           = COALESCE(EXCLUDED.phone, candidate_profiles.phone),
         linkedin_url    = COALESCE(EXCLUDED.linkedin_url, candidate_profiles.linkedin_url),
         portfolio_url   = COALESCE(EXCLUDED.portfolio_url, candidate_profiles.portfolio_url),
         bio             = COALESCE(EXCLUDED.bio, candidate_profiles.bio),
         updated_at      = NOW()`,
      [user.id, resumeText || null, resumeFilename || null, phone || null, linkedin_url || null, portfolio_url || null, bio || null]
    );

    if (name && name !== user.name) {
      await pool.query("UPDATE users SET name=$1 WHERE id=$2", [name, user.id]);
    }

    let globalAts = null;
    if (resumeText && recomputeAts !== false) {
      try {
        const atsRes = await fetch(`${BACKEND_URL}/api/services/ats/global`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-internal-key": INTERNAL_KEY },
          body: JSON.stringify({ resumeText, candidateId: user.id }),
        });
        if (atsRes.ok) globalAts = await atsRes.json();
      } catch (e) {
        console.error("[CandidateProfile] ATS global scoring failed:", e);
      }
    }

    const { rows } = await pool.query(
      `SELECT u.id, u.email, u.name, cp.* FROM users u
       LEFT JOIN candidate_profiles cp ON cp.user_id = u.id WHERE u.id = $1`,
      [user.id]
    );
    return res.json({ profile: rows[0], globalAts });
  } catch (err) {
    return res.status(500).json({ error: "Failed to update profile" });
  }
});

// GET /api/candidate/applications
router.get("/applications", requireSession, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (user.role !== "candidate") return res.status(403).json({ error: "Candidates only" });

    const statusFilter = req.query.status as string | undefined;
    let query = `
      SELECT ja.id, ja.status, ja.applied_at, ja.updated_at,
        j.title as job_title, j.department, j.location, j.employment_type, j.org_id, j.task_enabled,
        o.name as org_name, (ae.score >= 50) as ats_passed, ae.suggestions,
        it.interview_url, it.token as interview_token,
        it.status as interview_status, it.result as interview_result, it.expires_at
      FROM job_applications ja
      JOIN jobs j ON j.id = ja.job_id JOIN organizations o ON o.id = j.org_id
      LEFT JOIN ats_evaluations ae ON ae.id = ja.ats_evaluation_id
      LEFT JOIN interview_tokens it ON it.id = ja.interview_token_id
      WHERE ja.candidate_id = $1`;

    const values: unknown[] = [user.id];
    if (statusFilter) { query += " AND ja.status = $2"; values.push(statusFilter); }
    query += " ORDER BY ja.applied_at DESC";

    const { rows } = await pool.query(query, values);

    const syncedRows = await Promise.all(
      rows.map(async (row: any) => {
        if (row.interview_token) {
          const intRow = await pool.query("SELECT status FROM interviews WHERE token=$1", [row.interview_token]);
          if (intRow.rows.length > 0 && intRow.rows[0].status === "completed" && row.interview_status !== "completed") {
            await pool.query("UPDATE interview_tokens SET status='completed', updated_at=NOW() WHERE token=$1", [row.interview_token]);
            row.interview_status = "completed";
          }
        }
        row.display_status = mapStatus(row.status, row.interview_status, row.interview_result);
        return row;
      })
    );

    const stats = {
      total: syncedRows.length,
      ats_passed: syncedRows.filter((r: any) => r.ats_passed).length,
      interviews_scheduled: syncedRows.filter((r: any) => r.interview_status === "pending").length,
      completed: syncedRows.filter((r: any) => r.interview_status === "completed").length,
      selected: syncedRows.filter((r: any) => r.interview_result === "Selected").length,
    };

    return res.json({ applications: syncedRows, stats });
  } catch (err) {
    return res.status(500).json({ error: "Failed to fetch applications" });
  }
});

function mapStatus(appStatus: string, interviewStatus: string | null, interviewResult: string | null): string {
  if (interviewResult === "Selected") return "hired";
  if (interviewResult === "Rejected" || appStatus === "rejected") return "not_hired";
  if (appStatus === "selected") return "hired";
  if (interviewStatus === "completed" || appStatus === "interview_completed") return "under_review";
  if (appStatus === "interview_scheduled" && interviewStatus === "pending") return "interview_ready";
  if (appStatus === "ats_failed") return "ats_failed";
  if (appStatus === "ats_error" || appStatus === "interview_error") return "error";
  return "applied";
}

// GET /api/candidate/tasks
router.get("/tasks", requireSession, async (req: Request, res: Response) => {
  try {
    const candidateId = (req as any).user.id;
    const { rows } = await pool.query(
      `SELECT t.id, t.title, t.description, t.deadline, t.duration_hours,
              t.application_id, t.status, t.created_at,
              j.title AS job_title, j.role_tag AS job_role, j.level_tag AS job_level,
              tsr.id AS sub_id, tsr.repo_url AS sub_repo_url, tsr.submitted_at AS sub_submitted_at,
              tsr.status AS sub_status, tsr.evaluation_id AS sub_eval_id,
              tsr.decision AS sub_decision, tsr.evaluation_result AS sub_eval_result
       FROM tasks t
       LEFT JOIN job_applications ja ON ja.id = t.application_id
       LEFT JOIN jobs j ON j.id = ja.job_id
       LEFT JOIN task_submission_records tsr ON tsr.task_id = t.id AND tsr.candidate_id = $1
       WHERE t.candidate_id = $1 AND (t.deadline > NOW() OR tsr.id IS NOT NULL)
       ORDER BY t.deadline ASC`,
      [candidateId]
    );

    const syncPromises = rows
      .filter((r: any) => r.sub_status === "evaluating" && r.sub_eval_id)
      .map(async (r: any) => {
        try {
          const evalRes = await fetch(`${TASK_EVAL_API_URL}/api/evaluate/${r.sub_eval_id}`, { signal: AbortSignal.timeout(8000) });
          if (evalRes.ok) {
            const data = await evalRes.json();
            if (data.status === "completed" || data.status === "failed") {
              await pool.query("UPDATE task_submission_records SET status = 'evaluated', evaluation_result = $1 WHERE id = $2", [JSON.stringify(data), r.sub_id]);
              await pool.query("UPDATE tasks SET status = 'completed' WHERE id = $1", [r.id]);
              r.sub_status = "evaluated"; r.sub_eval_result = data;
            }
          }
        } catch { }
      });
    await Promise.allSettled(syncPromises);

    const tasks = rows.map((r: any) => ({
      id: r.id, title: r.title, description: r.description, deadline: r.deadline,
      durationHours: r.duration_hours, applicationId: r.application_id, status: r.status, createdAt: r.created_at,
      jobTitle: r.job_title || null, jobRole: r.job_role || null, jobLevel: r.job_level || null,
      submission: r.sub_id ? {
        id: r.sub_id, repo_url: r.sub_repo_url, submitted_at: r.sub_submitted_at,
        status: r.sub_status, evaluation_id: r.sub_eval_id, decision: r.sub_decision || "pending",
        evaluation_result: r.sub_eval_result,
      } : null,
    }));
    return res.json({ tasks });
  } catch (err) {
    return res.status(500).json({ error: "Failed" });
  }
});

// POST /api/candidate/tasks/submit
router.post("/tasks/submit", requireSession, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { taskId, repoUrl } = req.body;
    if (!taskId || !repoUrl?.trim()) return res.status(400).json({ error: "taskId and repoUrl are required" });
    if (!/^https?:\/\/github\.com\/[^/]+\/[^/]+/.test(repoUrl.trim())) {
      return res.status(400).json({ error: "Please enter a valid GitHub repository URL" });
    }

    const { rows: taskRows } = await pool.query(
      "SELECT id, title, description, deadline FROM tasks WHERE id = $1 AND candidate_id = $2",
      [taskId, user.id]
    );
    if (taskRows.length === 0) return res.status(404).json({ error: "Task not found" });
    const task = taskRows[0];
    if (new Date() > new Date(task.deadline)) return res.status(410).json({ error: "Submission deadline has passed" });

    const { rows: existing } = await pool.query(
      "SELECT id FROM task_submission_records WHERE task_id = $1 AND candidate_id = $2",
      [taskId, user.id]
    );
    if (existing.length > 0) return res.status(409).json({ error: "You have already submitted for this task" });

    const { rows: inserted } = await pool.query(
      `INSERT INTO task_submission_records (task_id, candidate_id, candidate_name, repo_url, status)
       VALUES ($1, $2, $3, $4, 'submitted') RETURNING id`,
      [taskId, user.id, user.name || null, repoUrl.trim()]
    );
    const submissionId = inserted[0].id;
    await pool.query("UPDATE tasks SET status = 'submitted' WHERE id = $1", [taskId]);

    triggerTaskEval(submissionId, taskId, repoUrl.trim(), task.title, task.description).catch(
      (err) => console.error("[CandidateTaskSubmit] eval trigger failed:", err)
    );
    return res.json({ ok: true, submissionId });
  } catch (err) {
    return res.status(500).json({ error: "Failed" });
  }
});

// GET /api/candidate/tasks/submission/:id
router.get("/tasks/submission/:id", requireSession, async (req: Request, res: Response) => {
  try {
    const candidateId = (req as any).user.id;
    const { rows } = await pool.query(
      `SELECT tsr.id, tsr.task_id, tsr.repo_url, tsr.submitted_at,
              tsr.status, tsr.evaluation_id, tsr.decision, tsr.evaluation_result,
              t.title AS task_title, t.description AS task_description
         FROM task_submission_records tsr JOIN tasks t ON t.id = tsr.task_id
        WHERE tsr.id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    const row = rows[0];
    if (row.candidate_id && row.candidate_id !== candidateId) return res.status(403).json({ error: "Forbidden" });

    if (row.status === "evaluating" && row.evaluation_id) {
      try {
        const evalRes = await fetch(`${TASK_EVAL_API_URL}/api/evaluate/${row.evaluation_id}`, { signal: AbortSignal.timeout(10000) });
        if (evalRes.ok) {
          const data = await evalRes.json();
          if (data.status === "completed" || data.status === "failed") {
            await pool.query("UPDATE task_submission_records SET status = 'evaluated', evaluation_result = $1 WHERE id = $2", [JSON.stringify(data), req.params.id]);
            await pool.query("UPDATE tasks SET status = 'completed' WHERE id = $1", [row.task_id]);
            row.status = "evaluated"; row.evaluation_result = data;
          }
        }
      } catch { }
    }

    return res.json({
      id: row.id, taskId: row.task_id, taskTitle: row.task_title, repoUrl: row.repo_url,
      submittedAt: row.submitted_at, status: row.status, evaluationId: row.evaluation_id,
      decision: row.decision, evaluationResult: row.evaluation_result,
    });
  } catch (err) {
    return res.status(500).json({ error: "Failed" });
  }
});

// POST /api/candidate/parse-resume (also mounted at /api/parse-resume via index.ts)
export async function parseResumeHandler(req: Request, res: Response) {
  try {
    if (!req.file) return res.status(400).json({ error: "No file provided" });
    const buffer = req.file.buffer;
    const mimeType = req.file.mimetype;
    const fileName = req.file.originalname.toLowerCase();
    let text = "";

    if (mimeType === "application/pdf" || fileName.endsWith(".pdf")) {
      const pdfParse = (await import("pdf-parse/lib/pdf-parse.js" as any)).default;
      const data = await pdfParse(buffer);
      text = data.text;
    } else if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || fileName.endsWith(".docx")) {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer });
      text = result.value;
    } else if (mimeType === "text/plain" || fileName.endsWith(".txt")) {
      text = buffer.toString("utf-8");
    } else {
      return res.status(400).json({ error: "Unsupported file type. Please upload a PDF, DOCX, or TXT file." });
    }

    text = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    if (!text || text.length < 50) {
      return res.status(422).json({ error: "Could not extract text from the file. Please try a different format." });
    }

    const extracted = await extractFieldsFromResume(text).catch(() => ({}));
    return res.json({ text, extracted });
  } catch (err) {
    console.error("[parse-resume]", err);
    return res.status(500).json({ error: "Failed to parse file" });
  }
}

async function triggerTaskEval(submissionId: string, taskId: string, repoUrl: string, taskTitle: string, taskDescription: string) {
  await pool.query("UPDATE task_submission_records SET status = 'evaluating' WHERE id = $1", [submissionId]);
  await pool.query("UPDATE tasks SET status = 'evaluating' WHERE id = $1", [taskId]);
  const res = await fetch(`${TASK_EVAL_API_URL}/api/evaluate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      repo_url: repoUrl,
      project_title: taskTitle || "Hiring Task",
      project_description: taskDescription || "Evaluate this candidate code submission.",
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    await pool.query("UPDATE task_submission_records SET status = 'submitted' WHERE id = $1", [submissionId]);
    await pool.query("UPDATE tasks SET status = 'submitted' WHERE id = $1", [taskId]);
    throw new Error(`Eval API error ${res.status}`);
  }
  const data = await res.json();
  await pool.query("UPDATE task_submission_records SET evaluation_id = $1 WHERE id = $2", [data.id, submissionId]);
}

async function extractFieldsFromResume(text: string) {
  const aiBase = process.env.AI_BASE_URL;
  const aiKey = process.env.AI_API_KEY;
  if (!aiBase || !aiKey) return {};

  const prompt = `Extract contact details from this resume. Return ONLY valid JSON, no markdown.

Resume (first 3000 chars):
${text.substring(0, 3000)}

JSON format:
{
  "name": "<full name or null>",
  "phone": "<phone number with country code or null>",
  "linkedin_url": "<full LinkedIn URL or null>",
  "github_url": "<full GitHub URL or null>"
}

Rules:
- Only extract clearly present values; use null if not found
- linkedin_url must start with https://linkedin.com or https://www.linkedin.com
- github_url must start with https://github.com`;

  const res = await fetch(`${aiBase}/v1/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${aiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: process.env.AI_MODEL || "gpt-4o", messages: [{ role: "user", content: prompt }], max_tokens: 200, temperature: 0 }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return {};
  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content || "";
  const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    const fields: Record<string, string> = {};
    if (parsed.name && typeof parsed.name === "string") fields.name = parsed.name.trim();
    if (parsed.phone && typeof parsed.phone === "string") fields.phone = parsed.phone.trim();
    if (parsed.linkedin_url && typeof parsed.linkedin_url === "string") fields.linkedin_url = parsed.linkedin_url.trim();
    if (parsed.github_url && typeof parsed.github_url === "string") fields.github_url = parsed.github_url.trim();
    return fields;
  } catch { return {}; }
}

export default router;
