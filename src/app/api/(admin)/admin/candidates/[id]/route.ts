import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { pool } from "@/lib/db";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const role = (session.user as { role: string }).role;
    if (role !== "admin" && role !== "interviewer") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const candidateId = params.id;

    // 1. Candidate profile
    const profileRes = await pool.query(
      `SELECT u.id, u.name, u.email, u.created_at AS joined_at, cp.*
       FROM users u
       LEFT JOIN candidate_profiles cp ON cp.user_id = u.id
       WHERE u.id = $1 AND u.role = 'candidate'`,
      [candidateId]
    );
    if (profileRes.rows.length === 0) {
      return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
    }
    const profile = profileRes.rows[0];

    // 2. All applications with full detail (admin sees everything)
    const appsRes = await pool.query(
      `SELECT
         ja.id               AS application_id,
         ja.status           AS application_status,
         ja.applied_at,
         ja.updated_at,
         j.id                AS job_id,
         j.title             AS job_title,
         j.department,
         j.location,
         j.employment_type,
         j.level_tag,
         o.name              AS org_name,
         ae.id               AS ats_evaluation_id,
         ae.score            AS ats_score,
         ae.label            AS ats_label,
         ae.matched_skills,
         ae.missing_skills,
         ae.suggestions      AS ats_suggestions,
         ae.skill_coverage,
         ae.explanation      AS ats_explanation,
         ae.full_result      AS ats_full_result,
         it.id               AS token_id,
         it.token            AS interview_token,
         it.interview_url,
         it.status           AS interview_status,
         it.result           AS interview_result,
         it.expires_at,
         i.id                AS interview_id,
         i.scorecard,
         i.status            AS raw_interview_status,
         i.started_at,
         i.ended_at,
         i.duration,
         (SELECT COUNT(*) FROM transcript_entries te WHERE te.interview_id = i.id) AS transcript_count
       FROM job_applications ja
       JOIN jobs j            ON j.id = ja.job_id
       JOIN organizations o   ON o.id = j.org_id
       LEFT JOIN ats_evaluations ae ON ae.id = ja.ats_evaluation_id
       LEFT JOIN interview_tokens it ON it.id = ja.interview_token_id
       LEFT JOIN interviews i        ON i.token = it.token
       WHERE ja.candidate_id = $1
       ORDER BY ja.applied_at DESC`,
      [candidateId]
    );

    // 3. For each application that has an interview, fetch proctoring summary
    const appsWithProctoring = await Promise.all(
      appsRes.rows.map(async (app) => {
        if (!app.interview_id) return { ...app, proctoring_summary: null, proctoring_events: [] };

        const procRes = await pool.query(
          `SELECT type, severity, message, created_at,
                  CASE WHEN photo IS NOT NULL
                       THEN encode(photo, 'base64')
                       ELSE NULL END AS photo
           FROM proctoring_events
           WHERE interview_id = $1
           ORDER BY created_at ASC`,
          [app.interview_id]
        );

        const events = procRes.rows.map((e) => ({
          ...e,
          photo: e.photo ? `data:image/webp;base64,${e.photo}` : null,
        }));
        const summary = {
          total: events.length,
          warnings: events.filter((e) => e.severity === "warning").length,
          flags: events.filter((e) => e.severity === "flag").length,
          by_type: events.reduce((acc: Record<string, number>, e) => {
            acc[e.type] = (acc[e.type] || 0) + 1;
            return acc;
          }, {}),
        };

        return { ...app, proctoring_summary: summary, proctoring_events: events };
      })
    );

    return NextResponse.json({ profile, applications: appsWithProctoring });
  } catch (err) {
    console.error("[Admin:candidate/:id]", err);
    return NextResponse.json({ error: "Failed to fetch candidate" }, { status: 500 });
  }
}
