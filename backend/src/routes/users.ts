import { Router, Request, Response } from "express";
import { requireAdmin } from "../middleware/auth";
import { pool } from "../lib/db";

const router = Router();
router.use(requireAdmin);

// GET /api/users
router.get("/", async (req: Request, res: Response) => {
  try {
    const orgId = (req as any).user.orgId;
    const { rows } = await pool.query(
      "SELECT id, email, name, role, is_active, created_at FROM users WHERE org_id = $1 ORDER BY created_at DESC",
      [orgId]
    );
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ error: "Failed to fetch users" });
  }
});

// PATCH /api/users/:id
router.patch("/:id", async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const body = req.body;
    const updates: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (typeof body.is_active === "boolean") { updates.push(`is_active = $${idx++}`); values.push(body.is_active); }
    if (body.role && ["admin", "interviewer", "member"].includes(body.role)) { updates.push(`role = $${idx++}`); values.push(body.role); }
    if (updates.length === 0) return res.status(400).json({ error: "No valid fields to update" });

    values.push(req.params.id, user.orgId);
    await pool.query(`UPDATE users SET ${updates.join(", ")} WHERE id = $${idx++} AND org_id = $${idx}`, values);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: "Failed to update user" });
  }
});

// DELETE /api/users/:id
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (req.params.id === user.id) return res.status(400).json({ error: "Cannot delete your own account" });
    await pool.query("DELETE FROM users WHERE id = $1 AND org_id = $2", [req.params.id, user.orgId]);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: "Failed to delete user" });
  }
});

export default router;
