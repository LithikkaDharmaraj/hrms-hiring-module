/**
 * Portal routes — global task pool (candidate_tasks/task_submissions tables)
 * Uses session.user.email as candidateId (legacy portal, before per-candidate task assignments)
 */
import { Router, Request, Response } from "express";
import { requireSession } from "../middleware/auth";
import { pool } from "../lib/db";

const router = Router();
router.use(requireSession);

const TASK_EVAL_API_URL = process.env.TASK_EVAL_API_URL || "http://localhost:9000";

// GET /api/portal/tasks
router.get("/tasks", async (req: Request, res: Response) => {
  try {
    const candidateId = (req as any).user.email;

    const { rows: taskRows } = await pool.query(
      `SELECT ct.id, ct.title, ct.description, ct.deadline, ct.created_at
         FROM candidate_tasks ct
        WHERE ct.deadline > NOW()
           OR EXISTS (SELECT 1 FROM task_submissions ts WHERE ts.task_id = ct.id AND ts.candidate_id = $1)
        ORDER BY ct.created_at DESC LIMIT 1`,
      [candidateId]
    );

    if (taskRows.length === 0) return res.json({ task: null, submission: null });
    const task = taskRows[0];

    const { rows: subRows } = await pool.query(
      `SELECT id, repo_url, submitted_at, status, evaluation_id, decision, evaluation_result
         FROM task_submissions WHERE task_id = $1 AND candidate_id = $2 LIMIT 1`,
      [task.id, candidateId]
    );

    return res.json({
      task: { id: task.id, title: task.title, description: task.description, deadline: task.deadline, createdAt: task.created_at },
      submission: subRows.length > 0 ? subRows[0] : null,
    });
  } catch (err) {
    return res.status(500).json({ error: "Failed" });
  }
});

// POST /api/portal/tasks/submit
router.post("/tasks/submit", async (req: Request, res: Response) => {
  try {
    const candidateId = (req as any).user.email;
    const candidateName = (req as any).user.name || null;
    const { taskId, repoUrl } = req.body;

    if (!taskId || !repoUrl?.trim()) return res.status(400).json({ error: "taskId and repoUrl are required" });
    if (!/^https?:\/\/github\.com\/[^/]+\/[^/]+/.test(repoUrl.trim())) {
      return res.status(400).json({ error: "Please enter a valid GitHub repository URL" });
    }

    const { rows: taskRows } = await pool.query("SELECT id, title, description, deadline FROM candidate_tasks WHERE id = $1", [taskId]);
    if (taskRows.length === 0) return res.status(404).json({ error: "Task not found" });
    const task = taskRows[0];
    if (new Date() > new Date(task.deadline)) return res.status(410).json({ error: "Submission deadline has passed" });

    const { rows: existing } = await pool.query("SELECT id FROM task_submissions WHERE task_id = $1 AND candidate_id = $2", [taskId, candidateId]);
    if (existing.length > 0) return res.status(409).json({ error: "You have already submitted for this task" });

    const { rows: inserted } = await pool.query(
      `INSERT INTO task_submissions (task_id, candidate_id, candidate_name, repo_url, status)
       VALUES ($1, $2, $3, $4, 'submitted') RETURNING id`,
      [taskId, candidateId, candidateName, repoUrl.trim()]
    );
    const submissionId = inserted[0].id;

    triggerEvaluation(submissionId, repoUrl.trim(), task.title, task.description).catch(
      (err) => console.error("[TaskSubmit] eval trigger failed:", err)
    );
    return res.json({ ok: true, submissionId });
  } catch (err) {
    return res.status(500).json({ error: "Failed" });
  }
});

// GET /api/portal/submissions/:id
router.get("/submissions/:id", async (req: Request, res: Response) => {
  try {
    const candidateId = (req as any).user.email;
    const { rows } = await pool.query(
      `SELECT s.id, s.task_id, s.candidate_id, s.repo_url, s.submitted_at,
              s.status, s.evaluation_id, s.decision, s.evaluation_result,
              t.title as task_title, t.description as task_description
         FROM task_submissions s JOIN candidate_tasks t ON t.id = s.task_id
        WHERE s.id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    const row = rows[0];
    if (row.candidate_id !== candidateId) return res.status(403).json({ error: "Forbidden" });

    if (row.status === "evaluating" && row.evaluation_id) {
      try {
        const evalRes = await fetch(`${TASK_EVAL_API_URL}/api/evaluate/${row.evaluation_id}`, { signal: AbortSignal.timeout(10000) });
        if (evalRes.ok) {
          const data = await evalRes.json();
          if (data.status === "completed" || data.status === "failed") {
            await pool.query("UPDATE task_submissions SET status = 'evaluated', evaluation_result = $1 WHERE id = $2", [JSON.stringify(data), req.params.id]);
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

async function triggerEvaluation(submissionId: string, repoUrl: string, taskTitle: string, taskDescription: string) {
  await pool.query("UPDATE task_submissions SET status='evaluating' WHERE id=$1", [submissionId]);
  const res = await fetch(`${TASK_EVAL_API_URL}/api/evaluate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repo_url: repoUrl, project_title: taskTitle || "Hiring Task", project_description: taskDescription || "Evaluate this candidate code submission." }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    await pool.query("UPDATE task_submissions SET status='submitted' WHERE id=$1", [submissionId]);
    throw new Error(`Eval API error ${res.status}`);
  }
  const data = await res.json();
  await pool.query("UPDATE task_submissions SET evaluation_id=$1 WHERE id=$2", [data.id, submissionId]);
}

export default router;
