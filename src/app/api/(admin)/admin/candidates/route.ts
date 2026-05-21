import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { pool } from "@/lib/db";

function requireHR(session: ReturnType<typeof getServerSession> extends Promise<infer T> ? T : never) {
  if (!session?.user) return false;
  const role = (session.user as { role: string }).role;
  return role === "admin" || role === "interviewer";
}

export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!requireHR(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search") || "";
    const stage = searchParams.get("stage") || "all";
    const sortBy = searchParams.get("sort") || "last_activity";
    const sortDir = searchParams.get("dir") === "asc" ? "ASC" : "DESC";
    const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
    const pageSize = 20;
    const offset = (page - 1) * pageSize;

    // Stage filter applied as HAVING or WHERE on aggregated status
    const stageFilter = {
      pending:   `AND EXISTS (SELECT 1 FROM job_applications ja2 WHERE ja2.candidate_id = u.id AND ja2.status = 'interview_scheduled')`,
      completed: `AND EXISTS (SELECT 1 FROM job_applications ja2 WHERE ja2.candidate_id = u.id AND ja2.status IN ('interview_completed','selected','rejected'))`,
      selected:  `AND EXISTS (SELECT 1 FROM job_applications ja2 WHERE ja2.candidate_id = u.id AND ja2.status = 'selected')`,
      rejected:  `AND EXISTS (SELECT 1 FROM job_applications ja2 WHERE ja2.candidate_id = u.id AND ja2.status = 'rejected' AND NOT EXISTS (SELECT 1 FROM job_applications ja3 WHERE ja3.candidate_id = u.id AND ja3.status = 'selected'))`,
      ats_failed:`AND EXISTS (SELECT 1 FROM job_applications ja2 WHERE ja2.candidate_id = u.id AND ja2.status = 'ats_failed')`,
    }[stage] || "";

    const searchFilter = search
      ? `AND (u.name ILIKE $1 OR u.email ILIKE $1)`
      : "";
    const searchValue = search ? `%${search}%` : null;

    const allowedSorts: Record<string, string> = {
      last_activity: "last_activity",
      name: "u.name",
      global_ats: "cp.global_ats_score",
      joined: "u.created_at",
      applications: "total_applications",
    };
    const orderCol = allowedSorts[sortBy] || "last_activity";

    const baseParams: unknown[] = searchValue ? [searchValue] : [];
    const paramOffset = baseParams.length;

    const query = `
      SELECT
        u.id,
        u.name,
        u.email,
        u.created_at                        AS joined_at,
        cp.global_ats_score,
        cp.global_ats_label,
        cp.resume_filename,
        cp.phone,
        cp.linkedin_url,
        cp.global_ats_updated_at,
        cp.bio,
        COUNT(DISTINCT ja.id)               AS total_applications,
        COUNT(DISTINCT CASE WHEN ja.status = 'interview_scheduled'   THEN ja.id END) AS pending_interviews,
        COUNT(DISTINCT CASE WHEN ja.status IN ('interview_completed','selected','rejected') THEN ja.id END) AS completed_interviews,
        COUNT(DISTINCT CASE WHEN ja.status = 'selected'              THEN ja.id END) AS selected_count,
        COUNT(DISTINCT CASE WHEN ja.status = 'rejected'              THEN ja.id END) AS rejected_count,
        COUNT(DISTINCT CASE WHEN ja.status = 'ats_failed'            THEN ja.id END) AS ats_failed_count,
        ROUND(AVG(ae.score)::numeric, 1)    AS avg_job_ats,
        MAX(ae.score)                       AS best_ats_score,
        GREATEST(MAX(ja.applied_at), u.created_at) AS last_activity,
        (
          SELECT MAX((i.scorecard->>'overall')::float)
          FROM interviews i
          JOIN interview_tokens it2 ON it2.token = i.token
          JOIN job_applications ja2 ON ja2.interview_token_id = it2.id
          WHERE ja2.candidate_id = u.id AND i.scorecard IS NOT NULL
        ) AS best_interview_score,
        (
          SELECT MAX(
            CASE WHEN (i.scorecard->>'combinedScore') IS NOT NULL
              THEN (i.scorecard->>'combinedScore')::float
              ELSE (i.scorecard->>'overall')::float
            END
          )
          FROM interviews i
          JOIN interview_tokens it2 ON it2.token = i.token
          JOIN job_applications ja2 ON ja2.interview_token_id = it2.id
          WHERE ja2.candidate_id = u.id AND i.scorecard IS NOT NULL
        ) AS best_combined_score
      FROM users u
      LEFT JOIN candidate_profiles cp ON cp.user_id = u.id
      LEFT JOIN job_applications ja   ON ja.candidate_id = u.id
      LEFT JOIN ats_evaluations ae    ON ae.candidate_id = u.id AND ae.is_global = false
      WHERE u.role = 'candidate'
        ${searchFilter}
        ${stageFilter}
      GROUP BY u.id, u.name, u.email, u.created_at,
               cp.global_ats_score, cp.global_ats_label, cp.resume_filename,
               cp.phone, cp.linkedin_url, cp.global_ats_updated_at, cp.bio
      ORDER BY ${orderCol} ${sortDir} NULLS LAST
      LIMIT $${paramOffset + 1} OFFSET $${paramOffset + 2}`;

    const countQuery = `
      SELECT COUNT(*) AS total
      FROM users u
      LEFT JOIN candidate_profiles cp ON cp.user_id = u.id
      LEFT JOIN job_applications ja   ON ja.candidate_id = u.id
      WHERE u.role = 'candidate'
        ${searchFilter}
        ${stageFilter}`;

    const [dataRes, countRes] = await Promise.all([
      pool.query(query, [...baseParams, pageSize, offset]),
      pool.query(countQuery, baseParams),
    ]);

    // Summary stats (all candidates, no filters)
    const statsRes = await pool.query(`
      SELECT
        COUNT(DISTINCT u.id)                                              AS total_candidates,
        COUNT(DISTINCT CASE WHEN ja.status = 'interview_scheduled' THEN u.id END) AS pending_review,
        COUNT(DISTINCT CASE WHEN ja.status = 'selected' THEN u.id END)  AS selected,
        COUNT(DISTINCT CASE WHEN ja.status = 'ats_failed' THEN u.id END) AS ats_failed,
        ROUND(AVG(cp.global_ats_score)::numeric, 1)                     AS avg_global_ats
      FROM users u
      LEFT JOIN candidate_profiles cp ON cp.user_id = u.id
      LEFT JOIN job_applications ja   ON ja.candidate_id = u.id
      WHERE u.role = 'candidate'`);

    return NextResponse.json({
      candidates: dataRes.rows,
      total: parseInt(countRes.rows[0]?.total || "0"),
      page,
      pageSize,
      stats: statsRes.rows[0],
    });
  } catch (err) {
    console.error("[Admin:candidates]", err);
    return NextResponse.json({ error: "Failed to fetch candidates" }, { status: 500 });
  }
}
