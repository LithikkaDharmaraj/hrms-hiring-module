/**
 * ATS Service — Global Resume Scoring
 * Evaluates overall resume quality without a specific JD.
 * Primary: ATSv4 (uses a generic JD stub + resume breakdown)
 * Fallback: LLM-based scoring
 * CONSTRAINT: No interview logic.
 */
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { v4 as uuidv4 } from "uuid";
import { inferDomain } from "@/lib/infer-domain";

const INTERNAL_KEY = process.env.INTERNAL_SERVICE_KEY || "ats-internal-key";
const ATS_API_URL = process.env.ATS_API_URL || "http://localhost:8000";

// Generic JD used when evaluating resume quality without a specific job
const GENERIC_JD = `Experienced professional with strong domain expertise.
Requirements: relevant work experience, demonstrated technical or functional skills,
clear career progression, quantified achievements, well-structured resume.`;

/* ─── ATSv4 global scoring ─── */
async function callATSv4Global(resumeText: string): Promise<GlobalATSResult | null> {
  try {
    const payload = { resume_text: resumeText, job_text: GENERIC_JD };

    const [breakdownRes, evalRes] = await Promise.all([
      fetch(`${ATS_API_URL}/api/v1/ats/breakdown`, {
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

    if (!breakdownRes.ok || !evalRes.ok) return null;

    const bd = await breakdownRes.json(); // {score, grade, semantic_similarity, keyword_coverage, section_completeness, section_scores}
    const ev = await evalRes.json();      // {score, grade, overall_summary, strengths, risks, interview_focus}

    const score = Math.max(0, Math.min(100, Number(ev.score) || Number(bd.score) || 0));
    const label = score >= 80 ? "Excellent" : score >= 65 ? "Good" : score >= 50 ? "Fair" : "Needs Work";

    // Build readable suggestions from strengths + risks
    const suggestions: string[] = [
      ...(ev.strengths || []).map((s: string) => `[strength] ${s}`),
      ...(ev.risks || []).map((r: string) => `[risk] ${r}`),
    ];

    return {
      score,
      label,
      skills: [],
      suggestions,
      domain: inferDomain(resumeText),
      years_experience: 0,
      strengths: ev.strengths || [],
      explanation: ev.overall_summary || "",
      section_scores: bd.section_scores || {},
      section_completeness: bd.section_completeness || 0,
      _source: "atsv4",
    };
  } catch (err) {
    console.warn("[ATS:global] ATSv4 unavailable:", (err as Error).message?.substring(0, 80));
    return null;
  }
}

interface GlobalATSResult {
  score: number;
  label: string;
  skills: string[];
  suggestions: string[];
  domain: string;
  years_experience: number;
  strengths: string[];
  explanation: string;
  section_scores?: Record<string, number>;
  section_completeness?: number;
  _source?: string;
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
      max_tokens: 1000,
      temperature: 0.1,
    }),
  });
  if (!res.ok) throw new Error(`AI error ${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

function parseJSON(raw: string): Record<string, unknown> {
  const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error("Could not parse AI response");
  }
}

async function callLLMGlobal(resumeText: string): Promise<GlobalATSResult> {
  const prompt = `You are an expert resume evaluator and career coach.
Evaluate the following resume for overall quality, completeness, and market readiness.
Return ONLY valid JSON with NO markdown, NO code blocks.

Resume:
${resumeText.substring(0, 5000)}

Required JSON format:
{
  "score": <integer 0-100 overall quality score>,
  "label": "<Excellent if >=80, Good if >=65, Fair if >=50, Needs Work if <50>",
  "skills": ["<key skill found in resume>"],
  "suggestions": [
    "<specific actionable improvement to strengthen the resume>",
    "<second improvement>",
    "<third improvement>",
    "<fourth improvement>",
    "<fifth improvement>"
  ],
  "domain": "<primary field: Tech|Sales|HR|Operations|Finance|Marketing|Design|Data|Other>",
  "years_experience": <estimated years of experience as integer>,
  "strengths": ["<resume strength>", "<another strength>"],
  "explanation": "<2-3 sentences on overall resume quality and market readiness>"
}

Scoring criteria:
- Contact info completeness: 10 pts
- Professional summary/objective: 10 pts
- Work experience (relevance, impact, quantification): 30 pts
- Skills section (breadth + relevance): 20 pts
- Education section: 10 pts
- Achievements/Projects/Certifications: 15 pts
- Format clarity and readability: 5 pts`;

  const raw = await callAI(prompt);
  const result = parseJSON(raw) as Record<string, unknown>;
  const score = Math.max(0, Math.min(100, Number(result.score) || 0));
  return {
    score,
    label: (result.label as string) || (score >= 80 ? "Excellent" : score >= 65 ? "Good" : score >= 50 ? "Fair" : "Needs Work"),
    skills: (result.skills as string[]) || [],
    suggestions: (result.suggestions as string[]) || [],
    domain: (result.domain as string) || "Other",
    years_experience: Number(result.years_experience) || 0,
    strengths: (result.strengths as string[]) || [],
    explanation: (result.explanation as string) || "",
    _source: "llm",
  };
}

export async function POST(req: Request) {
  try {
    const key = req.headers.get("x-internal-key");
    if (key !== INTERNAL_KEY) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { resumeText, candidateId } = await req.json();
    if (!resumeText || !candidateId) {
      return NextResponse.json({ error: "resumeText and candidateId required" }, { status: 400 });
    }

    // Try ATSv4 first, fall back to LLM
    let result: GlobalATSResult;
    const atsv4Result = await callATSv4Global(resumeText);
    if (atsv4Result) {
      result = atsv4Result;
      console.log(`[ATS:global] ATSv4 score=${result.score} for candidate=${candidateId}`);
    } else {
      result = await callLLMGlobal(resumeText);
    }

    const evalId = uuidv4();
    await pool.query(
      `INSERT INTO ats_evaluations
         (id, candidate_id, job_id, resume_text, score, label, matched_skills,
          missing_skills, suggestions, domain, explanation, is_global, full_result)
       VALUES ($1,$2,NULL,$3,$4,$5,$6,$7,$8,$9,$10,true,$11)`,
      [
        evalId,
        candidateId,
        resumeText.substring(0, 8000),
        result.score,
        result.label,
        JSON.stringify(result.skills || []),
        JSON.stringify([]),
        JSON.stringify(result.suggestions || []),
        result.domain || "Other",
        result.explanation || "",
        JSON.stringify(result),
      ]
    );

    await pool.query(
      `UPDATE candidate_profiles
         SET global_ats_score=$1, global_ats_label=$2, global_ats_result=$3, global_ats_updated_at=NOW(), updated_at=NOW()
       WHERE user_id=$4`,
      [result.score, result.label, JSON.stringify(result), candidateId]
    );

    return NextResponse.json({
      evaluationId: evalId,
      score: result.score,
      label: result.label,
      skills: result.skills || [],
      suggestions: result.suggestions || [],
      domain: result.domain || "Other",
      years_experience: result.years_experience || 0,
      strengths: result.strengths || [],
      explanation: result.explanation || "",
    });
  } catch (err: unknown) {
    console.error("[ATS:global]", err);
    return NextResponse.json(
      { error: "Global ATS scoring failed", detail: String(err) },
      { status: 500 }
    );
  }
}
