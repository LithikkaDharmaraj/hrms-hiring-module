import { Router, Request, Response } from "express";
import { pool } from "../lib/db";
import { v4 as uuidv4 } from "uuid";
import { validateInterviewAccess } from "../middleware/auth";

const router = Router();

const INTERNAL_KEY = process.env.INTERNAL_SERVICE_KEY || "ats-internal-key";
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";
const ATS_API_URL = process.env.ATS_API_URL || "http://localhost:8000";
const TASK_EVAL_API_URL = process.env.TASK_EVAL_API_URL || "http://localhost:9000";
const DEFAULT_ORG_ID = "00000000-0000-0000-0000-000000000001";
const INTERVIEW_EXPIRY_HOURS = 72;

function requireInternalKey(req: Request, res: Response, next: Function) {
  if (req.headers["x-internal-key"] !== INTERNAL_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// ─── ATS Service ──────────────────────────────────────────────────────────────

interface ATSResult {
  score: number; label: string; grade: string;
  matched_skills: string[]; missing_skills: string[]; inferred_skills: string[];
  suggestions: string[]; domain: string; skill_coverage: number;
  explanation: string; overall_summary: string;
  strengths: string[]; risks: string[];
  interview_focus: any; full_result: unknown;
}

async function callATSv4(resumeText: string, jobDescription: string): Promise<ATSResult> {
  const res = await fetch(`${ATS_API_URL}/api/v1/ats/evaluate-combined`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ resume_text: resumeText, job_text: jobDescription }),
    signal: AbortSignal.timeout(180000),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`ATSv4 evaluate-combined failed ${res.status}: ${t.substring(0, 200)}`);
  }
  const data = await res.json();
  const score = Math.max(0, Math.min(100, Number(data.score) || 0));
  const matched_skills = (data.keyword_matches || [])
    .filter((m: any) => !m.match_type || m.match_type !== "traversal")
    .map((m: any) => m.job_keyword);
  const inferred_skills: string[] = data.traversal_matches || [];
  const missing_skills: string[] = data.missing_keywords || [];
  const suggestions = [
    ...(data.strengths || []).map((s: string) => `[strength] ${s}`),
    ...(data.risks || []).map((r: string) => `[risk] ${r}`),
  ];
  return {
    score, label: score >= 50 ? "Pass" : "Reject", grade: data.grade,
    matched_skills, missing_skills, inferred_skills, suggestions,
    domain: data.domain || "", skill_coverage: Number(data.keyword_coverage) || 0,
    explanation: data.overall_summary || "", overall_summary: data.overall_summary || "",
    strengths: data.strengths || [], risks: data.risks || [],
    interview_focus: data.interview_focus || null,
    full_result: {
      grade: data.grade, overall_summary: data.overall_summary,
      strengths: data.strengths, risks: data.risks, interview_focus: data.interview_focus,
      keyword_coverage: data.keyword_coverage, keyword_matches: data.keyword_matches,
      matched_skills, missing_skills, inferred_skills, _source: "atsv4",
    },
  };
}

// POST /api/services/ats/evaluate
router.post("/ats/evaluate", requireInternalKey as any, async (req: Request, res: Response) => {
  try {
    const { resumeText, jobDescription, candidateId, jobId } = req.body;
    if (!resumeText || !jobDescription || !candidateId) {
      return res.status(400).json({ error: "resumeText, jobDescription, candidateId required" });
    }
    const result = await callATSv4(resumeText, jobDescription);
    console.log(`[ATS:evaluate] score=${result.score} grade=${result.grade} domain=${result.domain} candidate=${candidateId}`);

    const evalId = uuidv4();
    await pool.query(
      `INSERT INTO ats_evaluations (id, candidate_id, job_id, resume_text, score, label, matched_skills,
         missing_skills, suggestions, domain, skill_coverage, explanation, is_global, full_result)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,false,$13)`,
      [
        evalId, candidateId, jobId || null, resumeText.substring(0, 8000),
        result.score, result.score >= 50 ? "Pass" : "Reject",
        JSON.stringify(result.matched_skills), JSON.stringify(result.missing_skills),
        JSON.stringify(result.suggestions), result.domain, result.skill_coverage,
        result.explanation, JSON.stringify(result.full_result),
      ]
    );
    return res.json({
      evaluationId: evalId, score: result.score, label: result.score >= 50 ? "Pass" : "Reject",
      eligible: result.score >= 50, grade: result.grade, matched_skills: result.matched_skills,
      missing_skills: result.missing_skills, inferred_skills: result.inferred_skills,
      suggestions: result.suggestions, domain: result.domain, skill_coverage: result.skill_coverage,
      explanation: result.explanation, overall_summary: result.overall_summary,
      strengths: result.strengths, risks: result.risks, interview_focus: result.interview_focus, _source: "atsv4",
    });
  } catch (err) {
    console.error("[ATS:evaluate]", err);
    return res.status(500).json({ error: "ATS evaluation failed", detail: String(err) });
  }
});

const GENERIC_JD = `Experienced professional with strong domain expertise.
Requirements: relevant work experience, demonstrated technical or functional skills,
clear career progression, quantified achievements, well-structured resume.`;

// POST /api/services/ats/global
router.post("/ats/global", requireInternalKey as any, async (req: Request, res: Response) => {
  try {
    const { resumeText, candidateId } = req.body;
    if (!resumeText || !candidateId) return res.status(400).json({ error: "resumeText and candidateId required" });

    const evalRes = await fetch(`${ATS_API_URL}/api/v1/ats/evaluate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resume_text: resumeText, job_text: GENERIC_JD }),
      signal: AbortSignal.timeout(120000),
    });
    if (!evalRes.ok) {
      const t = await evalRes.text().catch(() => "");
      throw new Error(`ATSv4 evaluate failed ${evalRes.status}: ${t.substring(0, 200)}`);
    }
    const ev = await evalRes.json();
    const score = Math.max(0, Math.min(100, Number(ev.score) || 0));
    const label = score >= 80 ? "Excellent" : score >= 65 ? "Good" : score >= 50 ? "Fair" : "Needs Work";
    const suggestions = [
      ...(ev.strengths || []).map((s: string) => `[strength] ${s}`),
      ...(ev.risks || []).map((r: string) => `[risk] ${r}`),
    ];
    const result = { score, label, skills: [], suggestions, domain: ev.domain || "", years_experience: 0, strengths: ev.strengths || [], explanation: ev.overall_summary || "", _source: "atsv4" };
    console.log(`[ATS:global] score=${score} label=${label} domain=${result.domain} candidate=${candidateId}`);

    const evalId = uuidv4();
    try {
      await pool.query(
        `INSERT INTO ats_evaluations (id, candidate_id, job_id, resume_text, score, label, matched_skills, missing_skills, suggestions, domain, explanation, is_global, full_result)
         VALUES ($1,$2,NULL,$3,$4,$5,$6,$7,$8,$9,$10,true,$11)`,
        [evalId, candidateId, resumeText.substring(0, 8000), score, label, JSON.stringify([]), JSON.stringify([]), JSON.stringify(suggestions), result.domain, result.explanation, JSON.stringify(result)]
      );
      await pool.query(
        `UPDATE candidate_profiles SET global_ats_score=$1, global_ats_label=$2, global_ats_result=$3, global_ats_updated_at=NOW(), updated_at=NOW() WHERE user_id=$4`,
        [score, label, JSON.stringify(result), candidateId]
      );
    } catch (dbErr) {
      console.error("[ATS:global] DB persist failed (non-fatal):", dbErr);
    }

    return res.json({ evaluationId: evalId, score, label, skills: [], suggestions, domain: result.domain, years_experience: 0, strengths: result.strengths, explanation: result.explanation });
  } catch (err) {
    console.error("[ATS:global]", err);
    return res.status(500).json({ error: "Global ATS scoring failed", detail: String(err) });
  }
});

// ─── Interview Service ────────────────────────────────────────────────────────

// POST /api/services/interview/create
router.post("/interview/create", requireInternalKey as any, async (req: Request, res: Response) => {
  try {
    const {
      candidateId, jobId, applicationId, candidateName, candidateEmail,
      jobTitle, jobDescription, orgId, roleTag, levelTag, interviewDuration, atsInterviewFocus,
    } = req.body;

    if (!candidateId || !jobId || !candidateEmail) {
      return res.status(400).json({ error: "candidateId, jobId, candidateEmail required" });
    }

    const existing = await pool.query(
      "SELECT id, token, interview_url, status, result FROM interview_tokens WHERE candidate_id=$1 AND job_id=$2",
      [candidateId, jobId]
    );
    if (existing.rows.length > 0) {
      const row = existing.rows[0];
      return res.json({ tokenId: row.id, token: row.token, interviewUrl: row.interview_url, status: row.status, result: row.result, duplicate: true });
    }

    const interviewId = uuidv4();
    const interviewToken = uuidv4().replace(/-/g, "");
    const interviewUrl = `${FRONTEND_URL}/interview/${interviewId}?token=${interviewToken}`;
    const expiresAt = new Date(Date.now() + INTERVIEW_EXPIRY_HOURS * 3600 * 1000).toISOString();

    const role = roleTag || jobTitle || "General Role";
    const level = atsInterviewFocus?.recommended_depth === "deep" ? "senior"
      : atsInterviewFocus?.recommended_depth === "surface" ? "junior"
      : levelTag || "mid";
    const baseFocusAreas = deriveFocusAreas(jobDescription || "", role);
    const focusAreas = atsInterviewFocus ? mergeATSFocusAreas(baseFocusAreas, atsInterviewFocus) : baseFocusAreas;

    await pool.query(
      `INSERT INTO interviews (id, resume, resume_file_name, candidate_email, candidate_name, token,
         browser_fingerprint, role, level, focus_areas, duration, status, scorecard, created_at,
         started_at, ended_at, expires_at, org_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,NULL,$7,$8,$9,$12,'waiting',NULL,NOW(),NULL,NULL,$10,$11,NULL)`,
      [
        interviewId,
        jobDescription ? `Job Application for: ${jobTitle}\n\n${jobDescription.substring(0, 2000)}` : `Job: ${jobTitle}`,
        "application_resume", candidateEmail,
        candidateName || candidateEmail.split("@")[0], interviewToken,
        role, level, focusAreas, expiresAt, orgId || DEFAULT_ORG_ID, interviewDuration || 30,
      ]
    );

    const tokenId = uuidv4();
    await pool.query(
      `INSERT INTO interview_tokens (id, candidate_id, job_id, application_id, token, interview_url, status, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,'pending',$7)`,
      [tokenId, candidateId, jobId, applicationId || null, interviewToken, interviewUrl, expiresAt]
    );

    return res.json({ tokenId, token: interviewToken, interviewUrl, interviewId, expiresAt, status: "pending" });
  } catch (err) {
    console.error("[InterviewService:create]", err);
    return res.status(500).json({ error: "Interview creation failed", detail: String(err) });
  }
});

// GET /api/services/interview/:id
router.get("/interview/:id", requireInternalKey as any, async (req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(
      `SELECT it.*, i.status as interview_status, i.scorecard FROM interview_tokens it
       LEFT JOIN interviews i ON i.token = it.token WHERE it.id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    const row = rows[0];
    return res.json({
      tokenId: row.id, token: row.token, interviewUrl: row.interview_url,
      status: row.status, result: row.result, expiresAt: row.expires_at,
      interviewStatus: row.interview_status, hasScorecard: !!row.scorecard,
    });
  } catch (err) {
    return res.status(500).json({ error: "Failed to retrieve interview" });
  }
});

// PATCH /api/services/interview/:id
router.patch("/interview/:id", requireInternalKey as any, async (req: Request, res: Response) => {
  try {
    const { status, result } = req.body;
    const validStatuses = ["pending", "in_progress", "completed"];
    const validResults = ["Selected", "Rejected", null];
    if (status && !validStatuses.includes(status)) return res.status(400).json({ error: "Invalid status" });
    if (result !== undefined && !validResults.includes(result)) return res.status(400).json({ error: "Invalid result" });

    const fields: string[] = ["updated_at=NOW()"];
    const values: unknown[] = [];
    let idx = 1;
    if (status) { fields.push(`status=$${idx++}`); values.push(status); }
    if (result !== undefined) { fields.push(`result=$${idx++}`); values.push(result); }
    values.push(req.params.id);

    await pool.query(`UPDATE interview_tokens SET ${fields.join(",")} WHERE id=$${idx}`, values);

    const tokenRow = await pool.query("SELECT application_id FROM interview_tokens WHERE id=$1", [req.params.id]);
    if (tokenRow.rows[0]?.application_id) {
      const appStatus = result === "Selected" ? "selected" : result === "Rejected" ? "rejected"
        : status === "completed" ? "interview_completed"
        : status === "in_progress" ? "interview_in_progress" : undefined;
      if (appStatus) {
        await pool.query("UPDATE job_applications SET status=$1, updated_at=NOW() WHERE id=$2", [appStatus, tokenRow.rows[0].application_id]);
      }
    }
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: "Update failed" });
  }
});

// GET /api/services/task-eval/status/:interviewId
router.get("/task-eval/status/:interviewId", async (req: Request, res: Response) => {
  try {
    const { interviewId } = req.params;
    const { authorized } = await validateInterviewAccess(req, interviewId);
    if (!authorized) return res.status(401).json({ error: "Unauthorized" });

    const { rows } = await pool.query(
      `SELECT task_eval_id, task_eval_status, task_eval_score, task_eval_grade, task_eval_result, task_eval_repo_url
         FROM interviews WHERE id = $1`,
      [interviewId]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Interview not found" });

    const row = rows[0];
    const evalId: string | null = row.task_eval_id;
    const currentStatus: string | null = row.task_eval_status;

    if (!evalId) return res.json({ status: null, repoUrl: null });
    if (currentStatus === "completed" || currentStatus === "failed") {
      return res.json({ evalId, status: currentStatus, score: row.task_eval_score, grade: row.task_eval_grade, result: row.task_eval_result, repoUrl: row.task_eval_repo_url });
    }

    try {
      const upstreamRes = await fetch(`${TASK_EVAL_API_URL}/api/evaluate/${evalId}`, { signal: AbortSignal.timeout(15000) });
      if (!upstreamRes.ok) return res.json({ evalId, status: currentStatus, repoUrl: row.task_eval_repo_url });
      const data = await upstreamRes.json();
      const newStatus = data.status;
      if (newStatus === "completed" || newStatus === "failed") {
        await pool.query(
          `UPDATE interviews SET task_eval_status=$1, task_eval_score=$2, task_eval_grade=$3, task_eval_result=$4 WHERE id=$5`,
          [newStatus, data.overall_score ?? null, data.overall_grade ?? null, JSON.stringify(data), interviewId]
        );
      } else {
        await pool.query("UPDATE interviews SET task_eval_status=$1 WHERE id=$2", [newStatus, interviewId]);
      }
      return res.json({
        evalId, status: newStatus, score: data.overall_score ?? null,
        grade: data.overall_grade ?? null, result: newStatus === "completed" ? data : null,
        repoUrl: row.task_eval_repo_url, progress: data.progress ?? null, currentStage: data.current_stage ?? null,
      });
    } catch (err) {
      return res.json({ evalId, status: currentStatus, repoUrl: row.task_eval_repo_url });
    }
  } catch (err) {
    console.error("[TaskEval:poll]", err);
    return res.status(500).json({ error: "Failed" });
  }
});

function mergeATSFocusAreas(base: string[], focus: any): string[] {
  const extra = [...(focus.must_probe || []), ...(focus.suggested_question_themes || [])].slice(0, 2);
  const combined = [...base, ...extra];
  const seen = new Set<string>();
  return combined.filter((a) => { const k = a.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 4);
}

function deriveFocusAreas(jobDescription: string, role: string): string[] {
  const jd = jobDescription.toLowerCase();
  const r = role.toLowerCase();
  const areas: string[] = [];
  if (r.includes("engineer") || r.includes("developer") || r.includes("sde")) {
    if (jd.includes("system design") || jd.includes("architecture")) areas.push("System Design");
    if (jd.includes("sql") || jd.includes("database")) areas.push("Databases");
    if (jd.includes("api") || jd.includes("rest")) areas.push("API Development");
    areas.push("Problem Solving");
    if (areas.length < 3) areas.push("Technical Fundamentals");
  } else if (r.includes("data") || r.includes("analyst")) {
    areas.push("SQL & Data Analysis", "Statistics", "Business Insights");
  } else if (r.includes("product") || r.includes("pm")) {
    areas.push("Product Strategy", "User Research", "Prioritization");
  } else if (r.includes("sales") || r.includes("bd")) {
    areas.push("Sales Methodology", "Client Relations", "Negotiation");
  } else if (r.includes("hr") || r.includes("human resource")) {
    areas.push("Talent Acquisition", "Employee Relations", "HR Operations");
  } else {
    areas.push("Domain Knowledge", "Problem Solving", "Communication");
  }
  return areas.slice(0, 4);
}

export default router;
