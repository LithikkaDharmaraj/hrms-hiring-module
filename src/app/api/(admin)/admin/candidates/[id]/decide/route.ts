/**
 * Admin Decision Endpoint
 * PATCH /api/admin/candidates/[id]/decide
 * Body: { applicationId: string, decision: "Selected" | "Rejected" }
 *
 * Updates both interview_tokens and job_applications so the decision
 * reflects immediately in the candidate dashboard (reads the same tables).
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { pool } from "@/lib/db";
import { sendSelectionEmail, sendRejectionEmail } from "@/lib/email";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const role = (session.user as { role: string }).role;
    if (role !== "admin" && role !== "interviewer") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { applicationId, decision } = await req.json();

    if (!applicationId || !["Selected", "Rejected"].includes(decision)) {
      return NextResponse.json({ error: "applicationId and decision (Selected|Rejected) required" }, { status: 400 });
    }

    const candidateId = params.id;

    // Verify application belongs to this candidate
    const appRes = await pool.query(
      `SELECT ja.id, ja.interview_token_id, it.token
       FROM job_applications ja
       LEFT JOIN interview_tokens it ON it.id = ja.interview_token_id
       WHERE ja.id = $1 AND ja.candidate_id = $2`,
      [applicationId, candidateId]
    );
    if (appRes.rows.length === 0) {
      return NextResponse.json({ error: "Application not found" }, { status: 404 });
    }
    const app = appRes.rows[0];

    const appStatus = decision === "Selected" ? "selected" : "rejected";

    // Update job_applications status — candidate dashboard reads this
    await pool.query(
      "UPDATE job_applications SET status = $1, updated_at = NOW() WHERE id = $2",
      [appStatus, applicationId]
    ).catch((e: Error) => { throw new Error(`job_applications update failed: ${e.message}`); });

    // Update interview_tokens result — candidate dashboard reads this too
    if (app.interview_token_id) {
      await pool.query(
        "UPDATE interview_tokens SET result = $1, status = 'completed', updated_at = NOW() WHERE id = $2",
        [decision, app.interview_token_id]
      ).catch((e: Error) => { throw new Error(`interview_tokens update failed: ${e.message}`); });
    }

    // Audit trail — non-critical, never block the response
    try {
      await pool.query(
        `UPDATE ats_evaluations
           SET full_result = COALESCE(full_result, '{}'::jsonb) || jsonb_build_object('admin_decision', $1, 'decided_at', NOW()::text, 'decided_by', $2)
         WHERE id = (SELECT ats_evaluation_id FROM job_applications WHERE id = $3 AND ats_evaluation_id IS NOT NULL)`,
        [decision, (session.user as { email: string }).email, applicationId]
      );
    } catch (auditErr) {
      console.warn("[Admin:decide] audit trail write failed (non-fatal):", auditErr);
    }

    // Send hiring/rejection email (non-blocking)
    try {
      const emailRes = await pool.query(
        `SELECT u.name, u.email, j.title AS job_title, o.name AS org_name
         FROM job_applications ja
         JOIN users u ON u.id = ja.candidate_id
         JOIN jobs j ON j.id = ja.job_id
         LEFT JOIN organizations o ON o.id = j.org_id
         WHERE ja.id = $1`,
        [applicationId]
      );
      if (emailRes.rows.length > 0) {
        const { name, email, job_title, org_name } = emailRes.rows[0];
        if (decision === "Selected") {
          sendSelectionEmail(email, name || email, job_title, org_name).catch(console.error);
        } else {
          sendRejectionEmail(email, name || email, job_title, org_name).catch(console.error);
        }
      }
    } catch (emailErr) {
      console.warn("[Admin:decide] email send failed (non-fatal):", emailErr);
    }

    return NextResponse.json({ success: true, decision, applicationId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Admin:decide]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
