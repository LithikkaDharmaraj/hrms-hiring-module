import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { pool } from "@/lib/db";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const { rows } = await pool.query(
      `SELECT j.*, o.name as org_name FROM jobs j
       JOIN organizations o ON o.id = j.org_id
       WHERE j.id = $1`,
      [params.id]
    );
    if (rows.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ job: rows[0] });
  } catch (err) {
    console.error("[Jobs/:id GET]", err);
    return NextResponse.json({ error: "Failed to fetch job" }, { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const user = session.user as { role: string; orgId: string };
    if (user.role !== "admin" && user.role !== "interviewer") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const allowed = ["title", "description", "requirements", "department", "location", "employment_type", "role_tag", "level_tag", "interview_duration", "status"];
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    for (const key of allowed) {
      if (body[key] !== undefined) {
        fields.push(`${key}=$${idx++}`);
        values.push(body[key]);
      }
    }
    if (fields.length === 0) return NextResponse.json({ error: "No fields to update" }, { status: 400 });

    fields.push(`updated_at=NOW()`);
    values.push(params.id);

    await pool.query(
      `UPDATE jobs SET ${fields.join(",")} WHERE id=$${idx} AND org_id=$${idx + 1}`,
      [...values, user.orgId]
    );

    const { rows } = await pool.query("SELECT * FROM jobs WHERE id=$1", [params.id]);
    return NextResponse.json({ job: rows[0] });
  } catch (err) {
    console.error("[Jobs/:id PATCH]", err);
    return NextResponse.json({ error: "Failed to update job" }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const user = session.user as { role: string; orgId: string };
    if (user.role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });

    await pool.query("DELETE FROM jobs WHERE id=$1 AND org_id=$2", [params.id, user.orgId]);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[Jobs/:id DELETE]", err);
    return NextResponse.json({ error: "Failed to delete job" }, { status: 500 });
  }
}
