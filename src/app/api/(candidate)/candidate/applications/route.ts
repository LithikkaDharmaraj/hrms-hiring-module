import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { pool } from "@/lib/db";

export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const user = session.user as { id: string; role: string };
    if (user.role !== "candidate") return NextResponse.json({ error: "Candidates only" }, { status: 403 });

    const { searchParams } = new URL(req.url);
    const statusFilter = searchParams.get("status");

    let query = `
      SELECT
        ja.id, ja.status, ja.applied_at, ja.updated_at,
        j.title as job_title, j.department, j.location, j.employment_type, j.org_id,
        o.name as org_name,
        -- ATS: candidates see pass/fail + suggestions only, not the raw score
        (ae.score >= 50) as ats_passed,
        ae.suggestions,
        it.interview_url, it.token as interview_token,
        it.status as interview_status, it.result as interview_result, it.expires_at
      FROM job_applications ja
      JOIN jobs j ON j.id = ja.job_id
      JOIN organizations o ON o.id = j.org_id
      LEFT JOIN ats_evaluations ae ON ae.id = ja.ats_evaluation_id
      LEFT JOIN interview_tokens it ON it.id = ja.interview_token_id
      WHERE ja.candidate_id = $1`;

    const values: unknown[] = [user.id];
    if (statusFilter) {
      query += " AND ja.status = $2";
      values.push(statusFilter);
    }
    query += " ORDER BY ja.applied_at DESC";

    const { rows } = await pool.query(query, values);

    // Sync interview_tokens status from interviews table (real-time status)
    const syncedRows = await Promise.all(
      rows.map(async (row) => {
        if (row.interview_token) {
          const intRow = await pool.query(
            "SELECT status FROM interviews WHERE token=$1",
            [row.interview_token]
          );
          if (intRow.rows.length > 0) {
            const int = intRow.rows[0];
            if (int.status === "completed" && row.interview_status !== "completed") {
              await pool.query(
                "UPDATE interview_tokens SET status='completed', updated_at=NOW() WHERE token=$1",
                [row.interview_token]
              );
              row.interview_status = "completed";
            }
          }
        }

        // Map application status to candidate-friendly display status
        row.display_status = mapStatus(row.status, row.interview_status, row.interview_result);
        return row;
      })
    );

    const stats = {
      total: syncedRows.length,
      ats_passed: syncedRows.filter((r) => r.ats_passed).length,
      interviews_scheduled: syncedRows.filter((r) => r.interview_status === "pending").length,
      completed: syncedRows.filter((r) => r.interview_status === "completed").length,
      selected: syncedRows.filter((r) => r.interview_result === "Selected").length,
    };

    return NextResponse.json({ applications: syncedRows, stats });
  } catch (err) {
    console.error("[CandidateApplications:GET]", err);
    return NextResponse.json({ error: "Failed to fetch applications" }, { status: 500 });
  }
}

function mapStatus(appStatus: string, interviewStatus: string | null, interviewResult: string | null): string {
  if (interviewResult === "Selected") return "hired";
  if (interviewResult === "Rejected" || appStatus === "rejected") return "not_hired";
  if (appStatus === "selected") return "hired";
  if (interviewStatus === "completed" || appStatus === "interview_completed") return "under_review";
  if (appStatus === "interview_scheduled" && interviewStatus === "pending") return "interview_ready";
  if (appStatus === "ats_failed") return "ats_failed";
  if (appStatus === "ats_error" || appStatus === "interview_error") return "error";
  return "applied";
}
