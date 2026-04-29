"use client";

import { useState, useEffect, useCallback } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface TaskSubmission {
  id: string;
  task_id: string;
  candidate_id: string;
  candidate_name: string | null;
  repo_url: string;
  submitted_at: string;
  status: "submitted" | "evaluating" | "evaluated";
  evaluation_id: string | null;
  decision: "pending" | "selected" | "rejected";
  evaluation_result: EvalResult | null;
  task_title: string;
  task_description: string;
  deadline: string;
}

interface AdminTask {
  id: string;
  title: string;
  description: string;
  deadline: string;
  created_at: string;
  submission_count: number;
}

// Per-candidate assigned task
interface AssignedTask {
  id: string;
  title: string;
  description: string;
  deadline: string;
  duration_hours: number | null;
  status: string;
  created_at: string;
  candidate_id: string;
  candidate_name: string | null;
  candidate_email: string | null;
  application_id: string | null;
  submission_count: number;
  latest_submission: AssignedSubmission | null;
}

interface AssignedSubmission {
  id: string;
  repo_url: string;
  submitted_at: string;
  status: string;
  decision: string;
  evaluation_result: EvalResult | null;
}

interface CandidateOption {
  id: string;
  name: string;
  email: string;
}

interface EvalResult {
  overall_score?: number;
  overall_grade?: string;
  hiring_grade?: string;
  recommendation?: string;
  summary_feedback?: string;
  matched_requirements?: string[];
  missing_features?: string[];
  improvement_suggestions?: string[];
  interviewer_notes?: string;
  languages?: string[];
  total_files?: number;
  total_findings?: number;
  repo_age_days?: number;
}

type Tab = "submissions" | "assign" | "tasks";

// ─── Badges ────────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    submitted:  "bg-blue-50 text-blue-700 border-blue-200",
    evaluating: "bg-amber-50 text-amber-700 border-amber-200",
    evaluated:  "bg-emerald-50 text-emerald-700 border-emerald-200",
    assigned:   "bg-purple-50 text-purple-700 border-purple-200",
    completed:  "bg-emerald-50 text-emerald-700 border-emerald-200",
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${map[status] || "bg-gray-50 text-gray-500 border-gray-200"}`}>
      {status === "evaluating" && (
        <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
          <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-75" />
        </svg>
      )}
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

function DecisionBadge({ decision }: { decision: string }) {
  if (decision === "pending") return <span className="text-gray-400 text-xs">—</span>;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${
      decision === "selected" ? "bg-green-50 text-green-700 border-green-200" : "bg-red-50 text-red-700 border-red-200"
    }`}>
      {decision.charAt(0).toUpperCase() + decision.slice(1)}
    </span>
  );
}

// ─── Evaluation detail panel (global submissions) ──────────────────────────────

function EvalPanel({
  sub,
  onClose,
  onDecision,
}: {
  sub: TaskSubmission;
  onClose: () => void;
  onDecision: (id: string, d: "selected" | "rejected" | "pending") => void;
}) {
  const [deciding, setDeciding] = useState(false);
  const eval_ = sub.evaluation_result;

  async function decide(decision: "selected" | "rejected" | "pending") {
    setDeciding(true);
    try {
      await fetch(`/api/admin/task-submissions/${sub.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      onDecision(sub.id, decision);
    } finally {
      setDeciding(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end bg-black/30 backdrop-blur-sm" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-2xl h-full bg-white shadow-2xl overflow-y-auto flex flex-col">
        <div className="bg-indigo-600 px-6 py-5 shrink-0">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold text-indigo-200 uppercase tracking-wider mb-1">Global Task Evaluation</p>
              <h2 className="text-xl font-bold text-white">{sub.candidate_name || sub.candidate_id}</h2>
              <p className="text-sm text-indigo-200 mt-0.5">{sub.task_title}</p>
            </div>
            <button onClick={onClose} className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center text-white shrink-0">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </div>

        <div className="flex-1 p-6 space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-gray-50 rounded-xl px-4 py-3">
              <p className="text-xs text-gray-400 mb-0.5">Candidate</p>
              <p className="text-sm font-medium text-gray-800 truncate">{sub.candidate_id}</p>
            </div>
            <div className="bg-gray-50 rounded-xl px-4 py-3">
              <p className="text-xs text-gray-400 mb-0.5">Submitted</p>
              <p className="text-sm font-medium text-gray-800">{new Date(sub.submitted_at).toLocaleString()}</p>
            </div>
            <div className="bg-gray-50 rounded-xl px-4 py-3 col-span-2">
              <p className="text-xs text-gray-400 mb-0.5">Repository</p>
              <a href={sub.repo_url} target="_blank" rel="noopener noreferrer" className="text-sm font-mono text-indigo-600 hover:underline break-all">{sub.repo_url}</a>
            </div>
          </div>

          <DecisionPanel decision={sub.decision} onDecide={decide} deciding={deciding} />
          <EvalDetails eval_={eval_} status={sub.status} />
        </div>
      </div>
    </div>
  );
}

// ─── Assigned task detail panel ────────────────────────────────────────────────

function AssignedEvalPanel({
  task,
  onClose,
  onDecision,
}: {
  task: AssignedTask;
  onClose: () => void;
  onDecision: (submissionId: string, d: "selected" | "rejected" | "pending") => void;
}) {
  const [deciding, setDeciding] = useState(false);
  const sub = task.latest_submission;
  const eval_ = sub?.evaluation_result;

  async function decide(decision: "selected" | "rejected" | "pending") {
    if (!sub) return;
    setDeciding(true);
    try {
      await fetch(`/api/admin/task-assignments/${sub.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      onDecision(sub.id, decision);
    } finally {
      setDeciding(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end bg-black/30 backdrop-blur-sm" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-2xl h-full bg-white shadow-2xl overflow-y-auto flex flex-col">
        <div className="bg-violet-600 px-6 py-5 shrink-0">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold text-violet-200 uppercase tracking-wider mb-1">Assigned Task</p>
              <h2 className="text-xl font-bold text-white">{task.candidate_name || task.candidate_email || task.candidate_id}</h2>
              <p className="text-sm text-violet-200 mt-0.5">{task.title}</p>
            </div>
            <button onClick={onClose} className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center text-white shrink-0">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </div>

        <div className="flex-1 p-6 space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-gray-50 rounded-xl px-4 py-3">
              <p className="text-xs text-gray-400 mb-0.5">Candidate</p>
              <p className="text-sm font-medium text-gray-800">{task.candidate_name || "—"}</p>
              <p className="text-xs text-gray-400 mt-0.5 truncate">{task.candidate_email}</p>
            </div>
            <div className="bg-gray-50 rounded-xl px-4 py-3">
              <p className="text-xs text-gray-400 mb-0.5">Deadline</p>
              <p className={`text-sm font-medium ${new Date() > new Date(task.deadline) ? "text-red-600" : "text-gray-800"}`}>
                {new Date(task.deadline).toLocaleString()}
              </p>
            </div>
            <div className="bg-gray-50 rounded-xl px-4 py-3 col-span-2">
              <p className="text-xs text-gray-400 mb-0.5">Task</p>
              <p className="text-sm font-medium text-gray-800">{task.title}</p>
              <p className="text-xs text-gray-500 mt-1 line-clamp-3">{task.description}</p>
            </div>
            {sub && (
              <div className="bg-gray-50 rounded-xl px-4 py-3 col-span-2">
                <p className="text-xs text-gray-400 mb-0.5">Repository Submitted</p>
                <a href={sub.repo_url} target="_blank" rel="noopener noreferrer" className="text-sm font-mono text-violet-600 hover:underline break-all">{sub.repo_url}</a>
                <p className="text-xs text-gray-400 mt-1">Submitted {new Date(sub.submitted_at).toLocaleString()}</p>
              </div>
            )}
          </div>

          {sub ? (
            <>
              <DecisionPanel decision={sub.decision} onDecide={decide} deciding={deciding} />
              <EvalDetails eval_={eval_} status={sub.status} />
            </>
          ) : (
            <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-4 text-center">
              <p className="text-sm font-medium text-amber-700">No submission yet</p>
              <p className="text-xs text-amber-600 mt-0.5">The candidate hasn't submitted their repository.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Shared sub-components ────────────────────────────────────────────────────

function DecisionPanel({ decision, onDecide, deciding }: {
  decision: string;
  onDecide: (d: "selected" | "rejected" | "pending") => void;
  deciding: boolean;
}) {
  return (
    <div className={`rounded-xl border p-4 space-y-3 ${
      decision === "selected" ? "bg-green-50 border-green-200" :
      decision === "rejected" ? "bg-red-50 border-red-200" :
      "bg-gray-50 border-gray-200"
    }`}>
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Decision</p>
      {decision !== "pending" ? (
        <div className="flex items-center gap-3">
          <span className={`text-sm font-semibold ${decision === "selected" ? "text-green-700" : "text-red-700"}`}>
            {decision === "selected" ? "Candidate Selected" : "Candidate Rejected"}
          </span>
          <button onClick={() => onDecide("pending")} disabled={deciding} className="ml-auto text-xs text-gray-500 hover:text-gray-700 underline">Undo</button>
        </div>
      ) : (
        <div className="flex gap-3">
          <button onClick={() => onDecide("selected")} disabled={deciding}
            className="flex-1 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors flex items-center justify-center gap-2">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
            Select
          </button>
          <button onClick={() => onDecide("rejected")} disabled={deciding}
            className="flex-1 bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors flex items-center justify-center gap-2">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            Reject
          </button>
        </div>
      )}
    </div>
  );
}

function EvalDetails({ eval_, status }: { eval_: EvalResult | null | undefined; status: string }) {
  if (!eval_) {
    if (status === "evaluating" || status === "submitted") {
      return (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-100 rounded-xl px-4 py-4">
          <svg className="w-5 h-5 animate-spin text-amber-500 shrink-0" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
            <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-75" />
          </svg>
          <p className="text-sm font-medium text-amber-700">Evaluation in progress…</p>
        </div>
      );
    }
    return null;
  }

  const score = eval_.overall_score ?? 0;
  const scoreColor = score >= 70 ? "text-emerald-600" : score >= 50 ? "text-amber-500" : "text-red-500";

  return (
    <div className="space-y-4">
      <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-5 flex items-center gap-5">
        <div className="text-center shrink-0">
          <p className={`text-4xl font-bold ${scoreColor}`}>{Math.round(score)}</p>
          <p className="text-xs text-indigo-400">/100</p>
        </div>
        <div className="w-px h-12 bg-indigo-200" />
        <div className="space-y-1">
          {eval_.overall_grade && <p className="text-sm text-indigo-700">Grade: <span className="font-bold">{eval_.overall_grade}</span></p>}
          {eval_.hiring_grade && <p className="text-sm text-indigo-700">Hiring: <span className="font-bold">{eval_.hiring_grade}</span></p>}
          {eval_.recommendation && <p className="text-sm text-indigo-600">{eval_.recommendation}</p>}
        </div>
      </div>

      {eval_.languages && eval_.languages.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Languages</p>
          <div className="flex flex-wrap gap-2">
            {eval_.languages.map((l) => <span key={l} className="px-2.5 py-1 bg-indigo-50 text-indigo-700 rounded-lg text-xs font-medium border border-indigo-100">{l}</span>)}
          </div>
        </div>
      )}

      {eval_.summary_feedback && (
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Summary</p>
          <div className="bg-gray-50 rounded-xl p-4 text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{eval_.summary_feedback}</div>
        </div>
      )}

      {eval_.matched_requirements && eval_.matched_requirements.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Matched</p>
          <ul className="space-y-1">
            {eval_.matched_requirements.map((r, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-emerald-700">
                <svg className="w-4 h-4 mt-0.5 shrink-0 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                {r}
              </li>
            ))}
          </ul>
        </div>
      )}

      {eval_.missing_features && eval_.missing_features.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Missing</p>
          <ul className="space-y-1">
            {eval_.missing_features.map((f, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-red-700">
                <svg className="w-4 h-4 mt-0.5 shrink-0 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                {f}
              </li>
            ))}
          </ul>
        </div>
      )}

      {eval_.interviewer_notes && (
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Interviewer Notes</p>
          <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 text-sm text-amber-800 leading-relaxed whitespace-pre-wrap">{eval_.interviewer_notes}</div>
        </div>
      )}
    </div>
  );
}

// ─── Assign Task Tab ──────────────────────────────────────────────────────────

function AssignTaskTab() {
  const [assignedTasks, setAssignedTasks] = useState<AssignedTask[]>([]);
  const [candidates, setCandidates] = useState<CandidateOption[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(true);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [selectedTask, setSelectedTask] = useState<AssignedTask | null>(null);

  const [form, setForm] = useState({
    title: "",
    description: "",
    deadline: "",
    durationHours: "",
    useDeadline: true,
    candidateId: "",
    candidateSearch: "",
  });

  const [candidateDropdownOpen, setCandidateDropdownOpen] = useState(false);

  async function loadData() {
    const [tasksRes, candidatesRes] = await Promise.all([
      fetch("/api/admin/task-assignments").catch(() => null),
      fetch("/api/admin/candidates?sort=name&dir=asc").catch(() => null),
    ]);
    if (tasksRes?.ok) setAssignedTasks(await tasksRes.json());
    if (candidatesRes?.ok) {
      const d = await candidatesRes.json();
      setCandidates((d.candidates || []).map((c: { id: string; name: string; email: string }) => ({ id: c.id, name: c.name, email: c.email })));
    }
    setLoadingTasks(false);
  }

  useEffect(() => { loadData(); }, []);

  const filteredCandidates = candidates.filter((c) =>
    !form.candidateSearch ||
    c.name?.toLowerCase().includes(form.candidateSearch.toLowerCase()) ||
    c.email?.toLowerCase().includes(form.candidateSearch.toLowerCase())
  );

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    if (!form.title.trim() || !form.description.trim() || !form.candidateId) {
      setFormError("Title, description, and candidate are required.");
      return;
    }
    if (form.useDeadline && !form.deadline) {
      setFormError("Please set a deadline date.");
      return;
    }
    if (!form.useDeadline && !form.durationHours) {
      setFormError("Please set a duration in hours.");
      return;
    }

    setCreating(true);
    try {
      const body: Record<string, unknown> = {
        title: form.title.trim(),
        description: form.description.trim(),
        candidateId: form.candidateId,
      };
      if (form.useDeadline) {
        body.deadline = form.deadline;
      } else {
        body.durationHours = parseFloat(form.durationHours);
      }

      const res = await fetch("/api/admin/task-assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) { setFormError(json.error || "Failed to assign task"); return; }

      console.log("[TaskAssign] Created task:", json.task?.id, "for candidate:", form.candidateId);

      // Optimistic update — show task immediately without waiting for re-fetch
      const candidate = candidates.find((c) => c.id === form.candidateId);
      const optimistic: AssignedTask = {
        id: json.task.id,
        title: json.task.title,
        description: json.task.description,
        deadline: json.task.deadline,
        duration_hours: !form.useDeadline ? parseFloat(form.durationHours) : null,
        status: "assigned",
        created_at: json.task.created_at || new Date().toISOString(),
        candidate_id: form.candidateId,
        candidate_name: candidate?.name || null,
        candidate_email: candidate?.email || null,
        application_id: null,
        submission_count: 0,
        latest_submission: null,
      };
      setAssignedTasks((prev) => [optimistic, ...prev]);
      setForm({ title: "", description: "", deadline: "", durationHours: "", useDeadline: true, candidateId: "", candidateSearch: "" });
      setShowForm(false);
      // Background re-fetch to sync server state (don't block UI on this)
      loadData().catch(console.error);
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this task assignment?")) return;
    const res = await fetch(`/api/admin/task-assignments/${id}`, { method: "DELETE" });
    const json = await res.json();
    if (!res.ok) { alert(json.error || "Delete failed"); return; }
    setAssignedTasks((prev) => prev.filter((t) => t.id !== id));
  }

  function handleDecision(submissionId: string, decision: "selected" | "rejected" | "pending") {
    setAssignedTasks((prev) =>
      prev.map((t) =>
        t.latest_submission?.id === submissionId
          ? { ...t, latest_submission: { ...t.latest_submission!, decision } }
          : t
      )
    );
    setSelectedTask((prev) =>
      prev?.latest_submission?.id === submissionId
        ? { ...prev, latest_submission: { ...prev.latest_submission!, decision } }
        : prev
    );
  }

  const minDeadline = new Date(Date.now() + 3600000).toISOString().slice(0, 16);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-800">Assigned Tasks</h2>
          <p className="text-xs text-gray-500 mt-0.5">Assign tasks directly to specific candidates after their interview.</p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold rounded-xl transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
          {showForm ? "Cancel" : "Assign Task"}
        </button>
      </div>

      {/* Create form */}
      {showForm && (
        <form onSubmit={handleCreate} className="bg-white rounded-2xl border border-violet-100 shadow-sm p-6 space-y-4">
          <h3 className="text-sm font-semibold text-gray-700">Assign Task to Candidate</h3>

          {/* Candidate picker */}
          <div className="relative">
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Candidate <span className="text-red-400">*</span></label>
            {form.candidateId ? (
              <div className="flex items-center gap-3 bg-violet-50 border border-violet-200 rounded-xl px-4 py-2.5">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900">{candidates.find((c) => c.id === form.candidateId)?.name}</p>
                  <p className="text-xs text-gray-500 truncate">{candidates.find((c) => c.id === form.candidateId)?.email}</p>
                </div>
                <button type="button" onClick={() => setForm((f) => ({ ...f, candidateId: "", candidateSearch: "" }))} className="text-xs text-violet-600 hover:text-violet-800 underline whitespace-nowrap">Change</button>
              </div>
            ) : (
              <div>
                <input
                  value={form.candidateSearch}
                  onChange={(e) => { setForm((f) => ({ ...f, candidateSearch: e.target.value })); setCandidateDropdownOpen(true); }}
                  onFocus={() => setCandidateDropdownOpen(true)}
                  placeholder="Search by name or email…"
                  className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400 focus:border-transparent"
                />
                {candidateDropdownOpen && filteredCandidates.length > 0 && (
                  <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-52 overflow-y-auto">
                    {filteredCandidates.slice(0, 20).map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => { setForm((f) => ({ ...f, candidateId: c.id, candidateSearch: c.name || c.email })); setCandidateDropdownOpen(false); }}
                        className="w-full text-left px-4 py-3 hover:bg-violet-50 transition-colors border-b border-gray-50 last:border-0"
                      >
                        <p className="text-sm font-medium text-gray-900">{c.name || "—"}</p>
                        <p className="text-xs text-gray-500">{c.email}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Task Title <span className="text-red-400">*</span></label>
            <input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="e.g. Build a REST API with authentication"
              className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Task Description <span className="text-red-400">*</span></label>
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              rows={4}
              placeholder="Describe requirements, acceptance criteria, and what to build…"
              className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400 focus:border-transparent resize-none"
            />
          </div>

          {/* Deadline mode toggle */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-2">Deadline <span className="text-red-400">*</span></label>
            <div className="flex gap-2 mb-3">
              <button type="button" onClick={() => setForm((f) => ({ ...f, useDeadline: true }))}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${form.useDeadline ? "bg-violet-600 text-white border-violet-600" : "bg-white text-gray-600 border-gray-200"}`}>
                Specific Date
              </button>
              <button type="button" onClick={() => setForm((f) => ({ ...f, useDeadline: false }))}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${!form.useDeadline ? "bg-violet-600 text-white border-violet-600" : "bg-white text-gray-600 border-gray-200"}`}>
                Duration (hours)
              </button>
            </div>
            {form.useDeadline ? (
              <input
                type="datetime-local"
                min={minDeadline}
                value={form.deadline}
                onChange={(e) => setForm((f) => ({ ...f, deadline: e.target.value }))}
                className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400 focus:border-transparent"
              />
            ) : (
              <div className="relative">
                <input
                  type="number"
                  min="1"
                  step="0.5"
                  value={form.durationHours}
                  onChange={(e) => setForm((f) => ({ ...f, durationHours: e.target.value }))}
                  placeholder="48"
                  className="w-full border border-gray-300 rounded-xl px-4 py-2.5 pr-16 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400 focus:border-transparent"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-gray-400">hours</span>
              </div>
            )}
          </div>

          {formError && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              <p className="text-xs text-red-600 font-medium">{formError}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={creating}
            className="w-full bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors flex items-center justify-center gap-2"
          >
            {creating ? (
              <>
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" /><path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-75" /></svg>
                Assigning…
              </>
            ) : "Assign Task"}
          </button>
        </form>
      )}

      {/* Assigned tasks list */}
      {loadingTasks ? (
        <div className="flex items-center justify-center py-16"><div className="w-7 h-7 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" /></div>
      ) : assignedTasks.length === 0 ? (
        <div className="bg-white rounded-2xl border border-dashed border-gray-200 p-12 text-center">
          <div className="w-12 h-12 mx-auto rounded-full bg-violet-50 flex items-center justify-center mb-3">
            <svg className="w-6 h-6 text-violet-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
          </div>
          <p className="text-sm font-semibold text-gray-600">No tasks assigned yet</p>
          <p className="text-xs text-gray-400 mt-1">Assign a task to a candidate above — they'll see it in their portal immediately.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {assignedTasks.map((task) => {
            const isPast = new Date() > new Date(task.deadline);
            const sub = task.latest_submission;
            return (
              <div
                key={task.id}
                onClick={() => setSelectedTask(task)}
                className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 cursor-pointer hover:border-violet-300 hover:shadow-md transition-all"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <h3 className="text-sm font-semibold text-gray-900">{task.title}</h3>
                      <StatusBadge status={sub ? sub.status : (isPast ? "expired" : task.status)} />
                      {sub && <DecisionBadge decision={sub.decision} />}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-gray-500 flex-wrap">
                      <span className="font-medium text-violet-700">{task.candidate_name || task.candidate_email}</span>
                      <span>·</span>
                      <span className={isPast ? "text-red-500" : "text-gray-500"}>
                        {isPast ? "Deadline passed" : `Due ${new Date(task.deadline).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`}
                      </span>
                      {sub && (
                        <>
                          <span>·</span>
                          <span>Submitted {new Date(sub.submitted_at).toLocaleDateString()}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {Number(task.submission_count) === 0 && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(task.id); }}
                        className="w-7 h-7 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 flex items-center justify-center transition-colors"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </button>
                    )}
                    <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                  </div>
                </div>
                {sub?.evaluation_result && (
                  <div className="mt-3 pt-3 border-t border-gray-100 flex items-center gap-3">
                    <span className={`text-lg font-bold ${(sub.evaluation_result as EvalResult).overall_score! >= 70 ? "text-emerald-600" : (sub.evaluation_result as EvalResult).overall_score! >= 50 ? "text-amber-600" : "text-red-500"}`}>
                      {Math.round((sub.evaluation_result as EvalResult).overall_score ?? 0)}
                    </span>
                    <span className="text-xs text-gray-400">/100</span>
                    {(sub.evaluation_result as EvalResult).overall_grade && (
                      <span className="ml-1 text-xs font-medium text-gray-600">Grade {(sub.evaluation_result as EvalResult).overall_grade}</span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {selectedTask && (
        <AssignedEvalPanel
          task={selectedTask}
          onClose={() => setSelectedTask(null)}
          onDecision={handleDecision}
        />
      )}
    </div>
  );
}

// ─── Global task management tab ────────────────────────────────────────────────

function ManageTasksTab() {
  const [tasks, setTasks] = useState<AdminTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", deadline: "" });

  async function loadTasks() {
    const res = await fetch("/api/admin/tasks").catch(() => null);
    if (res?.ok) setTasks(await res.json());
    setLoading(false);
  }

  useEffect(() => { loadTasks(); }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    if (!form.title.trim() || !form.description.trim() || !form.deadline) {
      setFormError("All fields are required.");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/admin/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!res.ok) { setFormError(json.error || "Failed to create task"); return; }

      console.log("[GlobalTask] Created task:", json.task?.id);

      // Optimistic update — show task immediately without waiting for re-fetch
      const optimistic: AdminTask = {
        id: json.task.id,
        title: json.task.title,
        description: json.task.description,
        deadline: json.task.deadline,
        created_at: json.task.created_at || new Date().toISOString(),
        submission_count: 0,
      };
      setTasks((prev) => [optimistic, ...prev]);
      setForm({ title: "", description: "", deadline: "" });
      setShowForm(false);
      // Background re-fetch to sync
      loadTasks().catch(console.error);
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this task?")) return;
    const res = await fetch(`/api/admin/tasks?id=${id}`, { method: "DELETE" });
    const json = await res.json();
    if (!res.ok) { alert(json.error || "Delete failed"); return; }
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }

  const minDeadline = new Date(Date.now() + 3600000).toISOString().slice(0, 16);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-800">Global Task Library</h2>
          <p className="text-xs text-gray-500 mt-0.5">Global tasks are visible to all candidates who completed an interview.</p>
        </div>
        <button onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-xl transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
          {showForm ? "Cancel" : "Create Global Task"}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="bg-white rounded-2xl border border-indigo-100 shadow-sm p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Title <span className="text-red-400">*</span></label>
            <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="e.g. Build a REST API with authentication"
              className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Description <span className="text-red-400">*</span></label>
            <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              rows={4} placeholder="Describe requirements and acceptance criteria…"
              className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent resize-none" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Deadline <span className="text-red-400">*</span></label>
            <input type="datetime-local" min={minDeadline} value={form.deadline} onChange={(e) => setForm((f) => ({ ...f, deadline: e.target.value }))}
              className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent" />
          </div>
          {formError && <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3"><p className="text-xs text-red-600 font-medium">{formError}</p></div>}
          <button type="submit" disabled={creating}
            className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors flex items-center justify-center gap-2">
            {creating ? (<><svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" /><path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-75" /></svg>Creating…</>) : "Create Task"}
          </button>
        </form>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16"><div className="w-7 h-7 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" /></div>
      ) : tasks.length === 0 ? (
        <div className="bg-white rounded-2xl border border-dashed border-gray-200 p-12 text-center">
          <p className="text-sm font-semibold text-gray-600">No global tasks yet</p>
          <p className="text-xs text-gray-400 mt-1">Create one above — all candidates with completed interviews will see it.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {tasks.map((task) => {
            const isPast = new Date() > new Date(task.deadline);
            return (
              <div key={task.id} className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-semibold text-gray-900">{task.title}</h3>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${isPast ? "bg-gray-50 text-gray-500 border-gray-200" : "bg-emerald-50 text-emerald-700 border-emerald-200"}`}>
                        {isPast ? "Expired" : "Active"}
                      </span>
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-600 border border-indigo-100">
                        {task.submission_count} submission{task.submission_count !== 1 ? "s" : ""}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1 line-clamp-2">{task.description}</p>
                    <p className={`text-xs mt-1.5 font-medium ${isPast ? "text-red-500" : "text-teal-600"}`}>
                      Deadline: {new Date(task.deadline).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                  {Number(task.submission_count) === 0 && (
                    <button onClick={() => handleDelete(task.id)} className="shrink-0 w-8 h-8 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 flex items-center justify-center transition-colors">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function TaskEvaluationsPage() {
  const [rows, setRows] = useState<TaskSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSub, setSelectedSub] = useState<TaskSubmission | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | "submitted" | "evaluating" | "evaluated">("all");
  const [activeTab, setActiveTab] = useState<Tab>("assign");

  const loadSubmissions = useCallback(async () => {
    const res = await fetch("/api/admin/task-submissions").catch(() => null);
    if (!res?.ok) return;
    setRows(await res.json());
  }, []);

  useEffect(() => {
    loadSubmissions().finally(() => setLoading(false));
  }, [loadSubmissions]);

  useEffect(() => {
    const hasEvaluating = rows.some((r) => r.status === "evaluating" || r.status === "submitted");
    if (!hasEvaluating) return;
    const t = setInterval(loadSubmissions, 15000);
    return () => clearInterval(t);
  }, [rows, loadSubmissions]);

  function handleDecision(id: string, decision: "selected" | "rejected" | "pending") {
    setRows((prev) => prev.map((r) => r.id === id ? { ...r, decision } : r));
    setSelectedSub((prev) => prev?.id === id ? { ...prev, decision } : prev);
  }

  const filtered = statusFilter === "all" ? rows : rows.filter((r) => r.status === statusFilter);
  const stats = {
    total: rows.length,
    evaluated: rows.filter((r) => r.status === "evaluated").length,
    selected: rows.filter((r) => r.decision === "selected").length,
    rejected: rows.filter((r) => r.decision === "rejected").length,
  };

  const tabs: { key: Tab; label: string }[] = [
    { key: "assign",      label: "Assign Task" },
    { key: "submissions", label: "Global Submissions" },
    { key: "tasks",       label: "Global Tasks" },
  ];

  return (
    <DashboardLayout>
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Task Evaluations</h1>
          <p className="text-sm text-gray-500 mt-1">Assign tasks to candidates, review submissions, and make hiring decisions.</p>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === tab.key ? "bg-white shadow-sm text-indigo-700" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === "assign" && <AssignTaskTab />}

        {activeTab === "tasks" && <ManageTasksTab />}

        {activeTab === "submissions" && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: "Total", value: stats.total,     color: "text-indigo-600" },
                { label: "Evaluated", value: stats.evaluated, color: "text-emerald-600" },
                { label: "Selected", value: stats.selected,  color: "text-green-600" },
                { label: "Rejected", value: stats.rejected,  color: "text-red-500" },
              ].map((s) => (
                <div key={s.label} className="bg-white rounded-2xl border border-gray-200 shadow-sm px-5 py-4">
                  <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {(["all", "submitted", "evaluating", "evaluated"] as const).map((f) => (
                <button key={f} onClick={() => setStatusFilter(f)}
                  className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors border ${statusFilter === f ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-gray-600 border-gray-200 hover:border-indigo-300"}`}>
                  {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
                  {f !== "all" && <span className="ml-1.5 text-xs opacity-70">({rows.filter((r) => r.status === f).length})</span>}
                </button>
              ))}
              <button onClick={loadSubmissions} className="ml-auto p-1.5 rounded-lg text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
              </button>
            </div>

            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
              {loading ? (
                <div className="flex items-center justify-center py-20"><div className="w-7 h-7 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" /></div>
              ) : filtered.length === 0 ? (
                <div className="px-6 py-16 text-center">
                  <p className="text-gray-600 font-semibold">No submissions yet</p>
                  <p className="text-sm text-gray-400 mt-1">Global task submissions appear here.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 bg-gray-50">
                        {["Candidate", "Task", "Score", "Status", "Decision", "Submitted"].map((h) => (
                          <th key={h} className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {filtered.map((row) => {
                        const score = (row.evaluation_result as EvalResult)?.overall_score;
                        return (
                          <tr key={row.id} onClick={() => setSelectedSub(row)} className="hover:bg-indigo-50/40 cursor-pointer transition-colors">
                            <td className="px-5 py-4">
                              <p className="font-medium text-gray-900">{row.candidate_name || "—"}</p>
                              <p className="text-xs text-gray-400 mt-0.5 truncate max-w-[180px]">{row.candidate_id}</p>
                            </td>
                            <td className="px-5 py-4">
                              <p className="font-medium text-gray-800 max-w-[200px] truncate">{row.task_title}</p>
                              <a href={row.repo_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-xs text-indigo-500 hover:underline font-mono truncate max-w-[200px] block mt-0.5">
                                {row.repo_url.replace("https://github.com/", "")}
                              </a>
                            </td>
                            <td className="px-4 py-4">
                              {score !== undefined ? <span className={`font-bold text-base ${score >= 70 ? "text-emerald-600" : score >= 50 ? "text-amber-600" : "text-red-500"}`}>{Math.round(score)}</span> : <span className="text-gray-400">—</span>}
                            </td>
                            <td className="px-4 py-4"><StatusBadge status={row.status} /></td>
                            <td className="px-4 py-4"><DecisionBadge decision={row.decision} /></td>
                            <td className="px-4 py-4 text-xs text-gray-500 whitespace-nowrap">
                              {new Date(row.submitted_at).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {selectedSub && (
        <EvalPanel sub={selectedSub} onClose={() => setSelectedSub(null)} onDecision={(id, d) => handleDecision(id, d)} />
      )}
    </DashboardLayout>
  );
}
