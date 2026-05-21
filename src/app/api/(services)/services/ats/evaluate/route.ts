/**
 * ATS Service — Evaluation Layer
 * Primary: ATSv4 Python service (ATS_API_URL/api/v1/ats/*)
 * Fallback: LLM-based scoring if ATSv4 is unavailable
 * CONSTRAINT: No interview logic.
 */
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { v4 as uuidv4 } from "uuid";
import { inferDomain } from "@/lib/infer-domain";

const INTERNAL_KEY = process.env.INTERNAL_SERVICE_KEY || "ats-internal-key";
const ATS_API_URL = process.env.ATS_API_URL || "http://localhost:8000";

interface ATSv4KeywordsResponse {
  keyword_coverage: number;
  missing_keywords: string[];
  keyword_matches: { job_keyword: string; resume_keyword: string; similarity: number }[];
}

interface ATSv4EvaluationResponse {
  score: number;
  grade: string;
  overall_summary: string;
  strengths: string[];
  risks: string[];
  interview_focus: {
    must_probe: string[];
    strengths_to_confirm: string[];
    suggested_question_themes: string[];
    recommended_depth: string;
  };
}

/* ─── ATSv4 integration ─── */
async function callATSv4(resumeText: string, jobDescription: string): Promise<ATSResult> {
  const payload = { resume_text: resumeText, job_text: jobDescription };

  // Parallel: keywords (no LLM, fast) + evaluate (LLM evaluation)
  const [kwRes, evalRes] = await Promise.all([
    fetch(`${ATS_API_URL}/api/v1/ats/keywords`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(90000),
    }),
    fetch(`${ATS_API_URL}/api/v1/ats/evaluate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(120000),
    }),
  ]);

  if (!kwRes.ok) {
    const t = await kwRes.text().catch(() => "");
    throw new Error(`ATSv4 keywords failed ${kwRes.status}: ${t.substring(0, 200)}`);
  }
  if (!evalRes.ok) {
    const t = await evalRes.text().catch(() => "");
    throw new Error(`ATSv4 evaluate failed ${evalRes.status}: ${t.substring(0, 200)}`);
  }

  const kw: ATSv4KeywordsResponse = await kwRes.json();
  const ev: ATSv4EvaluationResponse = await evalRes.json();

  const score = Math.max(0, Math.min(100, Number(ev.score) || 0));
  const matched_skills = (kw.keyword_matches || []).map((m) => m.job_keyword);
  const missing_skills = kw.missing_keywords || [];
  const suggestions = [
    ...(ev.strengths || []).map((s) => `[strength] ${s}`),
    ...(ev.risks || []).map((r) => `[risk] ${r}`),
  ];

  return {
    score,
    label: score >= 50 ? "Pass" : "Reject",
    matched_skills,
    missing_skills,
    suggestions,
    domain: inferDomain(jobDescription),
    skill_coverage: Number(kw.keyword_coverage) || 0,
    explanation: ev.overall_summary || "",
    interview_focus: ev.interview_focus || null,
    full_result: {
      grade: ev.grade,
      overall_summary: ev.overall_summary,
      strengths: ev.strengths,
      risks: ev.risks,
      interview_focus: ev.interview_focus,
      keyword_coverage: kw.keyword_coverage,
      keyword_matches: kw.keyword_matches,
      matched_skills,
      missing_skills,
      _source: "atsv4",
    },
  };
}

/* ─── LLM fallback ─── */
async function callAI(prompt: string): Promise<string> {
  const res = await fetch(`${process.env.AI_BASE_URL}/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.AI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.AI_MODEL || "gpt-4o",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 1200,
      temperature: 0.1,
    }),
  });
  if (!res.ok) throw new Error(`AI error ${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

function parseJSON(raw: string): Record<string, unknown> {
  const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  try { return JSON.parse(cleaned); } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error("Could not parse AI JSON response");
  }
}

async function callLLMFallback(resumeText: string, jobDescription: string): Promise<ATSResult> {
  const prompt = `You are an expert ATS evaluator. Compare this resume against the job description.
Return ONLY valid JSON with NO markdown.

Resume:
${resumeText.substring(0, 4000)}

Job Description:
${jobDescription.substring(0, 2000)}

JSON format:
{
  "score": <integer 0-100>,
  "label": "<Pass if score>=50, Reject if score<50>",
  "matched_skills": ["<skill in both resume and JD>"],
  "missing_skills": ["<required skill missing from resume>"],
  "suggestions": ["<actionable improvement>"],
  "domain": "<Tech|Sales|HR|Finance|Other>",
  "skill_coverage": <0.0-1.0>,
  "explanation": "<2-3 sentence rationale>"
}`;

  const raw = await callAI(prompt);
  const r = parseJSON(raw) as Record<string, unknown>;
  const score = Math.max(0, Math.min(100, Number(r.score) || 0));
  return {
    score,
    label: score >= 50 ? "Pass" : "Reject",
    matched_skills: (r.matched_skills as string[]) || [],
    missing_skills: (r.missing_skills as string[]) || [],
    suggestions: (r.suggestions as string[]) || [],
    domain: (r.domain as string) || "Other",
    skill_coverage: Number(r.skill_coverage) || 0,
    explanation: (r.explanation as string) || "",
    interview_focus: null,
    full_result: Object.assign({}, r, { _source: "llm" }),
  };
}

interface ATSResult {
  score: number;
  label: string;
  matched_skills: string[];
  missing_skills: string[];
  suggestions: string[];
  domain: string;
  skill_coverage: number;
  explanation: string;
  interview_focus: {
    must_probe: string[];
    strengths_to_confirm: string[];
    suggested_question_themes: string[];
    recommended_depth: string;
  } | null;
  full_result: unknown;
}

export async function POST(req: Request) {
  try {
    const key = req.headers.get("x-internal-key");
    if (key !== INTERNAL_KEY) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { resumeText, jobDescription, candidateId, jobId } = await req.json();
    if (!resumeText || !jobDescription || !candidateId) {
      return NextResponse.json({ error: "resumeText, jobDescription, candidateId required" }, { status: 400 });
    }

    // Try ATSv4 first, fall back to LLM
    let result: ATSResult;
    let usedATSv4 = false;
    try {
      result = await callATSv4(resumeText, jobDescription);
      usedATSv4 = true;
      console.log(`[ATS:evaluate] ATSv4 score=${result.score} for candidate=${candidateId}`);
    } catch (atsErr) {
      console.warn(`[ATS:evaluate] ATSv4 unavailable (${(atsErr as Error).message?.substring(0, 80)}), falling back to LLM`);
      result = await callLLMFallback(resumeText, jobDescription);
    }

    const evalId = uuidv4();
    await pool.query(
      `INSERT INTO ats_evaluations
         (id, candidate_id, job_id, resume_text, score, label, matched_skills,
          missing_skills, suggestions, domain, skill_coverage, explanation, is_global, full_result)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,false,$13)`,
      [
        evalId,
        candidateId,
        jobId || null,
        resumeText.substring(0, 8000),
        result.score,
        result.score >= 50 ? "Pass" : "Reject",
        JSON.stringify(result.matched_skills),
        JSON.stringify(result.missing_skills),
        JSON.stringify(result.suggestions),
        result.domain,
        result.skill_coverage,
        result.explanation,
        JSON.stringify(result.full_result),
      ]
    );

    return NextResponse.json({
      evaluationId: evalId,
      score: result.score,
      label: result.score >= 50 ? "Pass" : "Reject",
      eligible: result.score >= 50,
      matched_skills: result.matched_skills,
      missing_skills: result.missing_skills,
      suggestions: result.suggestions,
      domain: result.domain,
      skill_coverage: result.skill_coverage,
      explanation: result.explanation,
      interview_focus: result.interview_focus,
      _source: usedATSv4 ? "atsv4" : "llm",
    });
  } catch (err: unknown) {
    console.error("[ATS:evaluate]", err);
    return NextResponse.json({ error: "ATS evaluation failed", detail: String(err) }, { status: 500 });
  }
}
