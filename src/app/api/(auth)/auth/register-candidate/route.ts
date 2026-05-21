import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";
import { pool } from "@/lib/db";

const CANDIDATE_ORG_ID = "00000000-0000-0000-0000-000000000002";

export async function POST(req: Request) {
  try {
    const { email, password, name } = await req.json();

    if (!email || !password || !name) {
      return NextResponse.json({ error: "Email, password, and name are required" }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
    }

    const existing = await pool.query("SELECT id FROM users WHERE email=$1", [email]);
    if (existing.rows.length > 0) {
      return NextResponse.json({ error: "Email already registered" }, { status: 409 });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const userId = uuidv4();

    await pool.query(
      "INSERT INTO users (id, email, password_hash, name, org_id, role, is_active) VALUES ($1,$2,$3,$4,$5,'candidate',true)",
      [userId, email, passwordHash, name, CANDIDATE_ORG_ID]
    );

    // Create empty candidate profile
    await pool.query(
      "INSERT INTO candidate_profiles (id, user_id) VALUES ($1,$2)",
      [uuidv4(), userId]
    );

    return NextResponse.json({ id: userId, email, name, role: "candidate" });
  } catch (err: unknown) {
    console.error("Candidate registration error:", err);
    const e = err as { code?: string };
    if (e.code === "23505") {
      return NextResponse.json({ error: "This email is already registered" }, { status: 409 });
    }
    return NextResponse.json({ error: "Registration failed. Please try again." }, { status: 500 });
  }
}
