"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { DashboardLayout } from "@/components/DashboardLayout";

interface Candidate {
  id: string;
  name: string;
  email: string;
  joined_at: string;
  global_ats_score: number | null;
  global_ats_label: string | null;
  resume_filename: string | null;
  phone: string | null;
  linkedin_url: string | null;
  bio: string | null;
  total_applications: number;
  pending_interviews: number;
  completed_interviews: number;
  selected_count: number;
  rejected_count: number;
  ats_failed_count: number;
  avg_job_ats: number | null;
  best_ats_score: number | null;
  best_interview_score: number | null;
  best_combined_score: number | null;
  last_activity: string | null;
}

interface Stats {
  total_candidates: number;
  pending_review: number;
  selected: number;
  ats_failed: number;
  avg_global_ats: number | null;
}

const STAGES = [
  { key: "all",       label: "All Candidates" },
  { key: "pending",   label: "Pending Review" },
  { key: "completed", label: "Completed" },
  { key: "selected",  label: "Selected" },
  { key: "rejected",  label: "Rejected" },
  { key: "ats_failed",label: "ATS Failed" },
];

const SORTS = [
  { key: "last_activity", label: "Last Activity" },
  { key: "name",          label: "Name" },
  { key: "global_ats",    label: "ATS Score" },
  { key: "applications",  label: "Applications" },
  { key: "joined",        label: "Joined" },
];

function ScorePill({ score, size = "md" }: { score: number | null; size?: "sm" | "md" }) {
  if (score === null || score === undefined) return <span className="text-gray-400 text-xs">—</span>;
  const s = Math.round(score);
  const color = s >= 70 ? "bg-emerald-50 text-emerald-700 border-emerald-200"
    : s >= 50 ? "bg-amber-50 text-amber-700 border-amber-200"
    : "bg-red-50 text-red-700 border-red-200";
  const text = size === "sm" ? "text-xs" : "text-sm font-semibold";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full border ${color} ${text}`}>
      {s}
    </span>
  );
}

function InterviewScorePill({ score }: { score: number | null }) {
  if (score === null || score === undefined) return <span className="text-gray-400 text-xs">—</span>;
  const s = Math.round(score * 10) / 10;
  const color = s >= 3.5 ? "bg-emerald-50 text-emerald-700 border-emerald-200"
    : s >= 2.5 ? "bg-amber-50 text-amber-700 border-amber-200"
    : "bg-red-50 text-red-700 border-red-200";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full border ${color} text-sm font-semibold`}>
      {s}/5
    </span>
  );
}

function StageBadge({ c }: { c: Candidate }) {
  if (c.selected_count > 0) return <span className="px-2.5 py-1 bg-emerald-500 text-white text-xs font-bold rounded-full">Selected</span>;
  if (c.pending_interviews > 0) return <span className="px-2.5 py-1 bg-purple-50 text-purple-700 text-xs font-medium rounded-full">Interview Ready</span>;
  if (c.completed_interviews > 0 && c.rejected_count > 0 && c.selected_count === 0) return <span className="px-2.5 py-1 bg-gray-100 text-gray-600 text-xs font-medium rounded-full">Rejected</span>;
  if (c.completed_interviews > 0) return <span className="px-2.5 py-1 bg-teal-50 text-teal-700 text-xs font-medium rounded-full">Completed</span>;
  if (c.ats_failed_count > 0 && c.total_applications === c.ats_failed_count) return <span className="px-2.5 py-1 bg-red-50 text-red-700 text-xs font-medium rounded-full">ATS Failed</span>;
  if (c.total_applications > 0) return <span className="px-2.5 py-1 bg-blue-50 text-blue-700 text-xs font-medium rounded-full">Applied</span>;
  return <span className="px-2.5 py-1 bg-gray-100 text-gray-500 text-xs rounded-full">No Applications</span>;
}

function TimeAgo({ date }: { date: string | null }) {
  if (!date) return <span className="text-gray-400">—</span>;
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  const hrs = Math.floor(mins / 60);
  const days = Math.floor(hrs / 24);
  const str = days > 0 ? `${days}d ago` : hrs > 0 ? `${hrs}h ago` : mins > 0 ? `${mins}m ago` : "just now";
  return <span className="text-sm text-gray-500">{str}</span>;
}

export default function AdminCandidatesPage() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [stage, setStage] = useState("all");
  const [sortBy, setSortBy] = useState("last_activity");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const pageSize = 20;
  const totalPages = Math.ceil(total / pageSize);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  const fetchCandidates = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        search: debouncedSearch,
        stage,
        sort: sortBy,
        dir: sortDir,
        page: String(page),
      });
      const res = await fetch(`/api/admin/candidates?${params}`);
      if (res.ok) {
        const data = await res.json();
        setCandidates(data.candidates);
        setStats(data.stats);
        setTotal(data.total);
      }
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, stage, sortBy, sortDir, page]);

  useEffect(() => { fetchCandidates(); }, [fetchCandidates]);
  useEffect(() => { setPage(1); }, [debouncedSearch, stage, sortBy, sortDir]);

  const toggleSort = (field: string) => {
    if (sortBy === field) setSortDir(d => d === "desc" ? "asc" : "desc");
    else { setSortBy(field); setSortDir("desc"); }
  };

  const exportCSV = () => {
    const headers = ["Name", "Email", "Global ATS", "Applications", "Pending", "Completed", "Selected", "Stage", "Last Activity"];
    const rows = candidates.map(c => [
      c.name || "", c.email, c.global_ats_score ?? "", c.total_applications,
      c.pending_interviews, c.completed_interviews, c.selected_count,
      c.selected_count > 0 ? "Selected" : c.pending_interviews > 0 ? "Interview Ready" : c.completed_interviews > 0 ? "Completed" : "Applied",
      c.last_activity ? new Date(c.last_activity).toLocaleDateString() : "",
    ]);
    const csv = [headers, ...rows].map(r => r.map((v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `candidates_${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const SortIcon = ({ field }: { field: string }) => (
    <svg className={`w-3 h-3 ml-1 inline-block ${sortBy === field ? "text-indigo-600" : "text-gray-300"} ${sortBy === field && sortDir === "asc" ? "rotate-180" : ""}`}
      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );

  return (
    <DashboardLayout>
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Candidates</h1>
            <p className="text-sm text-gray-500 mt-0.5">Monitor and decide on all job applicants</p>
          </div>
          <button onClick={exportCSV} disabled={candidates.length === 0}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 disabled:opacity-40 transition-colors shadow-sm">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Export CSV
          </button>
        </div>

        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-8">
            {[
              { label: "Total Candidates", value: stats.total_candidates, color: "text-gray-900" },
              { label: "Pending Review",   value: stats.pending_review,   color: "text-purple-700" },
              { label: "Selected",         value: stats.selected,         color: "text-emerald-700" },
              { label: "ATS Failed",       value: stats.ats_failed,       color: "text-red-700" },
              { label: "Avg ATS Score",    value: stats.avg_global_ats != null ? `${Math.round(stats.avg_global_ats)}` : "—", color: "text-indigo-700" },
            ].map((s) => (
              <div key={s.label} className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">

                <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
                <div className="text-xs text-gray-500 mt-0.5 leading-tight">{s.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Search + Sort */}
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <div className="relative flex-1">
            <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input type="text" placeholder="Search by name or email…"
              value={search} onChange={e => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white shadow-sm" />
          </div>
          <div className="flex items-center gap-2">
            <select value={sortBy} onChange={e => setSortBy(e.target.value)}
              className="px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white shadow-sm">
              {SORTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
            <button onClick={() => setSortDir(d => d === "desc" ? "asc" : "desc")}
              className="p-2.5 border border-gray-200 rounded-xl bg-white hover:bg-gray-50 transition-colors shadow-sm" title="Toggle sort direction">
              <svg className={`w-4 h-4 text-gray-600 transition-transform ${sortDir === "asc" ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Stage Filter Tabs */}
        <div className="flex gap-1.5 flex-wrap mb-6">
          {STAGES.map(s => (
            <button key={s.key} onClick={() => setStage(s.key)}
              className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition-all ${
                stage === s.key
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
              }`}>
              {s.label}
            </button>
          ))}
        </div>

        {/* Table */}
        {loading ? (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            {[1,2,3,4,5].map(i => (
              <div key={i} className="px-6 py-4 border-b border-gray-50 flex items-center gap-4 animate-pulse">
                <div className="w-10 h-10 bg-gray-100 rounded-full" />
                <div className="flex-1">
                  <div className="h-4 bg-gray-100 rounded w-40 mb-1.5" />
                  <div className="h-3 bg-gray-100 rounded w-56" />
                </div>
                <div className="h-6 bg-gray-100 rounded-full w-24" />
                <div className="h-6 bg-gray-100 rounded-full w-12" />
              </div>
            ))}
          </div>
        ) : candidates.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-16 text-center">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
              </svg>
            </div>
            <p className="text-gray-900 font-semibold mb-1">No candidates found</p>
            <p className="text-sm text-gray-500">
              {search ? `No results for "${search}"` : "No candidates match the selected filter."}
            </p>
            {(search || stage !== "all") && (
              <button onClick={() => { setSearch(""); setStage("all"); }}
                className="mt-4 text-sm text-indigo-600 hover:underline font-medium">
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            {/* Table header */}
            <div className="hidden md:grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_100px] gap-4 px-6 py-3 bg-gray-50 border-b border-gray-100 text-xs font-semibold text-gray-500 uppercase tracking-wide">
              <button className="text-left hover:text-gray-700 flex items-center" onClick={() => toggleSort("name")}>
                Candidate <SortIcon field="name" />
              </button>
              <button className="text-left hover:text-gray-700 flex items-center" onClick={() => toggleSort("global_ats")}>
                Interview Score <SortIcon field="global_ats" />
              </button>
              <span>Stage</span>
              <button className="text-left hover:text-gray-700 flex items-center" onClick={() => toggleSort("applications")}>
                Apps <SortIcon field="applications" />
              </button>
              <span>Interviews</span>
              <button className="text-left hover:text-gray-700 flex items-center" onClick={() => toggleSort("last_activity")}>
                Last Active <SortIcon field="last_activity" />
              </button>
              <span />
            </div>

            {/* Rows */}
            <div className="divide-y divide-gray-50">
              {candidates.map(c => {
                const initials = (c.name || c.email).slice(0, 2).toUpperCase();
                const hue = c.id.charCodeAt(0) % 6;
                const avatarColors = ["bg-indigo-100 text-indigo-700","bg-purple-100 text-purple-700","bg-teal-100 text-teal-700","bg-rose-100 text-rose-700","bg-amber-100 text-amber-700","bg-sky-100 text-sky-700"];
                return (
                  <div key={c.id}
                    className="grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_100px] gap-4 px-6 py-4 items-center hover:bg-gray-50/60 transition-colors group">
                    {/* Candidate */}
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 ${avatarColors[hue]}`}>
                        {initials}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-900 truncate">{c.name || "—"}</p>
                        <p className="text-xs text-gray-500 truncate">{c.email}</p>
                        {c.resume_filename && (
                          <p className="text-xs text-gray-400 truncate">{c.resume_filename}</p>
                        )}
                      </div>
                    </div>

                    {/* Interview Score (combined or overall, x/5) */}
                    <div className="flex items-center gap-2">
                      <InterviewScorePill score={c.best_combined_score ?? c.best_interview_score} />
                      {(c.best_combined_score == null && c.best_interview_score == null) && c.global_ats_score != null && (
                        <span className="text-xs text-gray-400 hidden xl:block">ATS {Math.round(c.global_ats_score)}</span>
                      )}
                    </div>

                    {/* Stage */}
                    <div><StageBadge c={c} /></div>

                    {/* Apps count */}
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-semibold text-gray-900">{c.total_applications}</span>
                      {c.ats_failed_count > 0 && (
                        <span className="text-xs text-red-600 bg-red-50 px-1.5 py-0.5 rounded-full">{c.ats_failed_count} failed</span>
                      )}
                    </div>

                    {/* Interviews */}
                    <div className="flex items-center gap-2 flex-wrap">
                      {c.pending_interviews > 0 && (
                        <span className="text-xs px-1.5 py-0.5 bg-purple-50 text-purple-700 rounded-full">{c.pending_interviews} pending</span>
                      )}
                      {c.completed_interviews > 0 && (
                        <span className="text-xs px-1.5 py-0.5 bg-teal-50 text-teal-700 rounded-full">{c.completed_interviews} done</span>
                      )}
                      {c.pending_interviews === 0 && c.completed_interviews === 0 && (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </div>

                    {/* Last Active */}
                    <div><TimeAgo date={c.last_activity} /></div>

                    {/* Action */}
                    <div className="flex justify-end">
                      <Link href={`/admin/candidates/${c.id}`}
                        className="px-3 py-1.5 text-xs font-semibold text-indigo-600 bg-indigo-50 rounded-lg hover:bg-indigo-100 transition-colors">
                        Review →
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Pagination footer */}
            <div className="px-6 py-3 border-t border-gray-100 bg-gray-50/60 flex items-center justify-between">
              <p className="text-xs text-gray-500">
                {Math.min((page - 1) * pageSize + 1, total)}–{Math.min(page * pageSize, total)} of {total} candidate{total !== 1 ? "s" : ""}
              </p>
              {totalPages > 1 && (
                <div className="flex items-center gap-1">
                  <button disabled={page === 1} onClick={() => setPage(p => p - 1)}
                    className="px-3 py-1.5 text-xs font-medium bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 transition-colors">
                    ← Prev
                  </button>
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    const p = totalPages <= 5 ? i + 1 : Math.max(1, Math.min(page - 2, totalPages - 4)) + i;
                    return (
                      <button key={p} onClick={() => setPage(p)}
                        className={`w-8 h-8 text-xs font-medium rounded-lg transition-colors ${page === p ? "bg-indigo-600 text-white" : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"}`}>
                        {p}
                      </button>
                    );
                  })}
                  <button disabled={page === totalPages} onClick={() => setPage(p => p + 1)}
                    className="px-3 py-1.5 text-xs font-medium bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 transition-colors">
                    Next →
                  </button>
                </div>
              )}
              <p className="text-xs text-gray-400">Click a row to review</p>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
