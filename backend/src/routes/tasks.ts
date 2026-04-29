/**
 * /api/tasks — unified endpoint used by both HR (task template management)
 * and candidates (portal task + submission status).
 * Role-based dispatch: HR gets CRUD for candidate_tasks; candidates get their task + submission.
 */
import { Router, Request, Response } from "express";
import { sessionMiddleware, requireSession } from "../middleware/auth";
import { pool } from "../lib/db";

const router = Router();
router.use(sessionMiddleware, requireSession);

const TASK_EVAL_API_URL = process.env.TASK_EVAL_API_URL || "http://localhost:9000";

// GET /api/tasks
router.get("/", async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;

    if (user.role === "candidate") {
      // Candidate: return the most relevant task + submission (old portal / email-based)
      const candidateId = user.email;
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
    }

    // HR: return list of candidate_tasks templates
    const jobId = req.query.jobId as string | undefined;
    let query = `SELECT id, title, description, deadline, created_at,
                        (SELECT COUNT(*) FROM task_submissions ts WHERE ts.task_id = ct.id) AS submission_count
                   FROM candidate_tasks ct`;
    const values: unknown[] = [];
    if (jobId) {
      query += " WHERE id = (SELECT task_id FROM jobs WHERE id = $1 LIMIT 1)";
      values.push(jobId);
    }
    query += " ORDER BY created_at DESC";
    const { rows } = await pool.query(query, values);
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ error: "Failed" });
  }
});

// POST /api/tasks — create task template (HR only)
router.post("/", async (req: Request, res: Response) => {
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

// DELETE /api/tasks?id=...
router.delete("/", async (req: Request, res: Response) => {
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

// GET /api/tasks/:id
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, title, description, deadline, created_at FROM candidate_tasks WHERE id = $1",
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    return res.json(rows[0]);
  } catch (err) {
    return res.status(500).json({ error: "Failed" });
  }
});

// PUT /api/tasks/:id
router.put("/:id", async (req: Request, res: Response) => {
  try {
    const { title, description, deadline } = req.body;
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;
    if (title) { fields.push(`title=$${idx++}`); values.push(title); }
    if (description) { fields.push(`description=$${idx++}`); values.push(description); }
    if (deadline) { fields.push(`deadline=$${idx++}`); values.push(new Date(deadline)); }
    if (fields.length === 0) return res.status(400).json({ error: "No fields to update" });
    values.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE candidate_tasks SET ${fields.join(",")} WHERE id=$${idx} RETURNING *`,
      values
    );
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    return res.json({ ok: true, task: rows[0] });
  } catch (err) {
    return res.status(500).json({ error: "Failed" });
  }
});

// DELETE /api/tasks/:id
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const { rows: subs } = await pool.query("SELECT id FROM task_submissions WHERE task_id = $1 LIMIT 1", [req.params.id]);
    if (subs.length > 0) return res.status(409).json({ error: "Cannot delete a task that has submissions" });
    const { rowCount } = await pool.query("DELETE FROM candidate_tasks WHERE id = $1", [req.params.id]);
    if (rowCount === 0) return res.status(404).json({ error: "Not found" });
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: "Failed" });
  }
});

// POST /api/tasks/submit — portal task submission (old email-based system)
router.post("/submit", async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const candidateId = user.email;
    const candidateName = user.name || null;
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
       VALUES ($1,$2,$3,$4,'submitted') RETURNING id`,
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

async function triggerEvaluation(submissionId: string, repoUrl: string, taskTitle: string, taskDescription: string) {
  await pool.query("UPDATE task_submissions SET status='evaluating' WHERE id=$1", [submissionId]);
  const r = await fetch(`${TASK_EVAL_API_URL}/api/evaluate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repo_url: repoUrl, project_title: taskTitle || "Hiring Task", project_description: taskDescription || "Evaluate this candidate code submission." }),
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) {
    await pool.query("UPDATE task_submissions SET status='submitted' WHERE id=$1", [submissionId]);
    throw new Error(`Eval API error ${r.status}`);
  }
  const data = await r.json() as any;
  await pool.query("UPDATE task_submissions SET evaluation_id=$1 WHERE id=$2", [data.id, submissionId]);
}

export default router;
