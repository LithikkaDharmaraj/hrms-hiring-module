/**
 * Orchestration Layer — Job Application Flow
 *
 * Flow: Candidate applies → ATS Service evaluates → (if eligible) Interview Service creates link
 * This layer coordinates both microservices via REST API calls.
 * It does NOT contain ATS logic or interview execution logic.
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { pool } from "@/lib/db";
import { v4 as uuidv4 } from "uuid";

const INTERNAL_KEY = process.env.INTERNAL_SERVICE_KEY || "ats-internal-key";
const BASE_URL = process.env.NEXTAUTH_URL || "http://localhost:3000";

async function callService(path: string, body: unknown) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-key": INTERNAL_KEY,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Service error ${res.status}`);
  return data;
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const user = session.user as { id: string; name: string; email: string; role: string };
    if (user.role !== "candidate") return NextResponse.json({ error: "Candidates only" }, { status: 403 });

    const { jobId } = await req.json();
    if (!jobId) return NextResponse.json({ error: "jobId required" }, { status: 400 });

    // Check for existing application (prevent duplicates)
    const existing = await pool.query(
      `SELECT ja.*, ae.score as ats_score, ae.label as ats_label, ae.suggestions,
              it.interview_url, it.status as interview_status, it.result as interview_result
       FROM job_applications ja
       LEFT JOIN ats_evaluations ae ON ae.id = ja.ats_evaluation_id
       LEFT JOIN interview_tokens it ON it.id = ja.interview_token_id
       WHERE ja.candidate_id=$1 AND ja.job_id=$2`,
      [user.id, jobId]
    );
    if (existing.rows.length > 0) {
      return NextResponse.json({ application: existing.rows[0], alreadyApplied: true });
    }

    // Fetch job details
    const jobRes = await pool.query(
      "SELECT * FROM jobs WHERE id=$1 AND status='open'",
      [jobId]
    );
    if (jobRes.rows.length === 0) {
      return NextResponse.json({ error: "Job not found or closed" }, { status: 404 });
    }
    const job = jobRes.rows[0];

    // Fetch candidate profile + resume
    const profileRes = await pool.query(
      "SELECT * FROM candidate_profiles WHERE user_id=$1",
      [user.id]
    );
    const profile = profileRes.rows[0];
    if (!profile?.resume_text) {
      return NextResponse.json({ error: "Please upload your resume before applying" }, { status: 422 });
    }

    // Create application record in 'applied' state
    const appId = uuidv4();
    await pool.query(
      "INSERT INTO job_applications (id, candidate_id, job_id, status) VALUES ($1,$2,$3,'applied')",
      [appId, user.id, jobId]
    );

    // ── STEP 1: Call ATS Service (evaluation layer) ──────────────────────────
    let atsResult;
    try {
      atsResult = await callService("/api/services/ats/evaluate", {
        resumeText: profile.resume_text,
        jobDescription: `${job.title}\n\n${job.description}\n\n${job.requirements || ""}`,
        candidateId: user.id,
        jobId,
      });
    } catch (err) {
      await pool.query(
        "UPDATE job_applications SET status='ats_error', updated_at=NOW() WHERE id=$1",
        [appId]
      );
      return NextResponse.json({ error: "ATS evaluation failed", detail: String(err) }, { status: 500 });
    }

    // Link ATS evaluation to application
    await pool.query(
      "UPDATE job_applications SET ats_evaluation_id=$1, updated_at=NOW() WHERE id=$2",
      [atsResult.evaluationId, appId]
    );

    // ATS score < 50 → not eligible
    if (!atsResult.eligible) {
      await pool.query(
        "UPDATE job_applications SET status='ats_failed', updated_at=NOW() WHERE id=$1",
        [appId]
      );
      return NextResponse.json({
        applicationId: appId,
        eligible: false,
        atsScore: atsResult.score,
        atsLabel: atsResult.label,
        matched_skills: atsResult.matched_skills,
        missing_skills: atsResult.missing_skills,
        suggestions: atsResult.suggestions,
        explanation: atsResult.explanation,
        message: "Your ATS score is below the minimum threshold (50). Improve your resume and re-apply.",
      });
    }

    // ── STEP 2: Call Interview Service (execution layer) ─────────────────────
    let interviewResult;
    try {
      interviewResult = await callService("/api/services/interview/create", {
        candidateId: user.id,
        jobId,
        applicationId: appId,
        candidateName: user.name,
        candidateEmail: user.email,
        jobTitle: job.title,
        jobDescription: job.description,
        orgId: job.org_id,
        roleTag: job.role_tag,
        levelTag: job.level_tag,
        interviewDuration: job.interview_duration,
        atsInterviewFocus: atsResult.interview_focus || null,
      });
    } catch (err) {
      await pool.query(
        "UPDATE job_applications SET status='interview_error', updated_at=NOW() WHERE id=$1",
        [appId]
      );
      return NextResponse.json({ error: "Interview creation failed", detail: String(err) }, { status: 500 });
    }

    // Link interview token to application and update status
    await pool.query(
      "UPDATE job_applications SET interview_token_id=$1, status='interview_scheduled', updated_at=NOW() WHERE id=$2",
      [interviewResult.tokenId, appId]
    );

    // Update interview_tokens with application_id back-reference
    await pool.query(
      "UPDATE interview_tokens SET application_id=$1 WHERE id=$2",
      [appId, interviewResult.tokenId]
    );

    return NextResponse.json({
      applicationId: appId,
      eligible: true,
      atsScore: atsResult.score,
      atsLabel: atsResult.label,
      matched_skills: atsResult.matched_skills,
      missing_skills: atsResult.missing_skills,
      suggestions: atsResult.suggestions,
      interviewUrl: interviewResult.interviewUrl,
      interviewToken: interviewResult.token,
      expiresAt: interviewResult.expiresAt,
      message: "Congratulations! You are eligible. Your interview link is ready.",
    });
  } catch (err) {
    console.error("[Apply]", err);
    return NextResponse.json({ error: "Application failed", detail: String(err) }, { status: 500 });
  }
}
