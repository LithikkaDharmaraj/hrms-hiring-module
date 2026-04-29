"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { DashboardLayout } from "@/components/DashboardLayout";

/* ─── Types ─── */
interface Profile {
  id: string; name: string; email: string; joined_at: string;
  global_ats_score: number | null; global_ats_label: string | null;
  global_ats_result: {
    suggestions?: string[]; skills?: string[]; domain?: string;
    years_experience?: number; explanation?: string; strengths?: string[];
  } | null;
  resume_text: string | null; resume_filename: string | null;
  phone: string | null; linkedin_url: string | null;
  portfolio_url: string | null; bio: string | null;
  global_ats_updated_at: string | null;
}

interface Application {
  application_id: string; application_status: string; applied_at: string; updated_at: string;
  job_id: string; job_title: string; department: string | null; location: string;
  employment_type: string; level_tag: string | null; org_name: string;
  ats_score: number | null; ats_label: string | null;
  matched_skills: string[] | null; missing_skills: string[] | null;
  ats_suggestions: string[] | null; skill_coverage: number | null; ats_explanation: string | null;
  ats_full_result: {
    grade?: string;
    overall_summary?: string;
    strengths?: string[];
    risks?: string[];
    interview_focus?: {
      must_probe?: string[];
      strengths_to_confirm?: string[];
      suggested_question_themes?: string[];
      recommended_depth?: string;
    };
    _source?: string;
  } | null;
  token_id: string | null; interview_token: string | null;
  interview_url: string | null; interview_status: string | null;
  interview_result: string | null; expires_at: string | null;
  interview_id: string | null;
  scorecard: {
    technicalDepth?: number; communication?: number; problemSolving?: number;
    domainKnowledge?: number; cultureFit?: number; overall?: number;
    combinedScore?: number; atsScore?: number;
    recommendation?: string; summary?: string; strengths?: string[]; weaknesses?: string[];
  } | null;
  raw_interview_status: string | null; started_at: string | null; ended_at: string | null;
  duration: number | null; transcript_count: number;
  proctoring_summary: { total: number; warnings: number; flags: number; by_type: Record<string, number> } | null;
  proctoring_events: { type: string; severity: string; message: string; created_at: string; photo: string | null }[];
}

/* ─── Sub-components ─── */
function ATSRing({ score, size = 100 }: { score: number; size?: number }) {
  const r = size * 0.38; const circ = 2 * Math.PI * r;
  const color = score >= 70 ? "#10b981" : score >= 50 ? "#f59e0b" : "#ef4444";
  const cx = size / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={cx} cy={cx} r={r} fill="none" stroke="#f3f4f6" strokeWidth="9" />
      <circle cx={cx} cy={cx} r={r} fill="none" stroke={color} strokeWidth="9"
        strokeDasharray={`${(score/100)*circ} ${circ}`} strokeLinecap="round"
        transform={`rotate(-90 ${cx} ${cx})`} style={{ transition: "stroke-dasharray 1s ease" }} />
      <text x={cx} y={cx+2} textAnchor="middle" dominantBaseline="middle"
        fontSize={size*0.2} fontWeight="bold" fill="#111827">{score}</text>
      <text x={cx} y={cx+size*0.18} textAnchor="middle" dominantBaseline="middle"
        fontSize={size*0.1} fill="#9ca3af">/100</text>
    </svg>
  );
}

function ScoreBar({ label, value, max = 5 }: { label: string; value: number; max?: number }) {
  const pct = (value / max) * 100;
  const color = pct >= 70 ? "bg-emerald-500" : pct >= 50 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-gray-600 w-28 flex-shrink-0">{label}</span>
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all duration-700`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-semibold text-gray-700 w-8 text-right">{value}/{max}</span>
    </div>
  );
}

function DecisionButtons({ app, onDecide }: {
  app: Application;
  onDecide: (applicationId: string, decision: "Selected" | "Rejected") => void;
}) {
  const [loading, setLoading] = useState<"Selected" | "Rejected" | null>(null);

  const result = app.interview_result;
  const status = app.application_status;

  const decide = async (decision: "Selected" | "Rejected") => {
    setLoading(decision);
    await onDecide(app.application_id, decision);
    setLoading(null);
  };

  if (status === "selected") {
    return (
      <div className="flex items-center gap-2">
        <span className="px-3 py-1.5 bg-emerald-500 text-white text-xs font-bold rounded-xl">✓ Selected</span>
        <button onClick={() => decide("Rejected")} disabled={!!loading}
          className="px-3 py-1.5 text-xs font-medium text-gray-500 border border-gray-200 rounded-xl hover:bg-red-50 hover:text-red-600 hover:border-red-200 disabled:opacity-40 transition-colors">
          {loading === "Rejected" ? "…" : "Reject"}
        </button>
      </div>
    );
  }
  if (status === "rejected") {
    return (
      <div className="flex items-center gap-2">
        <span className="px-3 py-1.5 bg-gray-200 text-gray-600 text-xs font-medium rounded-xl">✕ Rejected</span>
        <button onClick={() => decide("Selected")} disabled={!!loading}
          className="px-3 py-1.5 text-xs font-medium text-gray-500 border border-gray-200 rounded-xl hover:bg-emerald-50 hover:text-emerald-600 hover:border-emerald-200 disabled:opacity-40 transition-colors">
          {loading === "Selected" ? "…" : "Select"}
        </button>
      </div>
    );
  }

  // Show decision buttons for all applications (sends email on decide)
  const canDecide = true;
  if (!canDecide) return null;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <button onClick={() => decide("Selected")} disabled={!!loading}
          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl transition-colors flex items-center gap-1.5">
          {loading === "Selected"
            ? <><div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" /> Selecting…</>
            : <><svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg>Select + Email</>
          }
        </button>
        <button onClick={() => decide("Rejected")} disabled={!!loading}
          className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl transition-colors flex items-center gap-1.5">
          {loading === "Rejected"
            ? <><div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" /> Rejecting…</>
            : <><svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>Reject + Email</>
          }
        </button>
      </div>
      <p className="text-[10px] text-gray-400 text-center">Sends notification email to candidate</p>
    </div>
  );
}

const appStatusConfig: Record<string, { label: string; color: string }> = {
  applied:               { label: "Applied",           color: "bg-blue-50 text-blue-700" },
  ats_failed:            { label: "ATS Failed",         color: "bg-red-50 text-red-700" },
  interview_scheduled:   { label: "Interview Ready",    color: "bg-purple-50 text-purple-700" },
  interview_in_progress: { label: "In Progress",        color: "bg-amber-50 text-amber-700" },
  interview_completed:   { label: "Interview Done",     color: "bg-teal-50 text-teal-700" },
  selected:              { label: "Selected ✓",         color: "bg-emerald-100 text-emerald-800 font-semibold" },
  rejected:              { label: "Rejected",           color: "bg-gray-100 text-gray-600" },
};

/* ─── Main Page ─── */
export default function CandidateDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [resumeOpen, setResumeOpen] = useState(false);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  useEffect(() => {
    fetch(`/api/admin/candidates/${id}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) { router.push("/admin/candidates"); return; }
        setProfile(data.profile);
        setApplications(data.applications);
      })
      .finally(() => setLoading(false));
  }, [id]);

  const showToast = (msg: string, ok: boolean) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  };

  const handleDecide = async (applicationId: string, decision: "Selected" | "Rejected") => {
    const res = await fetch(`/api/admin/candidates/${id}/decide`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ applicationId, decision }),
    });
    const data = await res.json();
    if (res.ok) {
      setApplications(prev => prev.map(a =>
        a.application_id === applicationId
          ? { ...a, application_status: decision === "Selected" ? "selected" : "rejected", interview_result: decision }
          : a
      ));
      showToast(`Candidate ${decision === "Selected" ? "selected ✓" : "rejected"}`, res.ok);
    } else {
      showToast(data.error || "Decision failed", false);
    }
  };

  if (loading) return (
    <DashboardLayout>
      <div className="flex items-center justify-center h-96">
        <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      </div>
    </DashboardLayout>
  );

  if (!profile) return null;

  const atsScore = profile.global_ats_score;
  const atsResult = profile.global_ats_result;
  const totalApps = applications.length;
  const selectedApps = applications.filter(a => a.application_status === "selected").length;
  const interviewDone = applications.filter(a => ["interview_completed","selected","rejected"].includes(a.application_status)).length;
  const initials = (profile.name || profile.email).slice(0, 2).toUpperCase();

  return (
    <DashboardLayout>
      {/* Toast */}
      {toast && (
        <div className={`fixed top-5 right-5 z-50 px-5 py-3 rounded-xl shadow-xl text-sm font-semibold transition-all ${toast.ok ? "bg-emerald-600 text-white" : "bg-red-600 text-white"}`}>
          {toast.msg}
        </div>
      )}

      <div className="max-w-7xl mx-auto">
        {/* Back + Header */}
        <div className="flex items-start justify-between mb-6">
          <div className="flex items-center gap-3">
            <Link href="/admin/candidates"
              className="p-2 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 transition-colors shadow-sm">
              <svg className="w-4 h-4 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
              </svg>
            </Link>
            <div>
              <h1 className="text-xl font-bold text-gray-900">{profile.name || "Unnamed Candidate"}</h1>
              <p className="text-sm text-gray-500">{profile.email} · Joined {new Date(profile.joined_at).toLocaleDateString()}</p>
            </div>
          </div>
          {/* Quick stats chips */}
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <span className="px-3 py-1.5 bg-gray-100 text-gray-700 text-xs font-medium rounded-full">{totalApps} application{totalApps !== 1 ? "s" : ""}</span>
            <span className="px-3 py-1.5 bg-teal-50 text-teal-700 text-xs font-medium rounded-full">{interviewDone} interview{interviewDone !== 1 ? "s" : ""} done</span>
            {selectedApps > 0 && <span className="px-3 py-1.5 bg-emerald-500 text-white text-xs font-bold rounded-full">Selected</span>}
          </div>
        </div>

        <div className="grid lg:grid-cols-[300px_1fr] gap-6">
          {/* ── Left: Profile Panel ── */}
          <div className="space-y-5">
            {/* Avatar + Basic */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <div className="flex flex-col items-center text-center">
                <div className="w-16 h-16 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-xl font-bold shadow-sm mb-3">
                  {initials}
                </div>
                <h2 className="font-semibold text-gray-900">{profile.name || "—"}</h2>
                <p className="text-sm text-gray-500 mt-0.5">{profile.email}</p>
                {atsResult?.domain && <p className="text-xs text-indigo-600 font-medium mt-1 bg-indigo-50 px-2 py-0.5 rounded-full">{atsResult.domain}</p>}
              </div>

              <div className="mt-4 space-y-2.5 text-sm">
                {profile.phone && (
                  <div className="flex items-center gap-2 text-gray-600">
                    <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.338c0 1.7.303 3.33.857 4.843m1.663 3.22l1.697 1.697a.75.75 0 001.06 0l.617-.617a.75.75 0 01.97-.073A16.54 16.54 0 0015 18.075c.41.025.826.025 1.236 0a.75.75 0 01.516.247l.617.617a.75.75 0 001.06 0l1.697-1.697A10.46 10.46 0 0021.75 12a10.47 10.47 0 00-1.72-5.786" />
                    </svg>
                    {profile.phone}
                  </div>
                )}
                {profile.linkedin_url && (
                  <a href={profile.linkedin_url} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-2 text-indigo-600 hover:underline">
                    <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                    </svg>
                    LinkedIn
                  </a>
                )}
                {profile.portfolio_url && (
                  <a href={profile.portfolio_url} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-2 text-indigo-600 hover:underline truncate">
                    <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
                    </svg>
                    Portfolio
                  </a>
                )}
                {atsResult?.years_experience !== undefined && (
                  <div className="flex items-center gap-2 text-gray-600">
                    <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 00.75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 00-3.413-.387m4.5 8.006c-.194.165-.42.295-.673.38A23.978 23.978 0 0112 15.75" />
                    </svg>
                    ~{atsResult.years_experience} yrs experience
                  </div>
                )}
              </div>

              {profile.bio && (
                <div className="mt-4 pt-4 border-t border-gray-100">
                  <p className="text-xs text-gray-600 leading-relaxed">{profile.bio}</p>
                </div>
              )}
            </div>

            {/* Global ATS Score */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <h3 className="text-sm font-semibold text-gray-900 mb-1">Global Resume ATS Score</h3>
              <p className="text-xs text-gray-400 mb-3">Resume quality, not job-specific</p>
              {atsScore != null ? (
                <div className="flex flex-col items-center">
                  <ATSRing score={Math.round(atsScore)} />
                  <div className={`mt-2 px-3 py-1 rounded-full text-xs font-semibold ${
                    atsScore >= 70 ? "bg-emerald-50 text-emerald-700" :
                    atsScore >= 50 ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-700"
                  }`}>{profile.global_ats_label}</div>
                  {profile.global_ats_updated_at && (
                    <p className="text-xs text-gray-400 mt-1">Updated {new Date(profile.global_ats_updated_at).toLocaleDateString()}</p>
                  )}
                  {atsResult?.explanation && (
                    <p className="text-xs text-gray-600 text-center mt-3 leading-relaxed">{atsResult.explanation}</p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-gray-400 text-center py-4">No global ATS score yet</p>
              )}
            </div>

            {/* Skills */}
            {atsResult?.skills && atsResult.skills.length > 0 && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                <h3 className="text-sm font-semibold text-gray-900 mb-3">Detected Skills</h3>
                <div className="flex flex-wrap gap-1.5">
                  {atsResult.skills.slice(0, 16).map((s, i) => (
                    <span key={i} className="px-2 py-0.5 bg-indigo-50 text-indigo-700 text-xs rounded-full font-medium">{s}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Resume Button */}
            {profile.resume_text && (
              <button onClick={() => setResumeOpen(o => !o)}
                className="w-full flex items-center justify-between p-4 bg-white border border-gray-100 rounded-2xl shadow-sm hover:bg-gray-50 transition-colors text-sm font-medium text-gray-700">
                <span className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12" />
                  </svg>
                  {resumeOpen ? "Hide Resume" : "View Resume"}
                </span>
                <svg className={`w-4 h-4 text-gray-400 transition-transform ${resumeOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                </svg>
              </button>
            )}
            {resumeOpen && profile.resume_text && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 max-h-80 overflow-y-auto">
                <pre className="text-xs text-gray-700 font-mono whitespace-pre-wrap leading-relaxed">{profile.resume_text}</pre>
              </div>
            )}
          </div>

          {/* ── Right: Applications ── */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900">Applications & Interviews</h2>
              <span className="text-sm text-gray-500">{totalApps} total</span>
            </div>

            {applications.length === 0 ? (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 text-center">
                <p className="text-gray-500 text-sm">No applications yet.</p>
              </div>
            ) : (
              applications.map(app => {
                const sc = appStatusConfig[app.application_status] || { label: app.application_status, color: "bg-gray-100 text-gray-600" };
                const isOpen = expanded === app.application_id;
                const scorecard = app.scorecard;
                const expired = app.expires_at ? new Date(app.expires_at) < new Date() : false;

                return (
                  <div key={app.application_id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                    {/* Card Header */}
                    <div className="p-5">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="text-sm font-semibold text-gray-900">{app.job_title}</h3>
                            {app.level_tag && <span className="px-1.5 py-0.5 bg-gray-100 text-gray-600 text-xs rounded">{app.level_tag}</span>}
                          </div>
                          <p className="text-xs text-indigo-600 font-medium mt-0.5">{app.org_name}</p>
                          <div className="flex flex-wrap gap-2 mt-1 text-xs text-gray-400">
                            {app.department && <span>{app.department}</span>}
                            <span>{app.location}</span>
                            <span>Applied {new Date(app.applied_at).toLocaleDateString()}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
                          {/* Role-specific ATS score badge */}
                          {app.ats_score != null && (
                            <div className={`flex flex-col items-center px-2.5 py-1.5 rounded-xl ${
                              app.ats_score >= 70 ? "bg-emerald-50" : app.ats_score >= 50 ? "bg-amber-50" : "bg-red-50"
                            }`}>
                              <span className={`text-lg font-bold leading-none ${
                                app.ats_score >= 70 ? "text-emerald-700" : app.ats_score >= 50 ? "text-amber-700" : "text-red-700"
                              }`}>{Math.round(app.ats_score)}</span>
                              <span className="text-[10px] text-gray-500">Role ATS</span>
                            </div>
                          )}
                          <span className={`px-2.5 py-1 rounded-full text-xs ${sc.color}`}>{sc.label}</span>
                          <button onClick={() => setExpanded(isOpen ? null : app.application_id)}
                            className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors">
                            <svg className={`w-4 h-4 transition-transform ${isOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                            </svg>
                          </button>
                        </div>
                      </div>

                      {/* Interview link + Decision */}
                      {app.interview_url && (
                        <div className={`mt-4 p-3.5 rounded-xl border flex items-center justify-between gap-4 ${expired ? "bg-gray-50 border-gray-200" : "bg-indigo-50 border-indigo-200"}`}>
                          <div>
                            <p className="text-xs font-semibold text-gray-700">
                              Interview · {app.interview_status === "completed" || app.raw_interview_status === "completed" ? "Completed" : expired ? "Expired" : "Pending"}
                            </p>
                            {app.transcript_count > 0 && (
                              <p className="text-xs text-gray-500 mt-0.5">{app.transcript_count} messages in transcript</p>
                            )}
                            {app.started_at && app.ended_at && (
                              <p className="text-xs text-gray-400 mt-0.5">
                                {new Date(app.started_at).toLocaleString()} → {new Date(app.ended_at).toLocaleString()}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {app.interview_id && (
                              <Link href={`/review/${app.interview_id}`} target="_blank"
                                className="px-3 py-1.5 text-xs font-medium text-indigo-700 bg-white border border-indigo-200 rounded-lg hover:bg-indigo-50 transition-colors">
                                Review →
                              </Link>
                            )}
                            <DecisionButtons app={app} onDecide={handleDecide} />
                          </div>
                        </div>
                      )}

                      {/* ATS Failed — no interview link */}
                      {app.application_status === "ats_failed" && !app.interview_url && (
                        <div className="mt-3 p-3 bg-red-50 border border-red-100 rounded-xl">
                          <p className="text-xs font-semibold text-red-700">ATS Score below threshold — interview not generated</p>
                          {app.ats_explanation && <p className="text-xs text-red-600 mt-1">{app.ats_explanation}</p>}
                        </div>
                      )}
                    </div>

                    {/* Expanded Detail */}
                    {isOpen && (
                      <div className="border-t border-gray-50 px-5 pb-5 pt-4 space-y-5 bg-gray-50/40">
                        {/* Prominent job-specific ATS score */}
                        {app.ats_score != null && (
                          <div className={`flex items-center justify-between p-4 rounded-xl border ${
                            app.ats_score >= 70 ? "bg-emerald-50 border-emerald-200" :
                            app.ats_score >= 50 ? "bg-amber-50 border-amber-200" : "bg-red-50 border-red-200"
                          }`}>
                            <div>
                              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Role Match ATS Score</p>
                              <p className="text-xs text-gray-400 mt-0.5">{app.job_title} · {app.org_name}</p>
                            </div>
                            <div className="flex items-baseline gap-1">
                              <span className={`text-3xl font-bold ${
                                app.ats_score >= 70 ? "text-emerald-700" : app.ats_score >= 50 ? "text-amber-700" : "text-red-700"
                              }`}>{Math.round(app.ats_score)}</span>
                              <span className="text-sm text-gray-400">/100</span>
                              {app.ats_label && (
                                <span className={`ml-2 px-2 py-0.5 rounded-full text-xs font-semibold ${
                                  app.ats_score >= 70 ? "bg-emerald-100 text-emerald-800" :
                                  app.ats_score >= 50 ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-800"
                                }`}>{app.ats_label}</span>
                              )}
                            </div>
                          </div>
                        )}
                        {/* ATS Skills breakdown */}
                        {(app.matched_skills?.length || app.missing_skills?.length) && (
                          <div className="grid sm:grid-cols-2 gap-4">
                            {app.matched_skills && app.matched_skills.length > 0 && (
                              <div>
                                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Matched Skills</p>
                                <div className="flex flex-wrap gap-1.5">
                                  {app.matched_skills.map((s, i) => (
                                    <span key={i} className="px-2 py-0.5 bg-emerald-50 text-emerald-700 text-xs rounded-full font-medium">{s}</span>
                                  ))}
                                </div>
                              </div>
                            )}
                            {app.missing_skills && app.missing_skills.length > 0 && (
                              <div>
                                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Missing Skills</p>
                                <div className="flex flex-wrap gap-1.5">
                                  {app.missing_skills.map((s, i) => (
                                    <span key={i} className="px-2 py-0.5 bg-red-50 text-red-700 text-xs rounded-full font-medium">{s}</span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        {/* ATSv4 Evaluation Detail */}
                        {app.ats_full_result && (app.ats_full_result.overall_summary || app.ats_full_result.interview_focus) && (
                          <div className="p-4 bg-indigo-50/60 rounded-xl border border-indigo-100 space-y-3">
                            <p className="text-xs font-semibold text-indigo-700 uppercase tracking-wide">
                              ATS Evaluation
                              {app.ats_full_result.grade && (
                                <span className="ml-2 px-1.5 py-0.5 bg-indigo-100 text-indigo-800 rounded font-bold">Grade {app.ats_full_result.grade}</span>
                              )}
                            </p>
                            {app.ats_full_result.overall_summary && (
                              <p className="text-xs text-gray-700 leading-relaxed">{app.ats_full_result.overall_summary}</p>
                            )}
                            {app.ats_full_result.interview_focus && (
                              <div className="space-y-2">
                                {app.ats_full_result.interview_focus.must_probe && app.ats_full_result.interview_focus.must_probe.length > 0 && (
                                  <div>
                                    <p className="text-[10px] font-bold text-red-600 uppercase tracking-wide mb-1">Must Probe</p>
                                    <ul className="space-y-0.5">
                                      {app.ats_full_result.interview_focus.must_probe.map((item, i) => (
                                        <li key={i} className="text-xs text-gray-700 flex items-start gap-1.5">
                                          <span className="text-red-400 flex-shrink-0 mt-0.5">!</span>{item}
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                                {app.ats_full_result.interview_focus.strengths_to_confirm && app.ats_full_result.interview_focus.strengths_to_confirm.length > 0 && (
                                  <div>
                                    <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-wide mb-1">Strengths to Confirm</p>
                                    <ul className="space-y-0.5">
                                      {app.ats_full_result.interview_focus.strengths_to_confirm.map((item, i) => (
                                        <li key={i} className="text-xs text-gray-700 flex items-start gap-1.5">
                                          <span className="text-emerald-500 flex-shrink-0 mt-0.5">✓</span>{item}
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                                {app.ats_full_result.interview_focus.recommended_depth && (
                                  <p className="text-xs text-gray-500">
                                    Depth: <span className="font-semibold text-indigo-700 capitalize">{app.ats_full_result.interview_focus.recommended_depth}</span>
                                  </p>
                                )}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Skill coverage bar */}
                        {app.skill_coverage != null && (
                          <div>
                            <div className="flex items-center justify-between mb-1.5">
                              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Skill Coverage</p>
                              <span className="text-xs font-semibold text-gray-700">{Math.round(app.skill_coverage * 100)}%</span>
                            </div>
                            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                              <div className={`h-full rounded-full transition-all duration-700 ${app.skill_coverage >= 0.7 ? "bg-emerald-500" : app.skill_coverage >= 0.5 ? "bg-amber-500" : "bg-red-500"}`}
                                style={{ width: `${app.skill_coverage * 100}%` }} />
                            </div>
                          </div>
                        )}

                        {/* Scorecard */}
                        {scorecard && (
                          <div>
                            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Interview Scorecard</p>
                            <div className="bg-white rounded-xl border border-gray-100 p-4 space-y-3">
                              {/* Recommendation + Final Score */}
                              <div className="flex items-center justify-between mb-3">
                                {scorecard.recommendation && (
                                  <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                                    scorecard.recommendation.includes("hire") && !scorecard.recommendation.includes("no")
                                      ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"
                                  }`}>
                                    {scorecard.recommendation.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
                                  </span>
                                )}
                                {(() => {
                                  const combined = (scorecard as any).combinedScore;
                                  const overall = scorecard.overall;
                                  const display = combined ?? overall;
                                  if (display == null) return null;
                                  const color = display >= 3.5 ? "text-emerald-700" : display >= 2.5 ? "text-amber-700" : "text-red-700";
                                  return (
                                    <div className="text-right">
                                      <div className={`flex items-baseline gap-0.5 ${color}`}>
                                        <span className="text-xl font-bold">{Number(display).toFixed(1)}</span>
                                        <span className="text-xs text-gray-400">/5</span>
                                      </div>
                                      <p className="text-[9px] text-gray-400">
                                        {combined != null ? "70% interview + 30% ATS" : "Interview Score"}
                                      </p>
                                    </div>
                                  );
                                })()}
                              </div>

                              {/* Dimension bars */}
                              <div className="space-y-2">
                                {[
                                  ["Technical Depth", scorecard.technicalDepth],
                                  ["Communication", scorecard.communication],
                                  ["Problem Solving", scorecard.problemSolving],
                                  ["Domain Knowledge", scorecard.domainKnowledge],
                                  ["Culture Fit", scorecard.cultureFit],
                                ].map(([label, val]) => val != null && (
                                  <ScoreBar key={String(label)} label={String(label)} value={Number(val)} />
                                ))}
                                {scorecard.overall != null && (
                                  <div className="pt-2 border-t border-gray-100">
                                    <ScoreBar label="Overall" value={scorecard.overall} />
                                  </div>
                                )}
                              </div>

                              {/* Summary */}
                              {scorecard.summary && (
                                <div className="pt-3 border-t border-gray-100">
                                  <p className="text-xs text-gray-600 leading-relaxed">{scorecard.summary}</p>
                                </div>
                              )}

                              {/* Strengths / Weaknesses */}
                              {(scorecard.strengths?.length || scorecard.weaknesses?.length) && (
                                <div className="pt-3 border-t border-gray-100 grid sm:grid-cols-2 gap-3">
                                  {scorecard.strengths && scorecard.strengths.length > 0 && (
                                    <div>
                                      <p className="text-xs font-semibold text-emerald-700 mb-1.5">Strengths</p>
                                      <ul className="space-y-1">
                                        {scorecard.strengths.map((s, i) => (
                                          <li key={i} className="text-xs text-gray-600 flex items-start gap-1.5">
                                            <span className="text-emerald-500 mt-0.5 flex-shrink-0">+</span>{s}
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  )}
                                  {scorecard.weaknesses && scorecard.weaknesses.length > 0 && (
                                    <div>
                                      <p className="text-xs font-semibold text-red-700 mb-1.5">Weaknesses</p>
                                      <ul className="space-y-1">
                                        {scorecard.weaknesses.map((s, i) => (
                                          <li key={i} className="text-xs text-gray-600 flex items-start gap-1.5">
                                            <span className="text-red-400 mt-0.5 flex-shrink-0">−</span>{s}
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* Review link */}
                              {app.interview_id && (
                                <div className="pt-3 border-t border-gray-100">
                                  <Link href={`/review/${app.interview_id}`} target="_blank"
                                    className="text-xs text-indigo-600 hover:underline font-medium">
                                    View full transcript & review →
                                  </Link>
                                </div>
                              )}
                            </div>

                            {/* Decision at bottom of scorecard for easy access */}
                            <div className="mt-3 flex justify-end">
                              <DecisionButtons app={app} onDecide={handleDecide} />
                            </div>
                          </div>
                        )}

                        {/* ATS Suggestions */}
                        {app.ats_suggestions && app.ats_suggestions.length > 0 && (
                          <div>
                            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">ATS Improvement Tips</p>
                            <ul className="space-y-1.5">
                              {app.ats_suggestions.map((s, i) => (
                                <li key={i} className="flex items-start gap-2 text-xs text-gray-600">
                                  <span className="text-amber-500 mt-0.5 flex-shrink-0">•</span>{s}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {/* Proctoring Summary */}
                        {app.proctoring_summary && (
                          <div>
                            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Proctoring Report</p>
                            <div className="bg-white rounded-xl border border-gray-100 p-4 space-y-4">
                              {/* Summary pills */}
                              <div className="flex flex-wrap gap-2">
                                <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
                                  {app.proctoring_summary.total} event{app.proctoring_summary.total !== 1 ? "s" : ""}
                                </span>
                                {app.proctoring_summary.warnings > 0 && (
                                  <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-700">
                                    {app.proctoring_summary.warnings} warning{app.proctoring_summary.warnings !== 1 ? "s" : ""}
                                  </span>
                                )}
                                {app.proctoring_summary.flags > 0 && (
                                  <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-red-50 text-red-700">
                                    {app.proctoring_summary.flags} flag{app.proctoring_summary.flags !== 1 ? "s" : ""}
                                  </span>
                                )}
                                {app.proctoring_summary.total === 0 && (
                                  <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700">
                                    Clean session
                                  </span>
                                )}
                              </div>

                              {/* By type breakdown */}
                              {Object.keys(app.proctoring_summary.by_type).length > 0 && (
                                <div className="grid grid-cols-2 gap-1.5">
                                  {Object.entries(app.proctoring_summary.by_type).map(([type, count]) => {
                                    const isHighRisk = ["multiple_faces", "looking_away", "camera_off"].includes(type);
                                    return (
                                      <div key={type} className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg ${isHighRisk ? "bg-red-50" : "bg-gray-50"}`}>
                                        <span className={`text-xs capitalize ${isHighRisk ? "text-red-700 font-medium" : "text-gray-600"}`}>
                                          {type === "multiple_faces" ? "Another person detected"
                                            : type === "looking_away" ? "Looking away"
                                            : type === "violation_photo" ? "Photos captured"
                                            : type === "photo_capture" ? "Routine photos"
                                            : type.replace(/_/g, " ")}
                                        </span>
                                        <span className={`text-xs font-bold ml-2 ${isHighRisk ? "text-red-700" : "text-gray-800"}`}>{count}</span>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}

                              {/* Violation Photo Captures — shown as a grid */}
                              {(() => {
                                const photos = app.proctoring_events.filter(e => e.photo && (e.type === "violation_photo" || e.type === "photo_capture"));
                                if (photos.length === 0) return null;
                                return (
                                  <div>
                                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                                      Captured Photos ({photos.length})
                                    </p>
                                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                                      {photos.map((e, i) => (
                                        <div key={i} className="relative group">
                                          <img
                                            src={e.photo!}
                                            alt={`Capture ${i + 1}`}
                                            className="w-full aspect-video object-cover rounded-lg border border-gray-200 cursor-pointer hover:opacity-90 transition-opacity"
                                            onClick={() => window.open(e.photo!, "_blank")}
                                          />
                                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 rounded-lg transition-colors" />
                                          <div className={`absolute bottom-0 left-0 right-0 rounded-b-lg px-1.5 py-0.5 text-[9px] font-medium truncate ${
                                            e.type === "violation_photo" ? "bg-red-600/90 text-white" : "bg-gray-700/80 text-gray-200"
                                          }`}>
                                            {e.message?.replace(/\[|\]/g, "").split("]")[0] || new Date(e.created_at).toLocaleTimeString()}
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                );
                              })()}

                              {/* Event log */}
                              {app.proctoring_events && app.proctoring_events.length > 0 && (
                                <details>
                                  <summary className="text-xs text-indigo-600 hover:underline cursor-pointer font-medium">
                                    View full event log ({app.proctoring_events.length})
                                  </summary>
                                  <div className="mt-2 space-y-1.5 max-h-56 overflow-y-auto">
                                    {app.proctoring_events.map((e, i) => (
                                      <div key={i} className={`flex items-start gap-2 p-2 rounded-lg text-xs ${
                                        e.type === "multiple_faces" || e.type === "looking_away"
                                          ? "bg-red-50 border border-red-100"
                                          : e.severity === "flag" ? "bg-red-50" : "bg-amber-50"
                                      }`}>
                                        <span className={`flex-shrink-0 font-bold uppercase ${
                                          e.severity === "flag" ? "text-red-600" : "text-amber-600"
                                        }`}>
                                          {e.type === "multiple_faces" ? "MULT"
                                            : e.type === "looking_away" ? "GAZE"
                                            : e.type === "violation_photo" ? "PHOTO"
                                            : e.type === "photo_capture" ? "PHOTO"
                                            : e.severity.toUpperCase().slice(0, 4)}
                                        </span>
                                        <span className="text-gray-700 flex-1">{e.message}</span>
                                        <span className="text-gray-400 flex-shrink-0">
                                          {new Date(e.created_at).toLocaleTimeString()}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                </details>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
