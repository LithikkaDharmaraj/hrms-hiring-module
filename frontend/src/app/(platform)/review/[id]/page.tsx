"use client";

import { useState, useEffect, useRef } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { DashboardLayout } from "@/components/DashboardLayout";

interface ScoreItem {
  dimension: string;
  score: number;
}

interface Evidence {
  dimension: string;
  quote: string;
  assessment: string;
}

interface ProctoringEvent {
  type: string;
  severity: string;
  message: string;
  timestamp: string;
}

interface TranscriptMessage {
  role: "ai" | "candidate";
  content: string;
  timestamp: string;
}

interface AtsResultData {
  score: number;
  label: string;
  grade?: string;
  matched_skills: string[];
  missing_skills: string[];
  /** Graph-traversal matches — skills covered via related nodes in the skill graph */
  inferred_skills: string[];
  skill_coverage: number;
  domain: string;
  explanation: string;
  overall_summary?: string;
  strengths?: string[];
  risks?: string[];
  interview_focus?: {
    must_probe: string[];
    strengths_to_confirm: string[];
    suggested_question_themes: string[];
    recommended_depth: string;
  } | null;
}

interface TaskEvalResult {
  id: string;
  status: string;
  overall_score: number;
  overall_grade: string;
  hiring_grade: string;
  recommendation: string;
  summary_feedback: string;
  matched_requirements: string[];
  missing_features: string[];
  improvement_suggestions: string[];
  interviewer_notes: string;
  languages: string[];
  total_files: number;
  total_findings: number;
  repo_age_days: number;
  default_branch: string;
}

interface InterviewData {
  id: string;
  candidateName: string;
  role: string;
  level: string;
  date: string;
  duration: number;
  scorecard: {
    recommendation: "strong_hire" | "hire" | "lean_hire" | "lean_no_hire" | "no_hire" | "strong_no_hire";
    overallAssessment: string;
    scores: ScoreItem[];
    strengths: string[];
    weaknesses: string[];
    evidence: Evidence[];
  } | null;
  proctoring: ProctoringEvent[];
  transcript: TranscriptMessage[];
  atsScore?: number | null;
  atsLabel?: string | null;
  atsResult?: AtsResultData | null;
  atsDomain?: string | null;
  hasRecording?: boolean;
  candidateEmail?: string;
  taskId?: string | null;
  taskDeadlineAt?: string | null;
  taskSubmittedAt?: string | null;
  taskEvalRepoUrl?: string | null;
  taskEvalId?: string | null;
  taskEvalStatus?: string | null;
  taskEvalScore?: number | null;
  taskEvalGrade?: string | null;
  taskEvalResult?: TaskEvalResult | null;
  hiringDecision?: "selected" | "rejected" | null;
}

function ScoreRing({ score, label }: { score: number; label: string }) {
  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const progress = (score / 5) * circumference;
  const color =
    score > 3.5
      ? "text-green-600"
      : score >= 2.5
        ? "text-amber-600"
        : "text-red-600";
  const strokeColor =
    score > 3.5
      ? "#16a34a"
      : score >= 2.5
        ? "#d97706"
        : "#dc2626";

  const circleRef = useRef<SVGCircleElement>(null);

  useEffect(() => {
    const el = circleRef.current;
    if (el) {
      el.style.strokeDashoffset = String(circumference);
      requestAnimationFrame(() => {
        el.style.transition = "stroke-dashoffset 1s ease-out";
        el.style.strokeDashoffset = String(circumference - progress);
      });
    }
  }, [circumference, progress]);

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative w-24 h-24">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 80 80">
          <circle cx="40" cy="40" r={radius} fill="none" stroke="#f3f4f6" strokeWidth="4" />
          <circle
            ref={circleRef}
            cx="40"
            cy="40"
            r={radius}
            fill="none"
            stroke={strokeColor}
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`text-xl font-bold leading-none ${color}`}>
            {score.toFixed(1)}
          </span>
          <span className="text-[10px] text-gray-400 leading-none mt-0.5">/5</span>
        </div>
      </div>
      <span className="text-xs text-gray-500 text-center leading-tight">
        {label}
      </span>
    </div>
  );
}

function RecommendationBadge({ recommendation }: { recommendation: string }) {
  const config: Record<string, { label: string; className: string }> = {
    strong_hire: { label: "Strong Hire", className: "badge-success" },
    hire: { label: "Hire", className: "badge-success" },
    lean_hire: { label: "Lean Hire", className: "badge-success" },
    lean_no_hire: { label: "Lean No Hire", className: "badge-warning" },
    no_hire: { label: "No Hire", className: "badge-danger" },
    strong_no_hire: { label: "Strong No Hire", className: "badge-danger" },
  };
  const c = config[recommendation] || config.no_hire;
  return <span className={c.className}>{c.label}</span>;
}

function SkeletonCard({ className = "" }: { className?: string }) {
  return (
    <div className={`card p-6 ${className}`}>
      <div className="skeleton h-5 w-32 mb-4" />
      <div className="space-y-3">
        <div className="skeleton h-4 w-full" />
        <div className="skeleton h-4 w-3/4" />
        <div className="skeleton h-4 w-1/2" />
      </div>
    </div>
  );
}

export default function ReviewPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const id = params.id as string;
  const isShareMode = searchParams.get("share") === "true";
  const [data, setData] = useState<InterviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<"evidence" | "proctoring" | "transcript" | "recording">("evidence");
  const [shareCopied, setShareCopied] = useState(false);
  const [selectionEmailSent, setSelectionEmailSent] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [decision, setDecision] = useState<"selected" | "rejected" | null>(null);
  const [savingDecision, setSavingDecision] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch(`/api/interview/${id}${isShareMode ? "?share=true" : ""}`);
        if (!res.ok) throw new Error("Interview not found");
        const json = await res.json();

        if (json.scorecard && !json.scorecard.scores) {
          const { normalizeScorecard } = await import("@/lib/normalize-scorecard");
          json.scorecard = normalizeScorecard(json.scorecard);
        }

        if (json.transcript) {
          json.transcript = json.transcript.map((t: any) => ({
            ...t,
            content: t.content || t.text || "",
          }));
        }

        setData(json);
        setDecision((json as any).hiringDecision ?? null);
      } catch (e: any) {
        setError(e.message || "Failed to load interview");
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [id]);

  // Poll task eval status while running
  useEffect(() => {
    if (!data) return;
    const status = data.taskEvalStatus;
    if (!status || status === "completed" || status === "failed") return;

    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/services/task-eval/status/${id}`);
        if (!res.ok) return;
        const json = await res.json();
        if (json.status === "completed" || json.status === "failed") {
          setData((prev) => prev ? {
            ...prev,
            taskEvalStatus: json.status,
            taskEvalScore: json.score,
            taskEvalGrade: json.grade,
            taskEvalResult: json.result,
          } : prev);
          clearInterval(timer);
        } else if (json.status) {
          setData((prev) => prev ? { ...prev, taskEvalStatus: json.status } : prev);
        }
      } catch {}
    }, 8000);

    return () => clearInterval(timer);
  }, [id, data?.taskEvalStatus]);


  if (loading) {
    return (
      <DashboardLayout>
        <div className="max-w-5xl mx-auto space-y-6">
          <SkeletonCard />
          <div className="card p-6">
            <div className="skeleton h-5 w-24 mb-6" />
            <div className="flex justify-center gap-10">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="flex flex-col items-center gap-2">
                  <div className="skeleton w-24 h-24 rounded-full" />
                  <div className="skeleton h-3 w-16" />
                </div>
              ))}
            </div>
          </div>
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </DashboardLayout>
    );
  }

  if (error || !data) {
    return (
      <DashboardLayout>
        <div className="card p-8 text-center max-w-md mx-auto animate-scale-in">
          <div className="w-12 h-12 mx-auto rounded-full bg-red-50 flex items-center justify-center mb-4">
            <svg className="w-6 h-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <p className="text-gray-700">{error || "Interview not found"}</p>
        </div>
      </DashboardLayout>
    );
  }

  if (!data.scorecard) {
    return (
      <DashboardLayout>
        <div className="card p-8 text-center max-w-md mx-auto space-y-4 animate-scale-in">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-50">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-7 w-7 text-amber-500">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-gray-900">No Scorecard Yet</h2>
          <p className="text-sm text-gray-500">
            {data.transcript?.length > 0
              ? "This interview has transcript data but hasn't been scored yet."
              : "This interview has no transcript data to score."}
          </p>
          {data.transcript?.length > 0 && (
            <button
              id="generate-scorecard-btn"
              onClick={async () => {
                const btn = document.getElementById("generate-scorecard-btn") as HTMLButtonElement;
                btn.disabled = true;
                btn.textContent = "Generating...";
                try {
                  const res = await fetch("/api/scorecard", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ interviewId: id }),
                  });
                  if (res.ok) {
                    window.location.reload();
                  } else {
                    btn.textContent = "Failed — Try Again";
                    btn.disabled = false;
                  }
                } catch {
                  btn.textContent = "Failed — Try Again";
                  btn.disabled = false;
                }
              }}
              className="btn-primary inline-flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
              Generate Scorecard
            </button>
          )}
          <a href={`/dashboard/${id}`} className="block text-xs text-gray-500 hover:text-indigo-600 transition mt-2">
            View interview details
          </a>
        </div>
      </DashboardLayout>
    );
  }

  const { scorecard, proctoring, transcript } = data;

  return (
    <DashboardLayout>
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="card p-6 animate-fade-in-up flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-xl font-bold text-gray-900">
                {data.candidateName || "Candidate"}
              </h1>
              <RecommendationBadge recommendation={scorecard.recommendation} />
            </div>
            <p className="text-sm text-gray-500">
              {data.role} ({data.level})
            </p>
          </div>
          <div className="text-sm text-gray-500 sm:text-right">
            <p>{new Date(data.date).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</p>
            <p>{data.duration} minutes</p>
            <button
              onClick={async (e) => {
                const btn = e.currentTarget;
                btn.disabled = true;
                btn.textContent = "Rescoring...";
                try {
                  const res = await fetch("/api/scorecard", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ interviewId: id }),
                  });
                  if (res.ok) {
                    btn.textContent = "Done!";
                    setTimeout(() => window.location.reload(), 1000);
                  } else {
                    btn.textContent = "Failed";
                    btn.disabled = false;
                  }
                } catch {
                  btn.textContent = "Failed";
                  btn.disabled = false;
                }
              }}
              className="mt-1 btn-secondary text-xs !px-3 !py-1.5 inline-flex items-center gap-1.5"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Rescore
            </button>
            <button
              onClick={() => {
                const shareUrl = `${window.location.origin}/review/${id}?share=true`;
                navigator.clipboard.writeText(shareUrl);
                setShareCopied(true);
                setTimeout(() => setShareCopied(false), 2000);
              }}
              className="mt-1 btn-secondary text-xs !px-3 !py-1.5 inline-flex items-center gap-1.5"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
              </svg>
              {shareCopied ? "Copied!" : "Share"}
            </button>
          </div>
        </div>

        {/* Hiring Decision — Select / Reject */}
        {!isShareMode && (
          <div className={`card p-5 animate-fade-in-up flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4
            ${decision === "selected" ? "border-green-200 bg-green-50" : decision === "rejected" ? "border-red-200 bg-red-50" : "border-gray-200"}`}>
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                decision === "selected" ? "bg-green-100" : decision === "rejected" ? "bg-red-100" : "bg-gray-100"
              }`}>
                {decision === "selected" ? (
                  <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : decision === "rejected" ? (
                  <svg className="w-5 h-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                )}
              </div>
              <div>
                <p className={`text-sm font-semibold ${
                  decision === "selected" ? "text-green-800" : decision === "rejected" ? "text-red-700" : "text-gray-700"
                }`}>
                  {decision === "selected" ? "Candidate Selected" : decision === "rejected" ? "Candidate Rejected" : "Make a hiring decision"}
                </p>
                <p className={`text-xs mt-0.5 ${
                  decision === "selected" ? "text-green-600" : decision === "rejected" ? "text-red-500" : "text-gray-400"
                }`}>
                  {decision === "selected"
                    ? `${data.candidateName} has been marked as selected`
                    : decision === "rejected"
                      ? `${data.candidateName} has been marked as rejected`
                      : "Review all sections below, then select or reject this candidate"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {decision ? (
                <button
                  disabled={savingDecision}
                  onClick={async () => {
                    setSavingDecision(true);
                    try {
                      await fetch(`/api/interview/${id}/decision`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ decision: null }),
                      });
                      setDecision(null);
                    } finally { setSavingDecision(false); }
                  }}
                  className="text-xs text-gray-500 hover:text-gray-700 underline underline-offset-2"
                >
                  Undo decision
                </button>
              ) : (
                <>
                  <button
                    disabled={savingDecision}
                    onClick={async () => {
                      setSavingDecision(true);
                      try {
                        await fetch(`/api/interview/${id}/decision`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ decision: "rejected" }),
                        });
                        setDecision("rejected");
                      } finally { setSavingDecision(false); }
                    }}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-red-200 bg-white text-red-600 text-sm font-semibold hover:bg-red-50 transition-colors disabled:opacity-50"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                    Reject
                  </button>
                  <button
                    disabled={savingDecision}
                    onClick={async () => {
                      setSavingDecision(true);
                      try {
                        await fetch(`/api/interview/${id}/decision`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ decision: "selected" }),
                        });
                        setDecision("selected");
                      } finally { setSavingDecision(false); }
                    }}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-green-600 hover:bg-green-700 text-white text-sm font-semibold transition-colors disabled:opacity-50"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    Select
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* Selection Email Banner — shown for hire / strong_hire */}
        {scorecard && (scorecard.recommendation === "hire" || scorecard.recommendation === "strong_hire") && !isShareMode && (
          <div className={`rounded-xl px-5 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 animate-fade-in-up
            ${selectionEmailSent ? "bg-green-50 border border-green-200" : "bg-indigo-50 border border-indigo-200"}`}>
            <div className="flex items-start gap-3">
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${selectionEmailSent ? "bg-green-100" : "bg-indigo-100"}`}>
                <svg className={`w-5 h-5 ${selectionEmailSent ? "text-green-600" : "text-indigo-600"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  {selectionEmailSent
                    ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  }
                </svg>
              </div>
              <div>
                <p className={`text-sm font-semibold ${selectionEmailSent ? "text-green-800" : "text-indigo-800"}`}>
                  {selectionEmailSent ? "Selection email sent!" : `${scorecard.recommendation === "strong_hire" ? "Strong Hire" : "Hire"} — send selection email?`}
                </p>
                <p className={`text-xs mt-0.5 ${selectionEmailSent ? "text-green-600" : "text-indigo-600"}`}>
                  {selectionEmailSent
                    ? `Congratulations email sent to ${data?.candidateEmail}`
                    : `Notify ${data?.candidateEmail} that they've been selected`}
                </p>
              </div>
            </div>
            {!selectionEmailSent && (
              <button
                disabled={sendingEmail}
                onClick={async () => {
                  setSendingEmail(true);
                  try {
                    const res = await fetch("/api/send-outcome-email", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ interviewId: id, type: "selection" }),
                    });
                    if (res.ok) setSelectionEmailSent(true);
                  } finally {
                    setSendingEmail(false);
                  }
                }}
                className="btn-primary shrink-0 !py-2 !px-4 text-sm disabled:opacity-60"
              >
                {sendingEmail ? "Sending..." : "Send Selection Email"}
              </button>
            )}
          </div>
        )}

        {/* ATS Pre-Screen Panel */}
        {data.atsResult && (
          <div className="card p-6 animate-fade-in-up delay-1">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wider">Role Match ATS Score</h2>
                <p className="text-xs text-gray-400 mt-0.5">for {data.role} ({data.level})</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-bold text-gray-900">{Math.round(data.atsScore ?? 0)}</span>
                <span className="text-sm text-gray-400">/100</span>
                <span className={`ml-2 px-2.5 py-0.5 rounded-full text-xs font-medium ${
                  (data.atsScore ?? 0) >= 75 ? "bg-green-100 text-green-700" :
                  (data.atsScore ?? 0) >= 50 ? "bg-amber-100 text-amber-700" :
                  "bg-red-100 text-red-700"
                }`}>
                  {data.atsLabel}
                </span>
                {data.atsDomain && (
                  <span className="px-2.5 py-0.5 rounded-full bg-indigo-50 text-indigo-600 text-xs font-medium capitalize">
                    {data.atsDomain}
                  </span>
                )}
              </div>
            </div>

            {/* Skill coverage bar */}
            <div className="mb-4">
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>Skill Coverage</span>
                <span>{Math.round((data.atsResult.skill_coverage ?? 0) * 100)}%</span>
              </div>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-indigo-500 rounded-full transition-all duration-700"
                  style={{ width: `${Math.round((data.atsResult.skill_coverage ?? 0) * 100)}%` }}
                />
              </div>
            </div>

            <div className="grid md:grid-cols-3 gap-4">
              {data.atsResult.matched_skills.length > 0 && (
                <div>
                  <h3 className="text-xs font-medium text-green-700 mb-2">Matched Skills</h3>
                  <div className="flex flex-wrap gap-1.5">
                    {data.atsResult.matched_skills.map((s) => (
                      <span key={s} className="px-2 py-0.5 bg-green-50 text-green-700 text-xs rounded-md border border-green-100">{s}</span>
                    ))}
                  </div>
                </div>
              )}
              {data.atsResult.missing_skills.length > 0 && (
                <div>
                  <h3 className="text-xs font-medium text-red-700 mb-2">Skill Gaps</h3>
                  <div className="flex flex-wrap gap-1.5">
                    {data.atsResult.missing_skills.map((s) => (
                      <span key={s} className="px-2 py-0.5 bg-red-50 text-red-700 text-xs rounded-md border border-red-100">{s}</span>
                    ))}
                  </div>
                </div>
              )}
              {(data.atsResult.inferred_skills?.length ?? 0) > 0 && (
                <div>
                  <h3 className="text-xs font-medium text-amber-700 mb-2">Graph-Inferred Skills</h3>
                  <div className="flex flex-wrap gap-1.5">
                    {data.atsResult.inferred_skills!.map((s) => (
                      <span key={s} className="px-2 py-0.5 bg-amber-50 text-amber-700 text-xs rounded-md border border-amber-100">{s}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Task Evaluation Panel — populated by candidate submission */}
        {data.taskId && (
          <div className="card p-6 animate-fade-in-up delay-1">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wider">Take-Home Task Evaluation</h2>
                {data.taskDeadlineAt && (
                  <p className="text-xs text-gray-400 mt-0.5">
                    Deadline: {new Date(data.taskDeadlineAt).toLocaleString()}
                    {!data.taskSubmittedAt && new Date() > new Date(data.taskDeadlineAt) && (
                      <span className="ml-2 text-red-500 font-medium">· Expired</span>
                    )}
                  </p>
                )}
              </div>
              {data.taskEvalStatus === "completed" && data.taskEvalScore != null && (
                <div className="flex items-center gap-2">
                  <span className="text-2xl font-bold text-gray-900">{Math.round(data.taskEvalScore)}</span>
                  <span className="text-sm text-gray-400">/100</span>
                  <span className={`ml-2 px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    data.taskEvalScore >= 75 ? "bg-green-100 text-green-700" :
                    data.taskEvalScore >= 50 ? "bg-amber-100 text-amber-700" :
                    "bg-red-100 text-red-700"
                  }`}>{data.taskEvalGrade}</span>
                </div>
              )}
            </div>

            {/* Not submitted yet */}
            {!data.taskSubmittedAt && !data.taskEvalStatus && (
              <p className="text-sm text-gray-400 italic">
                Waiting for candidate to submit their repository
                {data.taskDeadlineAt && new Date() < new Date(data.taskDeadlineAt)
                  ? ` (${Math.ceil((new Date(data.taskDeadlineAt).getTime() - Date.now()) / 3600000)}h left)`
                  : "."}
              </p>
            )}

            {/* Pending / running */}
            {data.taskEvalStatus && data.taskEvalStatus !== "completed" && data.taskEvalStatus !== "failed" && (
              <div className="flex items-center gap-3 py-2">
                <svg className="w-5 h-5 animate-spin text-indigo-500" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                  <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-75" />
                </svg>
                <div>
                  <p className="text-sm text-gray-700 font-medium">Evaluating repository…</p>
                  <p className="text-xs text-gray-400 font-mono">{data.taskEvalRepoUrl}</p>
                </div>
              </div>
            )}

            {/* Failed */}
            {data.taskEvalStatus === "failed" && (
              <p className="text-sm text-red-500">
                Evaluation failed for <span className="font-mono text-xs">{data.taskEvalRepoUrl}</span>.
              </p>
            )}

            {/* Completed results */}
            {data.taskEvalStatus === "completed" && data.taskEvalResult && (
              <div className="space-y-4">
                <div className="flex items-center gap-3 flex-wrap">
                  <a href={String(data.taskEvalRepoUrl)} target="_blank" rel="noopener noreferrer"
                    className="text-xs text-indigo-500 hover:underline font-mono">{data.taskEvalRepoUrl}</a>
                  {(data.taskEvalResult.languages as string[] | undefined)?.length ? (
                    (data.taskEvalResult.languages as string[]).map((l) => (
                      <span key={l} className="px-2 py-0.5 bg-indigo-50 text-indigo-600 text-xs rounded-md">{l}</span>
                    ))
                  ) : null}
                  {data.taskEvalResult.hiring_grade && (
                    <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                      ["A+","A","A-"].includes(String(data.taskEvalResult.hiring_grade)) ? "bg-green-100 text-green-700" :
                      ["B+","B","B-"].includes(String(data.taskEvalResult.hiring_grade)) ? "bg-blue-100 text-blue-700" :
                      ["C+","C","C-"].includes(String(data.taskEvalResult.hiring_grade)) ? "bg-amber-100 text-amber-700" :
                      "bg-red-100 text-red-700"
                    }`}>Hiring Grade: {String(data.taskEvalResult.hiring_grade)}</span>
                  )}
                  {data.taskEvalResult.recommendation && (
                    <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${
                      String(data.taskEvalResult.recommendation).includes("hire") ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"
                    }`}>{String(data.taskEvalResult.recommendation).replace(/_/g, " ")}</span>
                  )}
                  {data.taskSubmittedAt && (
                    <span className="text-xs text-gray-400">Submitted {new Date(data.taskSubmittedAt).toLocaleString()}</span>
                  )}
                </div>

                {data.taskEvalResult.summary_feedback && (
                  <p className="text-sm text-gray-700 leading-relaxed">{String(data.taskEvalResult.summary_feedback)}</p>
                )}

                <div className="grid md:grid-cols-2 gap-4">
                  {(data.taskEvalResult.matched_requirements as string[] | undefined)?.length ? (
                    <div>
                      <h3 className="text-xs font-medium text-green-700 mb-2">Matched Requirements</h3>
                      <ul className="space-y-1">
                        {(data.taskEvalResult.matched_requirements as string[]).map((r, i) => (
                          <li key={i} className="flex items-start gap-2 text-xs text-gray-700">
                            <svg className="w-3.5 h-3.5 text-green-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                            </svg>
                            {r}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {(data.taskEvalResult.missing_features as string[] | undefined)?.length ? (
                    <div>
                      <h3 className="text-xs font-medium text-red-700 mb-2">Missing Features</h3>
                      <ul className="space-y-1">
                        {(data.taskEvalResult.missing_features as string[]).map((f, i) => (
                          <li key={i} className="flex items-start gap-2 text-xs text-gray-700">
                            <svg className="w-3.5 h-3.5 text-red-400 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                            {f}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>

                {data.taskEvalResult.interviewer_notes && (
                  <div className="bg-amber-50 border border-amber-100 rounded-lg px-4 py-3">
                    <p className="text-xs font-medium text-amber-700 mb-1">LLM Interviewer Notes</p>
                    <p className="text-xs text-gray-700 leading-relaxed">{String(data.taskEvalResult.interviewer_notes)}</p>
                  </div>
                )}

                <div className="flex gap-4 text-xs text-gray-400">
                  {data.taskEvalResult.total_files != null && <span>{Number(data.taskEvalResult.total_files)} files</span>}
                  {data.taskEvalResult.total_findings != null && <span>{Number(data.taskEvalResult.total_findings)} security findings</span>}
                  {data.taskEvalResult.repo_age_days != null && <span>Repo age: {Number(data.taskEvalResult.repo_age_days)} days</span>}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Score Rings */}
        <div className="card p-6 animate-fade-in-up delay-1">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wider">Scores</h2>
            <div className="flex items-center gap-3">
              {(scorecard as any).combinedScore != null ? (
                <div className="text-right">
                  <div className="flex items-baseline gap-1">
                    <span className="text-2xl font-bold text-gray-900">{((scorecard as any).combinedScore as number).toFixed(1)}</span>
                    <span className="text-sm text-gray-400">/5</span>
                  </div>
                  <p className="text-[10px] text-gray-400">Final Score (70% interview + 30% ATS)</p>
                </div>
              ) : (scorecard as any).overall != null ? (
                <div className="text-right">
                  <div className="flex items-baseline gap-1">
                    <span className="text-2xl font-bold text-gray-900">{((scorecard as any).overall as number).toFixed(1)}</span>
                    <span className="text-sm text-gray-400">/5</span>
                  </div>
                  <p className="text-[10px] text-gray-400">Overall Score</p>
                </div>
              ) : null}
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:flex md:flex-wrap justify-center gap-4 sm:gap-6 md:gap-10">
            {scorecard.scores.map((s) => (
              <ScoreRing key={s.dimension} score={s.score} label={s.dimension} />
            ))}
          </div>
        </div>

        {/* Assessment Summary */}
        <div className="card p-6 space-y-5 animate-fade-in-up delay-2">
          <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wider">
            Assessment
          </h2>
          <p className="text-gray-700 text-sm leading-relaxed">
            {scorecard.overallAssessment}
          </p>
          <div className="grid md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-green-700">Strengths</h3>
              <ul className="space-y-1.5">
                {scorecard.strengths.map((s, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                    <svg className="w-4 h-4 text-green-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    {s}
                  </li>
                ))}
              </ul>
            </div>
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-red-700">Areas for Improvement</h3>
              <ul className="space-y-1.5">
                {scorecard.weaknesses.map((w, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                    <svg className="w-4 h-4 text-red-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                    {w}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        {/* Tabbed sections */}
        <div className="card overflow-hidden animate-fade-in-up delay-3">
          <div className="flex border-b border-gray-200">
            {(["evidence", "proctoring", "transcript", "recording"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 px-4 py-3 text-sm font-medium capitalize transition-all duration-200 relative
                  ${activeTab === tab
                    ? "text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50/30"
                    : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
                  }`}
              >
                {tab}
              </button>
            ))}
          </div>

          <div className="p-6">
            {/* Evidence */}
            {activeTab === "evidence" && (
              <div className="space-y-3 animate-fade-in">
                {scorecard.evidence.map((ev, i) => (
                  <div
                    key={i}
                    className="bg-gray-50 rounded-lg p-4 space-y-2 border border-gray-100 animate-slide-in-up"
                    style={{ animationDelay: `${i * 60}ms`, opacity: 0 }}
                  >
                    <span className="text-xs font-medium text-indigo-600 uppercase tracking-wider">
                      {ev.dimension}
                    </span>
                    <blockquote className="text-sm text-gray-500 italic border-l-2 border-gray-200 pl-3">
                      &ldquo;{ev.quote}&rdquo;
                    </blockquote>
                    <p className="text-sm text-gray-700">{ev.assessment}</p>
                  </div>
                ))}
                {scorecard.evidence.length === 0 && (
                  <p className="text-sm text-gray-500 text-center py-8">No evidence recorded</p>
                )}
              </div>
            )}

            {/* Proctoring */}
            {activeTab === "proctoring" && (
              <div className="space-y-2 animate-fade-in">
                {proctoring.length === 0 ? (
                  <div className="text-center py-8">
                    <svg className="w-8 h-8 mx-auto text-green-500 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                    <p className="text-sm text-gray-500">No proctoring alerts recorded</p>
                  </div>
                ) : (
                  proctoring.map((event, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-3 bg-gray-50 rounded-lg px-4 py-3 border border-gray-100 animate-fade-in-left"
                      style={{ animationDelay: `${i * 40}ms`, opacity: 0 }}
                    >
                      <span className={`w-2 h-2 rounded-full shrink-0 ${
                        event.severity === "flag" ? "bg-red-500" : event.severity === "warning" ? "bg-amber-500" : "bg-blue-500"
                      }`} />
                      <span className="text-xs text-gray-400 font-mono shrink-0">
                        {new Date(event.timestamp).toLocaleTimeString()}
                      </span>
                      <span className="text-sm text-gray-700">{event.message}</span>
                      <span className="ml-auto text-xs text-gray-400 capitalize">
                        {event.severity}
                      </span>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Recording */}
            {activeTab === "recording" && (
              <div className="animate-fade-in py-2">
                {data.hasRecording ? (
                  <audio controls className="w-full rounded-lg" src={`/api/recording/${data.id}`}>
                    Your browser does not support audio playback.
                  </audio>
                ) : (
                  <p className="text-sm text-gray-500 text-center py-8">No recording available for this interview.</p>
                )}
              </div>
            )}

            {/* Transcript */}
            {activeTab === "transcript" && (
              <div className="animate-fade-in">
                {transcript.length === 0 ? (
                  <p className="text-sm text-gray-500 text-center py-8">No transcript available</p>
                ) : (
                  <>
                    <p className="text-xs text-gray-400 mb-4">{transcript.length} messages in this interview</p>
                    <div className="space-y-3">
                      {transcript.map((msg, i) => (
                        <div
                          key={i}
                          className={`flex gap-3 ${msg.role === "ai" ? "" : "flex-row-reverse"}`}
                        >
                          <div
                            className={`w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-xs font-medium
                              ${msg.role === "ai"
                                ? "bg-gray-100 text-gray-600"
                                : "bg-indigo-50 text-indigo-600"
                              }`}
                          >
                            {msg.role === "ai" ? "AI" : "C"}
                          </div>
                          <div
                            className={`max-w-[85%] sm:max-w-[75%] rounded-xl px-3 sm:px-4 py-2 sm:py-2.5 text-sm
                              ${msg.role === "ai"
                                ? "bg-gray-50 text-gray-700"
                                : "bg-indigo-50 text-gray-700"
                              }`}
                          >
                            <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                            <span className="block text-[10px] text-gray-400 mt-1">
                              {new Date(msg.timestamp).toLocaleTimeString()} · {msg.role === "ai" ? "Interviewer (AI)" : "Candidate"}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
