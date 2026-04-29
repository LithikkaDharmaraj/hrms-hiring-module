"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";

interface Profile {
  name: string;
  email: string;
  global_ats_score: number | null;
  global_ats_label: string | null;
  global_ats_result: Record<string, unknown> | null;
  resume_text: string | null;
  global_ats_updated_at: string | null;
}

interface Stats {
  total: number;
  ats_passed: number;
  interviews_scheduled: number;
  completed: number;
  selected: number;
}

interface Application {
  id: string;
  job_title: string;
  org_name: string;
  display_status: string;
  applied_at: string;
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  applied:        { label: "Under Review",       color: "bg-blue-50 text-blue-700" },
  ats_failed:     { label: "ATS Not Passed",      color: "bg-red-50 text-red-700" },
  interview_ready:{ label: "Interview Ready",     color: "bg-purple-50 text-purple-700" },
  under_review:   { label: "Under Review",        color: "bg-amber-50 text-amber-700" },
  hired:          { label: "Hired ✓",             color: "bg-emerald-50 text-emerald-700" },
  not_hired:      { label: "Not Selected",        color: "bg-gray-100 text-gray-600" },
};

function ProfileReadiness({ profile }: { profile: Profile | null }) {
  const hasResume = !!profile?.resume_text;
  const hasScore = profile?.global_ats_score != null;
  const score = profile?.global_ats_score ?? 0;
  const label = profile?.global_ats_label;

  if (!hasResume) {
    return (
      <div className="flex flex-col items-center py-6 text-center">
        <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
          <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
          </svg>
        </div>
        <p className="text-sm text-gray-600 font-medium">Resume not uploaded</p>
        <p className="text-xs text-gray-400 mt-1">Upload your resume to get started</p>
        <Link href="/candidate/profile"
          className="mt-3 inline-block px-4 py-1.5 bg-teal-600 text-white text-xs font-medium rounded-lg hover:bg-teal-700 transition-colors">
          Upload Resume
        </Link>
      </div>
    );
  }

  if (!hasScore) {
    return (
      <div className="text-center py-6">
        <div className="w-16 h-16 bg-teal-50 rounded-full flex items-center justify-center mx-auto mb-3">
          <svg className="w-8 h-8 text-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <p className="text-sm text-gray-600 font-medium">Resume uploaded</p>
        <p className="text-xs text-gray-400 mt-1">Compute ATS score to apply to jobs</p>
        <Link href="/candidate/profile"
          className="mt-3 inline-block px-4 py-1.5 bg-teal-600 text-white text-xs font-medium rounded-lg hover:bg-teal-700 transition-colors">
          Compute Score
        </Link>
      </div>
    );
  }

  const strength = score >= 70 ? "Strong" : score >= 50 ? "Good" : "Needs Work";
  const color = score >= 70 ? "text-emerald-600" : score >= 50 ? "text-amber-600" : "text-red-600";
  const bg = score >= 70 ? "bg-emerald-50" : score >= 50 ? "bg-amber-50" : "bg-red-50";

  return (
    <div className="flex flex-col items-center text-center py-2">
      <div className={`w-20 h-20 rounded-full ${bg} flex items-center justify-center mb-3 border-4 ${
        score >= 70 ? "border-emerald-200" : score >= 50 ? "border-amber-200" : "border-red-200"
      }`}>
        <div>
          <p className={`text-2xl font-bold leading-none ${color}`}>{Math.round(score)}</p>
          <p className={`text-xs font-medium ${color} opacity-70`}>/100</p>
        </div>
      </div>
      <p className="text-xs text-gray-500 font-medium mb-1">Global Resume ATS Score: {Math.round(score)}/100</p>
      <div className={`px-3 py-1 rounded-full text-xs font-semibold ${bg} ${color}`}>
        {label || strength}
      </div>
      {profile?.global_ats_updated_at && (
        <p className="text-xs text-gray-400 mt-2">
          Updated {new Date(profile.global_ats_updated_at).toLocaleDateString()}
        </p>
      )}
      <Link href="/candidate/profile" className="mt-3 text-xs text-teal-600 hover:underline font-medium">
        Update Resume →
      </Link>
    </div>
  );
}

export default function CandidateDashboard() {
  const { data: session } = useSession();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [recentApps, setRecentApps] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [pRes, aRes] = await Promise.all([
          fetch("/api/candidate/profile"),
          fetch("/api/candidate/applications"),
        ]);
        if (pRes.ok) { const d = await pRes.json(); setProfile(d.profile); }
        if (aRes.ok) {
          const d = await aRes.json();
          setStats(d.stats);
          setRecentApps(d.applications.slice(0, 5));
        }
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const firstName = session?.user?.name?.split(" ")[0] || "there";
  const suggestions = (profile?.global_ats_result as { suggestions?: string[] } | null)?.suggestions || [];

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Welcome back, {firstName}!</h1>
        <p className="text-gray-500 text-sm mt-1">Here&apos;s your job search overview</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="w-8 h-8 border-2 border-teal-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="space-y-8">
          {/* Stats */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: "Applications",     value: stats?.total ?? 0 },
              { label: "Interviews Ready", value: stats?.interviews_scheduled ?? 0 },
              { label: "Completed",        value: stats?.completed ?? 0 },
              { label: "Hired",            value: stats?.selected ?? 0 },
            ].map((s) => (
              <div key={s.label} className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">

                <div className="text-2xl font-bold text-gray-900">{s.value}</div>
                <div className="text-sm text-gray-500 mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>

          <div className="grid lg:grid-cols-3 gap-6">
            {/* Resume Readiness (no raw score shown) */}
            <div className="lg:col-span-1 bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-gray-900">Resume Readiness</h2>
              </div>
              <ProfileReadiness profile={profile} />
            </div>

            {/* Improvement Tips */}
            <div className="lg:col-span-2 bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
              <h2 className="font-semibold text-gray-900 mb-4">Resume Improvement Tips</h2>
              {suggestions.length > 0 ? (
                <ul className="space-y-2.5">
                  {suggestions.slice(0, 6).map((s, i) => {
                    const isStrength = s.startsWith("[strength]");
                    const isRisk = s.startsWith("[risk]");
                    const text = s.replace(/^\[(strength|risk)\]\s*/i, "");
                    return (
                      <li key={i} className="flex items-start gap-3">
                        <span className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold mt-0.5 ${
                          isStrength ? "bg-emerald-100 text-emerald-700" : isRisk ? "bg-red-100 text-red-700" : "bg-teal-100 text-teal-700"
                        }`}>
                          {isStrength ? "✓" : isRisk ? "!" : i + 1}
                        </span>
                        <span className="text-sm text-gray-700">{text}</span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="flex flex-col items-center justify-center h-40 text-center">
                  <p className="text-sm text-gray-500">Upload your resume to get personalized suggestions</p>
                  <Link href="/candidate/profile" className="mt-3 text-sm text-teal-600 hover:underline font-medium">
                    Go to Profile →
                  </Link>
                </div>
              )}
            </div>
          </div>

          {/* Recent Applications */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">Recent Applications</h2>
              <Link href="/candidate/applications" className="text-xs text-teal-600 hover:underline font-medium">
                View all →
              </Link>
            </div>

            {recentApps.length === 0 ? (
              <div className="py-12 text-center">
                <p className="text-gray-500 text-sm">No applications yet.</p>
                <Link href="/candidate/jobs"
                  className="mt-3 inline-block px-5 py-2 bg-teal-600 text-white text-sm font-medium rounded-xl hover:bg-teal-700 transition-colors">
                  Browse Jobs
                </Link>
              </div>
            ) : (
              <div className="divide-y divide-gray-50">
                {recentApps.map((app) => {
                  const sc = STATUS_LABELS[app.display_status] || { label: app.display_status, color: "bg-gray-100 text-gray-600" };
                  return (
                    <div key={app.id} className="px-6 py-4 flex items-center justify-between hover:bg-gray-50/50 transition-colors">
                      <div className="flex items-center gap-4 min-w-0">
                        <div className="w-9 h-9 rounded-xl bg-teal-100 flex items-center justify-center flex-shrink-0">
                          <svg className="w-4 h-4 text-teal-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 00.75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 00-3.413-.387m4.5 8.006c-.194.165-.42.295-.673.38A23.978 23.978 0 0112 15.75c-2.648 0-5.195-.429-7.577-1.22a2.016 2.016 0 01-.673-.38m0 0A2.18 2.18 0 013 12.489V8.706c0-1.081.768-2.015 1.837-2.175a48.111 48.111 0 013.413-.387m7.5 0V5.25A2.25 2.25 0 0013.5 3h-3a2.25 2.25 0 00-2.25 2.25v.894m7.5 0a48.667 48.667 0 00-7.5 0" />
                          </svg>
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">{app.job_title}</p>
                          <p className="text-xs text-gray-500">{app.org_name} · Applied {new Date(app.applied_at).toLocaleDateString()}</p>
                        </div>
                      </div>
                      <span className={`flex-shrink-0 text-xs font-medium px-2.5 py-1 rounded-full ${sc.color}`}>
                        {sc.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Quick Actions */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Link href="/candidate/jobs"
              className="group flex items-center gap-4 p-5 bg-teal-600 hover:bg-teal-700 rounded-2xl text-white transition-colors shadow-sm">
              <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                </svg>
              </div>
              <div>
                <p className="font-semibold">Browse Open Jobs</p>
                <p className="text-xs text-teal-100 mt-0.5">Find your next opportunity</p>
              </div>
            </Link>
            <Link href="/candidate/profile"
              className="group flex items-center gap-4 p-5 bg-white hover:bg-gray-50 rounded-2xl text-gray-900 transition-colors border border-gray-200 shadow-sm">
              <div className="w-10 h-10 bg-teal-100 rounded-xl flex items-center justify-center">
                <svg className="w-5 h-5 text-teal-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                </svg>
              </div>
              <div>
                <p className="font-semibold">Update Profile</p>
                <p className="text-xs text-gray-500 mt-0.5">Keep your resume up to date</p>
              </div>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
