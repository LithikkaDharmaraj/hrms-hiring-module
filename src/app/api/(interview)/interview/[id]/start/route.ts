import { NextResponse } from "next/server";
import { updateInterview } from "@/lib/store";
import { validateAccess } from "@/lib/auth-check";
import { validateAccessPost } from "@/lib/auth-check";
import { pool } from "@/lib/db";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // Check URL token first, then try body token
  const { authorized } = await validateAccess(req, id);
  if (!authorized) {
    // Try body token
    try {
      const body = await req.clone().json();
      if (body.token && await validateAccessPost(id, body.token)) {
        // OK
      } else {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    } catch {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  // Block ATS-failed candidates from starting interview
  try {
    const eligibility = await pool.query(
      `SELECT ja.status
       FROM job_applications ja
       JOIN interview_tokens it ON it.id = ja.interview_token_id
       JOIN interviews i ON i.token = it.token
       WHERE i.id = $1`,
      [id]
    );
    if (eligibility.rows.length > 0 && eligibility.rows[0].status === "ats_failed") {
      return NextResponse.json(
        { error: "Interview not available: ATS screening was not passed." },
        { status: 403 }
      );
    }
  } catch (gateErr) {
    console.warn("[interview/start] eligibility gate check failed (non-blocking):", gateErr);
  }

  await updateInterview(id, {
    status: "in_progress",
    startedAt: new Date().toISOString(),
  });

  return NextResponse.json({ ok: true });
}
