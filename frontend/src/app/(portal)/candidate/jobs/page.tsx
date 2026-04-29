"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";

interface Job {
  id: string;
  title: string;
  description: string;
  requirements: string | null;
  department: string | null;
  location: string;
  employment_type: string;
  role_tag: string | null;
  level_tag: string | null;
  org_name: string;
  created_at: string;
  application_count: number;
}

interface ApplyResult {
  eligible: boolean;
  atsScore: number;
  atsLabel: string;
  matched_skills: string[];
  missing_skills: string[];
  suggestions: string[];
  interviewUrl?: string;
  expiresAt?: string;
  message: string;
  alreadyApplied?: boolean;
  applicationId?: string;
}

export default function JobsPage() {
  const { data: session } = useSession();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [location, setLocation] = useState("");
  const [employmentType, setEmploymentType] = useState("");
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [resultJobTitle, setResultJobTitle] = useState("");
  const [noResume, setNoResume] = useState(false);

  useEffect(() => {
    fetchJobs();
  }, [search, location, employmentType]);

  async function fetchJobs() {
    setLoading(true);
    const params = new URLSearchParams({ status: "open" });
    if (search) params.set("search", search);
    if (location) params.set("location", location);
    if (employmentType) params.set("employment_type", employmentType);
    const res = await fetch(`/api/jobs?${params}`);
    if (res.ok) { const d = await res.json(); setJobs(d.jobs || []); }
    setLoading(false);
  }

  async function handleApply(job: Job) {
    setApplyingId(job.id);
    setResult(null);
    setResultJobTitle(job.title);
    setNoResume(false);
    try {
      const res = await fetch("/api/candidate/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id }),
      });
      const data = await res.json();
      if (res.status === 422 && data.error?.includes("resume")) {
        setNoResume(true);
      } else {
        setResult(data);
      }
    } catch {
      setResult({ eligible: false, atsScore: 0, atsLabel: "Error", matched_skills: [], missing_skills: [], suggestions: [], message: "Application failed. Try again." });
    } finally {
      setApplyingId(null);
    }
  }

  const typeColors: Record<string, string> = {
    "full-time": "bg-blue-50 text-blue-700",
    "part-time": "bg-purple-50 text-purple-700",
    "contract": "bg-orange-50 text-orange-700",
    "internship": "bg-pink-50 text-pink-700",
  };

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Open Jobs</h1>
        <p className="text-gray-500 text-sm mt-1">Find and apply to jobs. Your resume will be ATS-evaluated instantly.</p>
      </div>

      {/* Search & Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input
            type="text" placeholder="Search jobs by title or keyword…"
            value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white shadow-sm"
          />
        </div>
        <select
          value={location} onChange={(e) => setLocation(e.target.value)}
          className="px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white shadow-sm text-gray-700"
        >
          <option value="">All Locations</option>
          <option value="Remote">Remote</option>
          <option value="Onsite">Onsite</option>
          <option value="Online">Online</option>
          <option value="Hybrid">Hybrid</option>
        </select>
        <select
          value={employmentType} onChange={(e) => setEmploymentType(e.target.value)}
          className="px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white shadow-sm text-gray-700"
        >
          <option value="">All Interview Types</option>
          <option value="full-time">Full-time</option>
          <option value="part-time">Part-time</option>
          <option value="contract">Contract</option>
          <option value="internship">Internship</option>
        </select>
      </div>

      {/* No resume warning */}
      {noResume && (
        <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-center gap-3">
          <svg className="w-5 h-5 text-amber-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <div>
            <p className="text-sm font-medium text-amber-800">Resume required to apply</p>
            <p className="text-xs text-amber-700 mt-0.5">
              Please <a href="/candidate/profile" className="underline font-medium">upload your resume</a> in your profile first.
            </p>
          </div>
        </div>
      )}

      {/* Apply Result Modal */}
      {result && (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4" onClick={() => setResult(null)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className={`p-6 rounded-t-2xl ${result.eligible || result.alreadyApplied ? "bg-emerald-50" : "bg-red-50"}`}>
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${result.eligible || result.alreadyApplied ? "bg-emerald-500" : "bg-red-500"}`}>
                  {result.eligible || result.alreadyApplied ? (
                    <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  )}
                </div>
                <div>
                  <h3 className={`font-bold text-lg ${result.eligible || result.alreadyApplied ? "text-emerald-800" : "text-red-800"}`}>
                    {result.alreadyApplied ? "Already Applied" : result.eligible ? "Eligible!" : "Below Threshold"}
                  </h3>
                  <p className="text-xs text-gray-600">{resultJobTitle}</p>
                </div>
              </div>
            </div>

            <div className="p-6 space-y-5">
              {/* ATS Score */}
              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl">
                <span className="text-sm font-medium text-gray-700">ATS Score</span>
                <span className={`text-2xl font-bold ${
                  result.atsScore >= 70 ? "text-emerald-600" : result.atsScore >= 50 ? "text-amber-600" : "text-red-600"
                }`}>
                  {Math.round(result.atsScore || 0)}<span className="text-sm font-normal text-gray-400">/100</span>
                </span>
              </div>

              <p className="text-sm text-gray-700">{result.message}</p>

              {/* Interview Link */}
              {result.interviewUrl && (
                <div className="p-4 bg-teal-50 border border-teal-200 rounded-xl">
                  <p className="text-xs font-semibold text-teal-800 mb-2">Your Interview Link</p>
                  <a
                    href={result.interviewUrl} target="_blank" rel="noopener noreferrer"
                    className="block w-full text-center py-2.5 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold rounded-lg transition-colors"
                  >
                    Start Interview →
                  </a>
                  {result.expiresAt && (
                    <p className="text-xs text-teal-600 mt-2 text-center">
                      Expires: {new Date(result.expiresAt).toLocaleString()}
                    </p>
                  )}
                </div>
              )}

              {/* Matched Skills */}
              {result.matched_skills?.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Matched Skills</p>
                  <div className="flex flex-wrap gap-1.5">
                    {result.matched_skills.slice(0, 8).map((s, i) => (
                      <span key={i} className="px-2.5 py-1 bg-emerald-50 text-emerald-700 text-xs rounded-full font-medium">{s}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Missing Skills */}
              {result.missing_skills?.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Skills to Develop</p>
                  <div className="flex flex-wrap gap-1.5">
                    {result.missing_skills.slice(0, 8).map((s, i) => (
                      <span key={i} className="px-2.5 py-1 bg-red-50 text-red-700 text-xs rounded-full font-medium">{s}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Suggestions */}
              {result.suggestions?.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Improvement Tips</p>
                  <ul className="space-y-2">
                    {result.suggestions.map((s, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                        <span className="text-amber-500 mt-0.5 flex-shrink-0">•</span>
                        {s}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <button
                onClick={() => setResult(null)}
                className="w-full py-2.5 border border-gray-200 text-gray-700 text-sm font-medium rounded-xl hover:bg-gray-50 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Jobs Grid */}
      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="w-7 h-7 border-2 border-teal-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : jobs.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-gray-100">
          <p className="text-gray-500">No open jobs found{search ? ` for "${search}"` : ""}.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {jobs.map((job) => (
            <div key={job.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <h3 className="text-base font-semibold text-gray-900">{job.title}</h3>
                    {job.level_tag && (
                      <span className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full">{job.level_tag}</span>
                    )}
                  </div>
                  <p className="text-sm text-teal-700 font-medium">{job.org_name}</p>
                  <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-gray-500">
                    {job.department && <span>{job.department}</span>}
                    <span>{job.location}</span>
                    <span className={`px-2 py-0.5 rounded-full font-medium ${typeColors[job.employment_type] || "bg-gray-100 text-gray-600"}`}>
                      {job.employment_type}
                    </span>
                    <span className="text-gray-400">{job.application_count} applicant{job.application_count !== 1 ? "s" : ""}</span>
                  </div>
                  <p className="text-sm text-gray-600 mt-3 line-clamp-2">{job.description}</p>
                </div>

                <button
                  onClick={() => handleApply(job)}
                  disabled={applyingId === job.id}
                  className="flex-shrink-0 px-5 py-2.5 bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white text-sm font-semibold rounded-xl transition-colors flex items-center gap-2"
                >
                  {applyingId === job.id ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Evaluating…
                    </>
                  ) : "Apply Now"}
                </button>
              </div>

              <div className="mt-4 pt-4 border-t border-gray-50 flex items-center justify-between text-xs text-gray-400">
                <span>Posted {new Date(job.created_at).toLocaleDateString()}</span>
                <button
                  onClick={() => {
                    const el = document.getElementById(`jd-${job.id}`);
                    if (el) el.classList.toggle("hidden");
                  }}
                  className="text-teal-600 hover:underline font-medium"
                >
                  View Full JD
                </button>
              </div>
              <div id={`jd-${job.id}`} className="hidden mt-3 p-4 bg-gray-50 rounded-xl text-sm text-gray-700 whitespace-pre-wrap">
                {job.description}
                {job.requirements && (
                  <div className="mt-3 pt-3 border-t border-gray-200">
                    <p className="font-medium text-gray-800 mb-1">Requirements:</p>
                    {job.requirements}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
