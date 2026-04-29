import { Router } from "express";
import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";
import { pool } from "../lib/db";
import { decodeNextAuthToken } from "../middleware/auth";

const router = Router();

const DEFAULT_ORG_ID = "00000000-0000-0000-0000-000000000001";
const CANDIDATE_ORG_ID = "00000000-0000-0000-0000-000000000002";

// POST /api/auth/validate — called by frontend NextAuth authorize()
router.post("/validate", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Email and password required" });

    const { rows } = await pool.query(
      `SELECT u.id, u.email, u.name, u.password_hash, u.role, u.is_active, u.org_id, o.name as org_name
       FROM users u JOIN organizations o ON u.org_id = o.id
       WHERE u.email = $1`,
      [email]
    );
    if (rows.length === 0) return res.status(401).json({ error: "Invalid credentials" });

    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: "Invalid credentials" });
    if (!user.is_active) return res.status(403).json({ error: "Account disabled" });

    return res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      orgId: user.org_id,
      orgName: user.org_name,
      role: user.role,
    });
  } catch (err) {
    console.error("[Auth:validate]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/auth/register — register HR/interviewer
router.post("/register", async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password || !name) {
      return res.status(400).json({ error: "Email, password, and name are required" });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }

    const existing = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: "Email already registered" });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const userId = uuidv4();

    await pool.query(
      "INSERT INTO users (id, email, password_hash, name, org_id, role, is_active) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [userId, email, passwordHash, name, DEFAULT_ORG_ID, "interviewer", true]
    );

    return res.json({ id: userId, email, name });
  } catch (err: any) {
    console.error("[Auth:register]", err);
    if (err.code === "23505") {
      return res.status(409).json({ error: "This email is already registered" });
    }
    return res.status(500).json({ error: "Registration failed. Please try again." });
  }
});

// POST /api/auth/register-candidate — register candidate
router.post("/register-candidate", async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password || !name) {
      return res.status(400).json({ error: "Email, password, and name are required" });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }

    const existing = await pool.query("SELECT id FROM users WHERE email=$1", [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: "Email already registered" });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const userId = uuidv4();

    await pool.query(
      "INSERT INTO users (id, email, password_hash, name, org_id, role, is_active) VALUES ($1,$2,$3,$4,$5,'candidate',true)",
      [userId, email, passwordHash, name, CANDIDATE_ORG_ID]
    );

    await pool.query(
      "INSERT INTO candidate_profiles (id, user_id) VALUES ($1,$2)",
      [uuidv4(), userId]
    );

    return res.json({ id: userId, email, name, role: "candidate" });
  } catch (err: any) {
    console.error("[Auth:register-candidate]", err);
    if (err.code === "23505") {
      return res.status(409).json({ error: "This email is already registered" });
    }
    return res.status(500).json({ error: "Registration failed. Please try again." });
  }
});

export default router;
