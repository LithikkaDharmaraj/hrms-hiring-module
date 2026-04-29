import { Router, Request, Response } from "express";
import { requireSession, requireHR, requireAdmin } from "../middleware/auth";
import { pool } from "../lib/db";
import { sendSelectionEmail, sendRejectionEmail } from "../lib/email";

const router = Router();
router.use(requireSession);

const TASK_EVAL_API_URL = process.env.TASK_EVAL_API_URL || "http://localhost:9000";

// GET /api/admin/candidates
router.get("/candidates", requireHR, async (req: Request, res: Response) => {
  try {
    const search = (req.query.search as string) || "";
    const stage = (req.query.stage as string) || "all";
    const sortBy = (req.query.sort as string) || "last_activity";
    const sortDir = req.query.dir === "asc" ? "ASC" : "DESC";
    const page = Math.max(1, parseInt((req.query.page as string) || "1"));
    const pageSize = 20;
    const offset = (page - 1) * pageSize;

    const stageFilter: Record<string, string> = {
      pending:   `AND EXISTS (SELECT 1 FROM job_applications ja2 WHERE ja2.candidate_id = u.id AND ja2.status = 'interview_scheduled')`,
      completed: `AND EXISTS (SELECT 1 FROM job_applications ja2 WHERE ja2.candidate_id = u.id AND ja2.status IN ('interview_completed','selected','rejected'))`,
      selected:  `AND EXISTS (SELECT 1 FROM job_applications ja2 WHERE ja2.candidate_id = u.id AND ja2.status = 'selected')`,
      rejected:  `AND EXISTS (SELECT 1 FROM job_applications ja2 WHERE ja2.candidate_id = u.id AND ja2.status = 'rejected' AND NOT EXISTS (SELECT 1 FROM job_applications ja3 WHERE ja3.candidate_id = u.id AND ja3.status = 'selected'))`,
      ats_failed:`AND EXISTS (SELECT 1 FROM job_applications ja2 WHERE ja2.candidate_id = u.id AND ja2.status = 'ats_failed')`,
    };
    const stageClause = stageFilter[stage] || "";
    const searchFilter = search ? `AND (u.name ILIKE $1 OR u.email ILIKE $1)` : "";
    const searchValue = search ? `%${search}%` : null;

    const allowedSorts: Record<string, string> = {
      last_activity: "last_activity", name: "u.name",
      global_ats: "cp.global_ats_score", joined: "u.created_at", applications: "total_applications",
    };
    const orderCol = allowedSorts[sortBy] || "last_activity";
    const baseParams: unknown[] = searchValue ? [searchValue] : [];
    const paramOffset = baseParams.length;

    const query = `
      SELECT u.id, u.name, u.email, u.created_at AS joined_at,
        cp.global_ats_score, cp.global_ats_label, cp.resume_filename, cp.phone,
        cp.linkedin_url, cp.global_ats_updated_at, cp.bio,
        COUNT(DISTINCT ja.id) AS total_applications,
        COUNT(DISTINCT CASE WHEN ja.status = 'interview_scheduled' THEN ja.id END) AS pending_interviews,
        COUNT(DISTINCT CASE WHEN ja.status IN ('interview_completed','selected','rejected') THEN ja.id END) AS completed_interviews,
        COUNT(DISTINCT CASE WHEN ja.status = 'selected' THEN ja.id END) AS selected_count,
        COUNT(DISTINCT CASE WHEN ja.status = 'rejected' THEN ja.id END) AS rejected_count,
        COUNT(DISTINCT CASE WHEN ja.status = 'ats_failed' THEN ja.id END) AS ats_failed_count,
        ROUND(AVG(ae.score)::numeric, 1) AS avg_job_ats,
        MAX(ae.score) AS best_ats_score,
        GREATEST(MAX(ja.applied_at), u.created_at) AS last_activity,
        (SELECT MAX((i.scorecard->>'overall')::float) FROM interviews i
         JOIN interview_tokens it2 ON it2.token = i.token
         JOIN job_applications ja2 ON ja2.interview_token_id = it2.id
         WHERE ja2.candidate_id = u.id AND i.scorecard IS NOT NULL) AS best_interview_score,
        (SELECT MAX(CASE WHEN (i.scorecard->>'combinedScore') IS NOT NULL
           THEN (i.scorecard->>'combinedScore')::float
           ELSE (i.scorecard->>'overall')::float END)
         FROM interviews i
         JOIN interview_tokens it2 ON it2.token = i.token
         JOIN job_applications ja2 ON ja2.interview_token_id = it2.id
         WHERE ja2.candidate_id = u.id AND i.scorecard IS NOT NULL) AS best_combined_score
      FROM users u
      LEFT JOIN candidate_profiles cp ON cp.user_id = u.id
      LEFT JOIN job_applications ja   ON ja.candidate_id = u.id
      LEFT JOIN ats_evaluations ae    ON ae.candidate_id = u.id AND ae.is_global = false
      WHERE u.role = 'candidate' ${searchFilter} ${stageClause}
      GROUP BY u.id, u.name, u.email, u.created_at, cp.global_ats_score, cp.global_ats_label,
               cp.resume_filename, cp.phone, cp.linkedin_url, cp.global_ats_updated_at, cp.bio
      ORDER BY ${orderCol} ${sortDir} NULLS LAST
      LIMIT $${paramOffset + 1} OFFSET $${paramOffset + 2}`;

    const countQuery = `
      SELECT COUNT(*) AS total FROM users u
      LEFT JOIN candidate_profiles cp ON cp.user_id = u.id
      LEFT JOIN job_applications ja   ON ja.candidate_id = u.id
      WHERE u.role = 'candidate' ${searchFilter} ${stageClause}`;

    const [dataRes, countRes] = await Promise.all([
      pool.query(query, [...baseParams, pageSize, offset]),
      pool.query(countQuery, baseParams),
    ]);

    const statsRes = await pool.query(`
      SELECT
        COUNT(DISTINCT u.id) AS total_candidates,
        COUNT(DISTINCT CASE WHEN ja.status = 'interview_scheduled' THEN u.id END) AS pending_review,
        COUNT(DISTINCT CASE WHEN ja.status = 'selected' THEN u.id END) AS selected,
        COUNT(DISTINCT CASE WHEN ja.status = 'ats_failed' THEN u.id END) AS ats_failed,
        ROUND(AVG(cp.global_ats_score)::numeric, 1) AS avg_global_ats
      FROM users u
      LEFT JOIN candidate_profiles cp ON cp.user_id = u.id
      LEFT JOIN job_applications ja   ON ja.candidate_id = u.id
      WHERE u.role = 'candidate'`);

    return res.json({
      candidates: dataRes.rows,
      total: parseInt(countRes.rows[0]?.total || "0"),
      page, pageSize, stats: statsRes.rows[0],
    });
  } catch (err) {
    console.error("[Admin:candidates]", err);
    return res.status(500).json({ error: "Failed to fetch candidates" });
  }
});

// GET /api/admin/candidates/:id
router.get("/candidates/:id", requireHR, async (req: Request, res: Response) => {
  try {
    const candidateId = req.params.id;
    const profileRes = await pool.query(
      `SELECT u.id, u.name, u.email, u.created_at AS joined_at, cp.*
       FROM users u LEFT JOIN candidate_profiles cp ON cp.user_id = u.id
       WHERE u.id = $1 AND u.role = 'candidate'`,
      [candidateId]
    );
    if (profileRes.rows.length === 0) return res.status(404).json({ error: "Candidate not found" });
    const profile = profileRes.rows[0];

    const appsRes = await pool.query(
      `SELECT ja.id AS application_id, ja.status AS application_status, ja.applied_at, ja.updated_at,
         j.id AS job_id, j.title AS job_title, j.department, j.location, j.employment_type, j.level_tag,
         o.name AS org_name, ae.id AS ats_evaluation_id, ae.score AS ats_score, ae.label AS ats_label,
         ae.matched_skills, ae.missing_skills, ae.suggestions AS ats_suggestions, ae.skill_coverage,
         ae.explanation AS ats_explanation, ae.full_result AS ats_full_result,
         it.id AS token_id, it.token AS interview_token, it.interview_url,
         it.status AS interview_status, it.result AS interview_result, it.expires_at,
         i.id AS interview_id, i.scorecard, i.status AS raw_interview_status,
         i.started_at, i.ended_at, i.duration,
         (SELECT COUNT(*) FROM transcript_entries te WHERE te.interview_id = i.id) AS transcript_count
       FROM job_applications ja
       JOIN jobs j ON j.id = ja.job_id JOIN organizations o ON o.id = j.org_id
       LEFT JOIN ats_evaluations ae ON ae.id = ja.ats_evaluation_id
       LEFT JOIN interview_tokens it ON it.id = ja.interview_token_id
       LEFT JOIN interviews i ON i.token = it.token
       WHERE ja.candidate_id = $1 ORDER BY ja.applied_at DESC`,
      [candidateId]
    );

    const appsWithProctoring = await Promise.all(
      appsRes.rows.map(async (app) => {
        if (!app.interview_id) return { ...app, proctoring_summary: null, proctoring_events: [] };
        const procRes = await pool.query(
          `SELECT type, severity, message, created_at,
                  CASE WHEN photo IS NOT NULL THEN encode(photo, 'base64') ELSE NULL END AS photo
           FROM proctoring_events WHERE interview_id = $1 ORDER BY created_at ASC`,
          [app.interview_id]
        );
        const events = procRes.rows.map((e: any) => ({
          ...e, photo: e.photo ? `data:image/webp;base64,${e.photo}` : null,
        }));
        const summary = {
          total: events.length,
          warnings: events.filter((e: any) => e.severity === "warning").length,
          flags: events.filter((e: any) => e.severity === "flag").length,
          by_type: events.reduce((acc: Record<string, number>, e: any) => {
            acc[e.type] = (acc[e.type] || 0) + 1; return acc;
          }, {}),
        };
        return { ...app, proctoring_summary: summary, proctoring_events: events };
      })
    );

    return res.json({ profile, applications: appsWithProctoring });
  } catch (err) {
    console.error("[Admin:candidate/:id]", err);
    return res.status(500).json({ error: "Failed to fetch candidate" });
  }
});

// PATCH /api/admin/candidates/:id/decide
router.patch("/candidates/:id/decide", requireHR, async (req: Request, res: Response) => {
  try {
    const candidateId = req.params.id;
    const { applicationId, decision } = req.body;
    if (!applicationId || !["Selected", "Rejected"].includes(decision)) {
      return res.status(400).json({ error: "applicationId and decision (Selected|Rejected) required" });
    }

    const appRes = await pool.query(
      `SELECT ja.id, ja.interview_token_id, it.token FROM job_applications ja
       LEFT JOIN interview_tokens it ON it.id = ja.interview_token_id
       WHERE ja.id = $1 AND ja.candidate_id = $2`,
      [applicationId, candidateId]
    );
    if (appRes.rows.length === 0) return res.status(404).json({ error: "Application not found" });
    const app = appRes.rows[0];
    const appStatus = decision === "Selected" ? "selected" : "rejected";

    await pool.query("UPDATE job_applications SET status = $1, updated_at = NOW() WHERE id = $2", [appStatus, applicationId]);

    if (app.interview_token_id) {
      await pool.query(
        "UPDATE interview_tokens SET result = $1, status = 'completed', updated_at = NOW() WHERE id = $2",
        [decision, app.interview_token_id]
      );
    }

    try {
      await pool.query(
        `UPDATE ats_evaluations SET full_result = COALESCE(full_result, '{}'::jsonb) ||
         jsonb_build_object('admin_decision', $1, 'decided_at', NOW()::text, 'decided_by', $2)
         WHERE id = (SELECT ats_evaluation_id FROM job_applications WHERE id = $3 AND ats_evaluation_id IS NOT NULL)`,
        [decision, (req as any).user?.email, applicationId]
      );
    } catch (auditErr) {
      console.warn("[Admin:decide] audit trail write failed (non-fatal):", auditErr);
    }

    try {
      const emailRes = await pool.query(
        `SELECT u.name, u.email, j.title AS job_title, o.name AS org_name
         FROM job_applications ja JOIN users u ON u.id = ja.candidate_id
         JOIN jobs j ON j.id = ja.job_id LEFT JOIN organizations o ON o.id = j.org_id
         WHERE ja.id = $1`,
        [applicationId]
      );
      if (emailRes.rows.length > 0) {
        const { name, email, job_title, org_name } = emailRes.rows[0];
        if (decision === "Selected") {
          sendSelectionEmail(email, name || email, job_title, org_name).catch(console.error);
        } else {
          sendRejectionEmail(email, name || email, job_title, org_name).catch(console.error);
        }
      }
    } catch (emailErr) {
      console.warn("[Admin:decide] email send failed (non-fatal):", emailErr);
    }

    return res.json({ success: true, decision, applicationId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Admin:decide]", msg);
    return res.status(500).json({ error: msg });
  }
});

// GET /api/admin/tasks
router.get("/tasks", requireSession, async (req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, title, description, deadline, created_at,
              (SELECT COUNT(*) FROM task_submissions ts WHERE ts.task_id = ct.id) AS submission_count
         FROM candidate_tasks ct ORDER BY created_at DESC`
    );
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ error: "Failed" });
  }
});

// POST /api/admin/tasks
router.post("/tasks", requireSession, async (req: Request, res: Response) => {
  try {
    const { title, description, deadline } = req.body;
    if (!title?.trim() || !description?.trim() || !deadline) {
      return res.status(400).json({ error: "title, description, and deadline are required" });
    }
    const deadlineDate = new Date(deadline);
    if (isNaN(deadlineDate.getTime()) || deadlineDate <= new Date()) {
      return res.status(400).json({ error: "deadline must be a valid future date" });
    }
    const { rows } = await pool.query(
      `INSERT INTO candidate_tasks (title, description, deadline) VALUES ($1,$2,$3)
       RETURNING id, title, description, deadline, created_at`,
      [title.trim(), description.trim(), deadlineDate]
    );
    return res.json({ ok: true, task: rows[0] });
  } catch (err) {
    return res.status(500).json({ error: "Failed" });
  }
});

// DELETE /api/admin/tasks
router.delete("/tasks", requireSession, async (req: Request, res: Response) => {
  try {
    const id = req.query.id as string;
    if (!id) return res.status(400).json({ error: "id required" });
    const { rows: subs } = await pool.query("SELECT id FROM task_submissions WHERE task_id = $1 LIMIT 1", [id]);
    if (subs.length > 0) return res.status(409).json({ error: "Cannot delete a task that has submissions" });
    await pool.query("DELETE FROM candidate_tasks WHERE id = $1", [id]);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: "Failed" });
  }
});

// GET /api/admin/task-assignments
router.get("/task-assignments", requireSession, async (req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(`
      SELECT t.id, t.title, t.description, t.deadline, t.duration_hours,
             t.created_by, t.candidate_id, t.application_id, t.status, t.created_at,
             u.name AS candidate_name, u.email AS candidate_email,
             (SELECT COUNT(*) FROM task_submission_records tsr WHERE tsr.task_id = t.id) AS submission_count,
             (SELECT row_to_json(tsr) FROM task_submission_records tsr WHERE tsr.task_id = t.id ORDER BY tsr.submitted_at DESC LIMIT 1) AS latest_submission
      FROM tasks t LEFT JOIN users u ON u.id::text = t.candidate_id
      ORDER BY t.created_at DESC`);
    return res.json(rows);
  } catch (err) {
    console.error("[TaskAssignments:GET]", err);
    return res.status(500).json({ error: "Failed to fetch tasks" });
  }
});

// POST /api/admin/task-assignments
router.post("/task-assignments", requireSession, async (req: Request, res: Response) => {
  try {
    const { title, description, deadline, candidateId, applicationId, durationHours } = req.body;
    if (!title?.trim() || !description?.trim() || !candidateId?.trim()) {
      return res.status(400).json({ error: "title, description, and candidateId are required" });
    }
    if (!deadline && !durationHours) return res.status(400).json({ error: "Either deadline or durationHours is required" });

    let resolvedDeadline: Date;
    if (deadline) {
      resolvedDeadline = new Date(deadline);
      if (isNaN(resolvedDeadline.getTime()) || resolvedDeadline <= new Date()) {
        return res.status(400).json({ error: "deadline must be a valid future datetime" });
      }
    } else {
      const hours = parseFloat(durationHours);
      if (isNaN(hours) || hours <= 0) return res.status(400).json({ error: "durationHours must be a positive number" });
      resolvedDeadline = new Date(Date.now() + hours * 3600000);
    }

    const { rows: userRows } = await pool.query(
      "SELECT id, name, email FROM users WHERE id = $1::uuid AND role = 'candidate'",
      [candidateId]
    );
    if (userRows.length === 0) return res.status(404).json({ error: "Candidate not found" });

    const adminId = (req as any).user?.email || "admin";
    const { rows } = await pool.query(
      `INSERT INTO tasks (title, description, deadline, duration_hours, created_by, candidate_id, application_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, title, description, deadline, candidate_id, application_id, status, created_at`,
      [title.trim(), description.trim(), resolvedDeadline, durationHours ? parseFloat(durationHours) : null, adminId, candidateId, applicationId || null]
    );
    const taskId = rows[0].id;
    const { rows: verify } = await pool.query("SELECT id FROM tasks WHERE id = $1", [taskId]);
    console.log(`[TaskAssignments:POST] persistence check: ${verify.length > 0 ? "CONFIRMED" : "FAILED"}`);
    return res.json({ ok: true, task: rows[0], candidateName: userRows[0].name });
  } catch (err) {
    console.error("[TaskAssignments:POST]", err);
    return res.status(500).json({ error: "Failed" });
  }
});

// PATCH /api/admin/task-assignments/:id
router.patch("/task-assignments/:id", requireSession, async (req: Request, res: Response) => {
  try {
    const { decision } = req.body;
    if (!["selected", "rejected", "pending"].includes(decision)) {
      return res.status(400).json({ error: "decision must be selected, rejected, or pending" });
    }
    const { rowCount } = await pool.query(
      "UPDATE task_submission_records SET decision = $1 WHERE id = $2",
      [decision, req.params.id]
    );
    if (rowCount === 0) return res.status(404).json({ error: "Submission not found" });
    return res.json({ ok: true, decision });
  } catch (err) {
    return res.status(500).json({ error: "Failed" });
  }
});

// DELETE /api/admin/task-assignments/:id
router.delete("/task-assignments/:id", requireSession, async (req: Request, res: Response) => {
  try {
    const { rows: subs } = await pool.query(
      "SELECT id FROM task_submission_records WHERE task_id = $1 LIMIT 1",
      [req.params.id]
    );
    if (subs.length > 0) return res.status(409).json({ error: "Cannot delete a task that has submissions" });
    const { rowCount } = await pool.query("DELETE FROM tasks WHERE id = $1", [req.params.id]);
    if (rowCount === 0) return res.status(404).json({ error: "Task not found" });
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: "Failed" });
  }
});

// GET /api/admin/task-submissions
router.get("/task-submissions", requireSession, async (req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(
      `SELECT s.id, s.task_id, s.candidate_id, s.candidate_name,
              s.repo_url, s.submitted_at, s.status, s.evaluation_id,
              s.decision, s.evaluation_result,
              t.title as task_title, t.description as task_description, t.deadline
         FROM task_submissions s JOIN candidate_tasks t ON t.id = s.task_id
        ORDER BY s.submitted_at DESC`
    );

    const syncPromises = rows
      .filter((r: any) => r.status === "evaluating" && r.evaluation_id)
      .map(async (r: any) => {
        try {
          const evalRes = await fetch(`${TASK_EVAL_API_URL}/api/evaluate/${r.evaluation_id}`, {
            signal: AbortSignal.timeout(8000),
          });
          if (!evalRes.ok) return;
          const data = await evalRes.json();
          if (data.status === "completed" || data.status === "failed") {
            await pool.query("UPDATE task_submissions SET status='evaluated', evaluation_result=$1 WHERE id=$2", [JSON.stringify(data), r.id]);
            r.status = "evaluated"; r.evaluation_result = data;
          }
        } catch { }
      });
    await Promise.allSettled(syncPromises);
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ error: "Failed" });
  }
});

// PATCH /api/admin/task-submissions/:id
router.patch("/task-submissions/:id", requireSession, async (req: Request, res: Response) => {
  try {
    const { decision } = req.body;
    if (!["selected", "rejected", "pending"].includes(decision)) {
      return res.status(400).json({ error: "decision must be selected, rejected, or pending" });
    }
    const { rowCount } = await pool.query("UPDATE task_submissions SET decision=$1 WHERE id=$2", [decision, req.params.id]);
    if (rowCount === 0) return res.status(404).json({ error: "Not found" });
    return res.json({ ok: true, decision });
  } catch (err) {
    return res.status(500).json({ error: "Failed" });
  }
});

// GET /api/admin/debug/tasks
router.get("/debug/tasks", requireSession, async (req: Request, res: Response) => {
  try {
    const [assignedRes, globalRes, submissionRes] = await Promise.all([
      pool.query(`SELECT t.id, t.title, t.candidate_id, t.status, t.deadline, t.created_at,
                         u.name AS candidate_name, u.email AS candidate_email
                  FROM tasks t LEFT JOIN users u ON u.id::text = t.candidate_id ORDER BY t.created_at DESC`),
      pool.query(`SELECT id, title, deadline, created_at,
                         (SELECT COUNT(*) FROM task_submissions ts WHERE ts.task_id = ct.id) AS submissions
                  FROM candidate_tasks ct ORDER BY created_at DESC`),
      pool.query(`SELECT id, task_id, candidate_id, status, submitted_at FROM task_submission_records ORDER BY submitted_at DESC LIMIT 20`),
    ]);
    return res.json({
      assigned_tasks: { count: assignedRes.rows.length, rows: assignedRes.rows },
      global_tasks: { count: globalRes.rows.length, rows: globalRes.rows },
      submission_records: { count: submissionRes.rows.length, rows: submissionRes.rows },
      db_url_prefix: (process.env.DATABASE_URL || "").replace(/:[^:@]+@/, ":***@"),
    });
  } catch (err) {
    return res.status(500).json({ error: "Failed" });
  }
});

export default router;
