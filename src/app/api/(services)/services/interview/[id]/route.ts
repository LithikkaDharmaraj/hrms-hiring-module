/**
 * Interview Service — Session Management
 * GET: Retrieve interview token + status/result
 * PATCH: Update status and/or result
 */
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

const INTERNAL_KEY = process.env.INTERNAL_SERVICE_KEY || "ats-internal-key";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const key = req.headers.get("x-internal-key");
    if (key !== INTERNAL_KEY) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { rows } = await pool.query(
      `SELECT it.*, i.status as interview_status, i.scorecard
       FROM interview_tokens it
       LEFT JOIN interviews i ON i.token = it.token
       WHERE it.id = $1`,
      [params.id]
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const row = rows[0];
    return NextResponse.json({
      tokenId: row.id,
      token: row.token,
      interviewUrl: row.interview_url,
      status: row.status,
      result: row.result,
      expiresAt: row.expires_at,
      interviewStatus: row.interview_status,
      hasScorecard: !!row.scorecard,
    });
  } catch (err: unknown) {
    console.error("[InterviewService:get]", err);
    return NextResponse.json({ error: "Failed to retrieve interview" }, { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const key = req.headers.get("x-internal-key");
    if (key !== INTERNAL_KEY) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { status, result } = await req.json();
    const validStatuses = ["pending", "in_progress", "completed"];
    const validResults = ["Selected", "Rejected", null];

    if (status && !validStatuses.includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    if (result !== undefined && !validResults.includes(result)) {
      return NextResponse.json({ error: "Invalid result" }, { status: 400 });
    }

    const fields: string[] = ["updated_at=NOW()"];
    const values: unknown[] = [];
    let idx = 1;

    if (status) { fields.push(`status=$${idx++}`); values.push(status); }
    if (result !== undefined) { fields.push(`result=$${idx++}`); values.push(result); }
    values.push(params.id);

    await pool.query(
      `UPDATE interview_tokens SET ${fields.join(",")} WHERE id=$${idx}`,
      values
    );

    // Sync application status
    const tokenRow = await pool.query(
      "SELECT application_id FROM interview_tokens WHERE id=$1",
      [params.id]
    );
    if (tokenRow.rows[0]?.application_id) {
      const appStatus =
        result === "Selected" ? "selected" :
        result === "Rejected" ? "rejected" :
        status === "completed" ? "interview_completed" :
        status === "in_progress" ? "interview_in_progress" : undefined;

      if (appStatus) {
        await pool.query(
          "UPDATE job_applications SET status=$1, updated_at=NOW() WHERE id=$2",
          [appStatus, tokenRow.rows[0].application_id]
        );
      }
    }

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    console.error("[InterviewService:patch]", err);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
}
