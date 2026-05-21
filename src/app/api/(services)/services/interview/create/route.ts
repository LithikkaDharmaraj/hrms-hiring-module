/**
 * Interview Service — Execution Layer
 * Responsibility: Create unique interview links, manage sessions, track status/results.
 * CONSTRAINT: No ATS logic, no scoring.
 */
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { v4 as uuidv4 } from "uuid";

const INTERNAL_KEY = process.env.INTERNAL_SERVICE_KEY || "ats-internal-key";
const BASE_URL = process.env.NEXTAUTH_URL || "http://localhost:3000";
const DEFAULT_ORG_ID = "00000000-0000-0000-0000-000000000001";
const INTERVIEW_EXPIRY_HOURS = 72;

export async function POST(req: Request) {
  try {
    const key = req.headers.get("x-internal-key");
    if (key !== INTERNAL_KEY) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const {
      candidateId,
      jobId,
      applicationId,
      candidateName,
      candidateEmail,
      jobTitle,
      jobDescription,
      orgId,
      roleTag,
      levelTag,
      interviewDuration,
      atsInterviewFocus,
    } = await req.json();

    if (!candidateId || !jobId || !candidateEmail) {
      return NextResponse.json(
        { error: "candidateId, jobId, candidateEmail required" },
        { status: 400 }
      );
    }

    // Prevent duplicate interview per candidate per job
    const existing = await pool.query(
      "SELECT id, token, interview_url, status, result FROM interview_tokens WHERE candidate_id=$1 AND job_id=$2",
      [candidateId, jobId]
    );
    if (existing.rows.length > 0) {
      const row = existing.rows[0];
      return NextResponse.json({
        tokenId: row.id,
        token: row.token,
        interviewUrl: row.interview_url,
        status: row.status,
        result: row.result,
        duplicate: true,
      });
    }

    // Generate secure UUID-based interview token
    const interviewId = uuidv4();
    const interviewToken = uuidv4().replace(/-/g, "");
    const interviewUrl = `${BASE_URL}/interview/${interviewId}?token=${interviewToken}`;
    const expiresAt = new Date(Date.now() + INTERVIEW_EXPIRY_HOURS * 3600 * 1000).toISOString();

    // Derive interview parameters from job info
    const role = roleTag || jobTitle || "General Role";
    // Use ATSv4 recommended_depth to calibrate level if available
    const level = atsInterviewFocus?.recommended_depth === "deep"
      ? "senior"
      : atsInterviewFocus?.recommended_depth === "surface"
      ? "junior"
      : levelTag || "mid";
    const baseFocusAreas = deriveFocusAreas(jobDescription || "", role);
    const focusAreas = atsInterviewFocus
      ? mergeATSFocusAreas(baseFocusAreas, atsInterviewFocus)
      : baseFocusAreas;

    // Create interview record (reuses existing interview execution system)
    await pool.query(
      `INSERT INTO interviews
         (id, resume, resume_file_name, candidate_email, candidate_name, token,
          browser_fingerprint, role, level, focus_areas, duration, status,
          scorecard, created_at, started_at, ended_at, expires_at, org_id, created_by)
       VALUES
         ($1, $2, $3, $4, $5, $6, NULL, $7, $8, $9, $12, 'waiting',
          NULL, NOW(), NULL, NULL, $10, $11, NULL)`,
      [
        interviewId,
        jobDescription ? `Job Application for: ${jobTitle}\n\n${jobDescription.substring(0, 2000)}` : `Job: ${jobTitle}`,
        "application_resume",
        candidateEmail,
        candidateName || candidateEmail.split("@")[0],
        interviewToken,
        role,
        level,
        focusAreas, // pass array directly — pg driver converts JS array to TEXT[]
        expiresAt,
        orgId || DEFAULT_ORG_ID,
        interviewDuration || 30,
      ]
    );

    // Create Interview Service tracking record
    const tokenId = uuidv4();
    await pool.query(
      `INSERT INTO interview_tokens
         (id, candidate_id, job_id, application_id, token, interview_url, status, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,'pending',$7)`,
      [tokenId, candidateId, jobId, applicationId || null, interviewToken, interviewUrl, expiresAt]
    );

    return NextResponse.json({
      tokenId,
      token: interviewToken,
      interviewUrl,
      interviewId,
      expiresAt,
      status: "pending",
    });
  } catch (err: unknown) {
    console.error("[InterviewService:create]", err);
    return NextResponse.json(
      { error: "Interview creation failed", detail: String(err) },
      { status: 500 }
    );
  }
}

function mergeATSFocusAreas(
  base: string[],
  focus: { must_probe?: string[]; suggested_question_themes?: string[] }
): string[] {
  const extra = [
    ...(focus.must_probe || []),
    ...(focus.suggested_question_themes || []),
  ].slice(0, 2); // cap at 2 extra areas from ATS
  const combined = [...base, ...extra];
  // deduplicate (case-insensitive) and cap at 4
  const seen = new Set<string>();
  return combined.filter((a) => {
    const k = a.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 4);
}

function deriveFocusAreas(jobDescription: string, role: string): string[] {
  const jd = jobDescription.toLowerCase();
  const r = role.toLowerCase();
  const areas: string[] = [];

  if (r.includes("engineer") || r.includes("developer") || r.includes("sde")) {
    if (jd.includes("system design") || jd.includes("architecture")) areas.push("System Design");
    if (jd.includes("sql") || jd.includes("database")) areas.push("Databases");
    if (jd.includes("api") || jd.includes("rest")) areas.push("API Development");
    areas.push("Problem Solving");
    if (areas.length < 3) areas.push("Technical Fundamentals");
  } else if (r.includes("data") || r.includes("analyst")) {
    areas.push("SQL & Data Analysis", "Statistics", "Business Insights");
  } else if (r.includes("product") || r.includes("pm")) {
    areas.push("Product Strategy", "User Research", "Prioritization");
  } else if (r.includes("sales") || r.includes("bd")) {
    areas.push("Sales Methodology", "Client Relations", "Negotiation");
  } else if (r.includes("hr") || r.includes("human resource")) {
    areas.push("Talent Acquisition", "Employee Relations", "HR Operations");
  } else {
    areas.push("Domain Knowledge", "Problem Solving", "Communication");
  }

  return areas.slice(0, 4);
}
