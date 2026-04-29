import { Router, Request, Response } from "express";
import { sessionMiddleware, requireHR, requireAdmin } from "../middleware/auth";
import { pool } from "../lib/db";
import { v4 as uuidv4 } from "uuid";

const router = Router();

// GET /api/jobs — public, no auth required
router.get("/", async (req: Request, res: Response) => {
  try {
    const status = (req.query.status as string) || "open";
    const search = (req.query.search as string) || "";
    const department = (req.query.department as string) || "";
    const location = (req.query.location as string) || "";
    const employment_type = (req.query.employment_type as string) || "";

    let query = `
      SELECT j.*, o.name as org_name,
             (SELECT COUNT(*) FROM job_applications ja WHERE ja.job_id = j.id) as application_count
      FROM jobs j JOIN organizations o ON o.id = j.org_id
      WHERE j.status = $1`;
    const values: unknown[] = [status];
    let idx = 2;

    if (search) { query += ` AND (j.title ILIKE $${idx} OR j.description ILIKE $${idx})`; values.push(`%${search}%`); idx++; }
    if (department) { query += ` AND j.department ILIKE $${idx}`; values.push(`%${department}%`); idx++; }
    if (location) { query += ` AND j.location ILIKE $${idx}`; values.push(`%${location}%`); idx++; }
    if (employment_type) { query += ` AND j.employment_type = $${idx}`; values.push(employment_type); idx++; }

    query += " ORDER BY j.created_at DESC LIMIT 100";
    const { rows } = await pool.query(query, values);
    return res.json({ jobs: rows });
  } catch (err) {
    console.error("[Jobs:GET]", err);
    return res.status(500).json({ error: "Failed to fetch jobs" });
  }
});

// POST /api/jobs
router.post("/", sessionMiddleware, requireHR, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const {
      title, description, requirements, department, location, employment_type,
      role_tag, level_tag, interview_duration, task_enabled, task_title, task_description, task_duration_hours,
    } = req.body;

    if (!title || !description) return res.status(400).json({ error: "Title and description are required" });

    const jobId = uuidv4();
    await pool.query(
      `INSERT INTO jobs (id, org_id, title, description, requirements, department, location,
         employment_type, role_tag, level_tag, interview_duration, status, created_by,
         task_enabled, task_title, task_description, task_duration_hours)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'open',$12,$13,$14,$15,$16)`,
      [
        jobId, user.orgId, title, description, requirements || null, department || null,
        location || "Remote", employment_type || "full-time", role_tag || title, level_tag || "mid",
        interview_duration || 30, user.id, task_enabled ? true : false,
        task_enabled ? (task_title || null) : null,
        task_enabled ? (task_description || null) : null,
        task_enabled ? (task_duration_hours ? parseInt(task_duration_hours) : 48) : null,
      ]
    );
    const { rows } = await pool.query("SELECT * FROM jobs WHERE id=$1", [jobId]);
    return res.status(201).json({ job: rows[0] });
  } catch (err) {
    console.error("[Jobs:POST]", err);
    return res.status(500).json({ error: "Failed to create job" });
  }
});

// GET /api/jobs/:id — public
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(
      `SELECT j.*, o.name as org_name FROM jobs j
       JOIN organizations o ON o.id = j.org_id WHERE j.id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    return res.json({ job: rows[0] });
  } catch (err) {
    return res.status(500).json({ error: "Failed to fetch job" });
  }
});

// PATCH /api/jobs/:id
router.patch("/:id", sessionMiddleware, requireHR, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const body = req.body;
    const allowed = [
      "title", "description", "requirements", "department", "location", "employment_type",
      "role_tag", "level_tag", "interview_duration", "status",
      "task_enabled", "task_title", "task_description", "task_duration_hours",
    ];
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    for (const key of allowed) {
      if (body[key] !== undefined) { fields.push(`${key}=$${idx++}`); values.push(body[key]); }
    }
    if (fields.length === 0) return res.status(400).json({ error: "No fields to update" });
    fields.push(`updated_at=NOW()`);
    values.push(req.params.id);

    await pool.query(`UPDATE jobs SET ${fields.join(",")} WHERE id=$${idx} AND org_id=$${idx + 1}`, [...values, user.orgId]);
    const { rows } = await pool.query("SELECT * FROM jobs WHERE id=$1", [req.params.id]);
    return res.json({ job: rows[0] });
  } catch (err) {
    return res.status(500).json({ error: "Failed to update job" });
  }
});

// DELETE /api/jobs/:id
router.delete("/:id", sessionMiddleware, requireAdmin, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    await pool.query("DELETE FROM jobs WHERE id=$1 AND org_id=$2", [req.params.id, user.orgId]);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: "Failed to delete job" });
  }
});

export default router;
