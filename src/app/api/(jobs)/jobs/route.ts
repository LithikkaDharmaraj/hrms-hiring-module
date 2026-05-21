import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { pool } from "@/lib/db";
import { v4 as uuidv4 } from "uuid";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status") || "open";
    const search = searchParams.get("search") || "";
    const department = searchParams.get("department") || "";
    const location = searchParams.get("location") || "";
    const employment_type = searchParams.get("employment_type") || "";

    let query = `
      SELECT j.*, o.name as org_name,
             (SELECT COUNT(*) FROM job_applications ja WHERE ja.job_id = j.id) as application_count
      FROM jobs j
      JOIN organizations o ON o.id = j.org_id
      WHERE j.status = $1`;
    const values: unknown[] = [status];
    let idx = 2;

    if (search) {
      query += ` AND (j.title ILIKE $${idx} OR j.description ILIKE $${idx})`;
      values.push(`%${search}%`);
      idx++;
    }
    if (department) {
      query += ` AND j.department ILIKE $${idx}`;
      values.push(`%${department}%`);
      idx++;
    }
    if (location) {
      query += ` AND j.location ILIKE $${idx}`;
      values.push(`%${location}%`);
      idx++;
    }
    if (employment_type) {
      query += ` AND j.employment_type = $${idx}`;
      values.push(employment_type);
      idx++;
    }

    query += " ORDER BY j.created_at DESC LIMIT 100";

    const { rows } = await pool.query(query, values);
    return NextResponse.json({ jobs: rows });
  } catch (err) {
    console.error("[Jobs:GET]", err);
    return NextResponse.json({ error: "Failed to fetch jobs" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const user = session.user as { id: string; role: string; orgId: string };
    if (user.role !== "admin" && user.role !== "interviewer") {
      return NextResponse.json({ error: "Only HR users can post jobs" }, { status: 403 });
    }

    const { title, description, requirements, department, location, employment_type, role_tag, level_tag, interview_duration } =
      await req.json();

    if (!title || !description) {
      return NextResponse.json({ error: "Title and description are required" }, { status: 400 });
    }

    const jobId = uuidv4();
    await pool.query(
      `INSERT INTO jobs
         (id, org_id, title, description, requirements, department, location,
          employment_type, role_tag, level_tag, interview_duration, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'open',$12)`,
      [
        jobId,
        user.orgId,
        title,
        description,
        requirements || null,
        department || null,
        location || "Remote",
        employment_type || "full-time",
        role_tag || title,
        level_tag || "mid",
        interview_duration || 30,
        user.id,
      ]
    );

    const { rows } = await pool.query("SELECT * FROM jobs WHERE id=$1", [jobId]);
    return NextResponse.json({ job: rows[0] }, { status: 201 });
  } catch (err) {
    console.error("[Jobs:POST]", err);
    return NextResponse.json({ error: "Failed to create job" }, { status: 500 });
  }
}
