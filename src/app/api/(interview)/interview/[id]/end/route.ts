import { NextResponse } from "next/server";
import { getInterview, updateInterview } from "@/lib/store";
import { generateScorecard } from "@/lib/ai";
import { startScoring, completeScoring, failScoring } from "@/lib/scoring-tracker";
import { normalizeScorecard } from "@/lib/normalize-scorecard";
import { parseScorecardJSON } from "@/lib/parse-scorecard";
import { validateAccess } from "@/lib/auth-check";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // Try session-based auth first, then token from body
  let { authorized } = await validateAccess(req, id);
  if (!authorized) {
    try {
      const body = await req.json().catch(() => ({} as any));
      if (body?.token) {
        const { validateAccessPost } = await import("@/lib/auth-check");
        authorized = await validateAccessPost(id, body.token);
      }
    } catch {}
  }
  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const interview = await getInterview(id);
  if (!interview) {
    return NextResponse.json({ error: "Interview not found" }, { status: 404 });
  }

  // Log who's calling this — helps debug the "refresh completes interview" issue
  const caller = req.headers.get("referer") || "unknown";
  const ua = req.headers.get("user-agent")?.substring(0, 40) || "unknown";
  console.log(`[Interview/end] ${id} called from referer=${caller} ua=${ua} currentStatus=${interview.status}`);

  // Mark as completed
  await updateInterview(id, {
    status: "completed",
    endedAt: new Date().toISOString(),
  });

  // Sync job_applications status to interview_completed
  try {
    const { pool } = await import("@/lib/db");
    await pool.query(
      `UPDATE job_applications ja
         SET status = 'interview_completed', updated_at = NOW()
         FROM interview_tokens it
         JOIN interviews i ON i.token = it.token
         WHERE it.id = ja.interview_token_id
           AND i.id = $1
           AND ja.status NOT IN ('selected', 'rejected', 'ats_failed')`,
      [id]
    );
  } catch (syncErr) {
    console.error(`[Interview/end] Failed to sync job_application status for ${id}:`, syncErr);
  }

  // Return immediately — candidate doesn't wait
  const response = NextResponse.json({ ok: true });

  // Auto-generate scorecard in background after 3s delay
  setTimeout(async () => {
    try {
      const freshInterview = await getInterview(id);
      if (freshInterview && freshInterview.transcript.length > 0 && !freshInterview.scorecard) {
        generateScorecardInBackground(id, freshInterview);
      }
    } catch (err) {
      console.error(`[Auto-Score] Failed to fetch interview ${id}:`, err);
    }
  }, 3000);

  return response;
}

async function generateScorecardInBackground(id: string, interview: any) {
  // Check if already being scored
  if (!(await startScoring(id))) return;

  try {
    console.log(`[Auto-Score] Generating scorecard for interview ${id}...`);
    const scorecardRaw = await generateScorecard(interview);
    const parsed = parseScorecardJSON(scorecardRaw);
    const scorecard = normalizeScorecard(parsed);

    // Fetch job-specific ATS score for 70/30 weighted final score
    const { pool: dbPool } = await import("@/lib/db");
    let atsScore: number | null = null;
    try {
      const { rows: atsRows } = await dbPool.query(
        `SELECT ae.score FROM ats_evaluations ae
         JOIN job_applications ja ON ja.ats_evaluation_id = ae.id
         JOIN interview_tokens it ON it.id = ja.interview_token_id
         WHERE it.token = $1 AND ae.is_global = false
         ORDER BY ae.created_at DESC LIMIT 1`,
        [interview.token]
      );
      atsScore = atsRows[0]?.score ?? null;
    } catch {}
    if (atsScore !== null) {
      const combined = Math.round((0.7 * scorecard.overall + 0.3 * (atsScore / 20)) * 10) / 10;
      (scorecard as any).combinedScore = combined;
      (scorecard as any).atsScore = Math.round(atsScore);
    }

    await updateInterview(id, { scorecard });
    await completeScoring(id);
    console.log(`[Auto-Score] Scorecard saved for interview ${id}`);

    // Send email notifications
    try {
      const { pool } = await import("@/lib/db");
      const { sendInterviewComplete, sendRejectionEmail } = await import("@/lib/email");

      // Notify interviewer
      const { rows: userRows } = await pool.query(
        "SELECT u.email, u.name, o.name as org_name FROM users u JOIN interviews i ON u.id = i.created_by JOIN organizations o ON u.org_id = o.id WHERE i.id = $1",
        [id]
      );
      if (userRows.length > 0 && userRows[0].email) {
        const reviewUrl = `${process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL}/review/${id}`;
        const candidateLabel = interview.candidateName || interview.candidateEmail || "A candidate";
        await sendInterviewComplete(userRows[0].email, userRows[0].name || "", candidateLabel, reviewUrl);
      }

      // Auto-send rejection email to candidate if no_hire / strong_no_hire
      const rec = scorecard?.recommendation as string | undefined;
      if (rec && (rec === "no_hire" || rec === "strong_no_hire") && interview.candidateEmail) {
        const orgName = userRows[0]?.org_name || "InterviewAI";
        await sendRejectionEmail(
          interview.candidateEmail,
          interview.candidateName || interview.candidateEmail,
          interview.role,
          orgName
        );
        console.log(`[Auto-Score] Rejection email sent to ${interview.candidateEmail}`);
      }
    } catch (emailErr) {
      console.error("[Auto-Score] Failed to send notification email:", emailErr);
    }
  } catch (err) {
    await failScoring(id, (err as Error).message);
    console.error(`[Auto-Score] Failed for interview ${id}:`, err);
  }
}
