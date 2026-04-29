"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Application {
  id: string;
  job_title: string;
  org_name: string;
  department: string | null;
  location: string;
  employment_type: string;
  status: string;
  display_status: string;
  ats_passed: boolean | null;
  suggestions: string[] | null;
  interview_url: string | null;
  interview_token: string | null;
  interview_status: string | null;
  interview_result: string | null;
  expires_at: string | null;
  applied_at: string;
  task_enabled: boolean | null;
}

interface Stats {
  total: number;
  ats_passed: number;
  interviews_scheduled: number;
  completed: number;
  selected: number;
}

interface AssignedTaskData {
  task: {
    id: string;
    title: string;
    description: string;
    deadline: string;
    applicationId: string | null;
    status: string;
  } | null;
  submission: {
    id: string;
    repo_url: string;
    submitted_at: string;
    status: "submitted" | "evaluating" | "evaluated";
    decision: string;
    evaluation_result: Record<string, unknown> | null;
  } | null;
}

interface TaskData {
  task: {
    id: string;
    title: string;
    description: string;
    deadline: string;
    createdAt: string;
  } | null;
  submission: {
    id: string;
    repo_url: string;
    submitted_at: string;
    status: "submitted" | "evaluating" | "evaluated";
    evaluation_id: string | null;
    decision: string;
    evaluation_result: Record<string, unknown> | null;
  } | null;
}

const STATUS_CONFIG: Record<string, { label: string; dot: string; bg: string; color: string }> = {
  applied:        { label: "Under Review",         dot: "bg-blue-400",    bg: "bg-blue-50 text-blue-700",    color: "text-blue-500" },
  ats_failed:     { label: "ATS Not Passed",        dot: "bg-red-400",     bg: "bg-red-50 text-red-700",      color: "text-red-500" },
  error:          { label: "Error",                 dot: "bg-gray-400",    bg: "bg-gray-100 text-gray-600",   color: "text-gray-400" },
  interview_ready:{ label: "Interview Scheduled",   dot: "bg-purple-500",  bg: "bg-purple-50 text-purple-700",color: "text-purple-500" },
  under_review:   { label: "Under Review",          dot: "bg-amber-500",   bg: "bg-amber-50 text-amber-700",  color: "text-amber-500" },
  hired:          { label: "Hired",                 dot: "bg-emerald-500", bg: "bg-emerald-50 text-emerald-700 font-semibold", color: "text-emerald-500" },
  not_hired:      { label: "Not Selected",          dot: "bg-gray-400",    bg: "bg-gray-100 text-gray-500",   color: "text-gray-400" },
};

export default function ApplicationsPage() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [taskData, setTaskData] = useState<TaskData>({ task: null, submission: null });
  const [assignedTask, setAssignedTask] = useState<AssignedTaskData>({ task: null, submission: null });
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    Promise.all([fetchApplications(), fetchTaskData(), fetchAssignedTask()]).finally(() => setLoading(false));
    // Poll assigned task every 30s to detect new assignments
    const t = setInterval(fetchAssignedTask, 30000);
    return () => clearInterval(t);
  }, []);

  async function fetchApplications() {
    const res = await fetch("/api/candidate/applications");
    if (res.ok) {
      const d = await res.json();
      setApplications(d.applications || []);
      setStats(d.stats);
    }
  }

  async function fetchTaskData() {
    const res = await fetch("/api/tasks").catch(() => null);
    if (res?.ok) {
      const d = await res.json();
      setTaskData(d);
    }
  }

  async function fetchAssignedTask() {
    const res = await fetch("/api/candidate/tasks").catch(() => null);
    if (res?.ok) {
      const d = await res.json();
      setAssignedTask(d);
    }
  }

  const filters = [
    { key: "all",            label: "All" },
    { key: "interview_ready",label: "Interview Ready" },
    { key: "under_review",   label: "Under Review" },
    { key: "ats_failed",     label: "ATS Not Passed" },
    { key: "hired",          label: "Hired" },
  ];

  const filtered = filter === "all"
    ? applications
    : applications.filter((a) => a.display_status === filter);

  const isExpired = (e: string | null) => e ? new Date(e) < new Date() : false;

  return (
    <div className="p-6 lg:p-8 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">My Applications</h1>
        <p className="text-gray-500 text-sm mt-1">Track your job applications and interview status</p>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {[
            { label: "Total",          value: stats.total,                color: "text-gray-900" },
            { label: "ATS Passed",     value: stats.ats_passed,           color: "text-teal-700" },
            { label: "Interviews",     value: stats.interviews_scheduled, color: "text-purple-700" },
            { label: "Hired",          value: stats.selected,             color: "text-emerald-700" },
          ].map((s) => (
            <div key={s.label} className="bg-white rounded-xl p-3 border border-gray-100 text-center shadow-sm">
              <div className={`text-xl font-bold ${s.color}`}>{s.value}</div>
              <div className="text-xs text-gray-500 mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-2 flex-wrap mb-6">
        {filters.map((f) => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition-colors ${
              filter === f.key ? "bg-teal-600 text-white" : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
            }`}>
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="w-7 h-7 border-2 border-teal-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-gray-100">
          <p className="text-gray-500 text-sm">
            {filter === "all" ? "No applications yet." : "No applications in this category."}
          </p>
          {filter === "all" && (
            <a href="/candidate/jobs" className="mt-3 inline-block px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-xl hover:bg-teal-700 transition-colors">
              Browse Jobs
            </a>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map((app) => {
            const sc = STATUS_CONFIG[app.display_status] || STATUS_CONFIG["applied"];
            const expired = isExpired(app.expires_at);
            const canInterview = app.interview_url && !expired && app.interview_status !== "completed";
            const interviewDone = app.interview_status === "completed";

            return (
              <div key={app.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                {/* Header */}
                <div className="p-5 flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <div className={`w-3 h-3 rounded-full ${sc.dot}`} />
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold text-gray-900">{app.job_title}</h3>
                      <p className="text-xs text-teal-700 font-medium">{app.org_name}</p>
                      <div className="flex flex-wrap gap-2 mt-1 text-xs text-gray-400">
                        {app.department && <span>{app.department}</span>}
                        <span>{app.location}</span>
                        <span>Applied {new Date(app.applied_at).toLocaleDateString()}</span>
                      </div>
                    </div>
                  </div>
                  <span className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium ${sc.bg}`}>
                    {sc.label}
                  </span>
                </div>

                {/* Status timeline */}
                <div className="mx-5 mb-4">
                  <StatusTimeline app={app} taskData={taskData} assignedTask={assignedTask} taskEnabled={!!app.task_enabled} />
                </div>

                {/* Task banner */}
                {app.task_enabled && (
                  <TaskBanner taskData={taskData} assignedTask={assignedTask} applicationId={app.id} />
                )}

                {/* Interview link / completed box */}
                {app.interview_url && (
                  <div className={`mx-5 mb-4 p-3.5 rounded-xl border ${expired ? "bg-gray-50 border-gray-200" : "bg-teal-50 border-teal-200"}`}>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold text-gray-700">
                          {app.interview_status === "completed" ? "Interview Completed" : "Interview Link"}
                        </p>
                        {app.expires_at && app.interview_status !== "completed" && (
                          <p className={`text-xs mt-0.5 ${expired ? "text-red-600" : "text-teal-600"}`}>
                            {expired ? "Expired" : `Expires ${new Date(app.expires_at).toLocaleString()}`}
                          </p>
                        )}
                      </div>
                      {canInterview && (
                        <a href={app.interview_url} target="_blank" rel="noopener noreferrer"
                          className="px-4 py-2 text-xs font-semibold rounded-lg bg-teal-600 hover:bg-teal-700 text-white transition-colors">
                          Start Interview →
                        </a>
                      )}
                    </div>
                  </div>
                )}


                {/* Improvement suggestions (ATS failed only) */}
                {app.display_status === "ats_failed" && app.suggestions && app.suggestions.length > 0 && (
                  <div className="mx-5 mb-5 p-4 bg-amber-50 rounded-xl border border-amber-100">
                    <p className="text-xs font-semibold text-amber-800 mb-2">How to improve your application</p>
                    <ul className="space-y-1.5">
                      {app.suggestions.slice(0, 4).map((s, i) => (
                        <li key={i} className="flex items-start gap-2 text-xs text-amber-900">
                          <span className="flex-shrink-0 mt-0.5">•</span>
                          {s}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Task Banner ───────────────────────────────────────────────────────────────

function TaskBanner({
  taskData,
  assignedTask,
  applicationId,
}: {
  taskData: TaskData;
  assignedTask: AssignedTaskData;
  applicationId: string;
}) {
  // Prefer per-candidate assigned task if it matches this application or has no application filter
  const useAssigned =
    assignedTask.task &&
    (!assignedTask.task.applicationId || assignedTask.task.applicationId === applicationId);

  const { task, submission } = useAssigned
    ? { task: assignedTask.task, submission: assignedTask.submission }
    : taskData;

  if (submission) {
    if (submission.status === "submitted") {
      return (
        <div className="mx-5 mb-4 p-3.5 rounded-xl border bg-blue-50 border-blue-200">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-blue-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-xs font-semibold text-blue-700">Task submitted. Evaluation in progress.</p>
            </div>
            <Link href="/candidate/tasks"
              className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-blue-500 hover:bg-blue-600 text-white transition-colors whitespace-nowrap">
              Go to Task →
            </Link>
          </div>
        </div>
      );
    }

    if (submission.status === "evaluating") {
      return (
        <div className="mx-5 mb-4 p-3.5 rounded-xl border bg-teal-50 border-teal-100">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 animate-spin text-teal-500 shrink-0" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-75" />
              </svg>
              <p className="text-xs font-semibold text-teal-700">Evaluation in progress...</p>
            </div>
            <Link href="/candidate/tasks"
              className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-teal-600 hover:bg-teal-700 text-white transition-colors whitespace-nowrap">
              Go to Task →
            </Link>
          </div>
        </div>
      );
    }

    if (submission.status === "evaluated") {
      return (
        <div className="mx-5 mb-4 p-3.5 rounded-xl border bg-emerald-50 border-emerald-200">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-emerald-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              <p className="text-xs font-semibold text-emerald-700">Task evaluation completed.</p>
            </div>
            <Link href="/candidate/tasks"
              className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition-colors whitespace-nowrap">
              View Result →
            </Link>
          </div>
        </div>
      );
    }
  }

  if (task) {
    const deadlinePassed = new Date() > new Date(task.deadline);
    const hoursLeft = Math.max(0, Math.floor((new Date(task.deadline).getTime() - Date.now()) / 3600000));

    if (deadlinePassed) {
      return (
        <div className="mx-5 mb-4 p-3.5 rounded-xl border bg-red-50 border-red-200">
          <p className="text-xs font-semibold text-red-700">Submission deadline passed.</p>
          <p className="text-xs text-red-500 mt-0.5">Contact your recruiter if you believe this is an error.</p>
        </div>
      );
    }

    return (
      <div className="mx-5 mb-4 p-3.5 rounded-xl border bg-amber-50 border-amber-200">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-amber-800">Task assigned</p>
            <p className="text-xs text-amber-700 mt-0.5">
              Complete it within {hoursLeft} hour{hoursLeft !== 1 ? "s" : ""}.
            </p>
          </div>
          <Link href="/candidate/tasks"
            className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-amber-500 hover:bg-amber-600 text-white transition-colors whitespace-nowrap">
            Go to Task →
          </Link>
        </div>
      </div>
    );
  }

  return null;
}

// ─── Status Timeline ───────────────────────────────────────────────────────────

function getTaskStep(interviewDone: boolean, taskData: TaskData, assignedTask: AssignedTaskData) {
  if (!interviewDone) {
    return { label: "Task Eval", done: false, active: false, failed: false, evaluating: false };
  }

  // Prefer assigned task data if available
  const { task, submission } = assignedTask.task
    ? { task: assignedTask.task, submission: assignedTask.submission }
    : taskData;

  if (submission) {
    if (submission.status === "evaluated") {
      return { label: "Evaluated", done: true, active: false, failed: false, evaluating: false };
    }
    if (submission.status === "evaluating") {
      return { label: "Evaluating", done: false, active: true, failed: false, evaluating: true };
    }
    if (submission.status === "submitted") {
      return { label: "Submitted", done: false, active: true, failed: false, evaluating: false };
    }
  }

  if (task) {
    const deadlinePassed = new Date() > new Date(task.deadline);
    if (deadlinePassed) {
      return { label: "Expired", done: false, active: false, failed: true, evaluating: false };
    }
    return { label: "Assigned", done: false, active: true, failed: false, evaluating: false };
  }

  return { label: "Task Eval", done: false, active: false, failed: false, evaluating: false };
}

function StatusTimeline({ app, taskData, assignedTask, taskEnabled }: { app: Application; taskData: TaskData; assignedTask: AssignedTaskData; taskEnabled: boolean }) {
  const interviewDone = app.interview_status === "completed";
  const taskStep = getTaskStep(interviewDone, taskData, assignedTask);

  const baseSteps = [
    {
      key: "applied",
      label: "Applied",
      done: true,
      active: false,
      failed: false,
      evaluating: false,
    },
    {
      key: "ats",
      label: app.ats_passed === false ? "ATS Not Passed" : "ATS Passed",
      done: app.ats_passed !== null,
      active: false,
      failed: app.ats_passed === false,
      evaluating: false,
    },
    {
      key: "interview",
      label: interviewDone ? "Interview Done" : "Interview",
      done: interviewDone || app.display_status === "interview_ready",
      active: app.display_status === "interview_ready",
      failed: false,
      evaluating: false,
    },
    {
      key: "decision",
      label: app.display_status === "hired" ? "Hired" : app.display_status === "not_hired" ? "Not Selected" : "Decision",
      done: app.display_status === "hired" || app.display_status === "not_hired",
      active: false,
      failed: app.display_status === "not_hired",
      evaluating: false,
    },
  ];

  const taskEvalStep = {
    key: "task_eval",
    label: taskStep.label,
    done: taskStep.done,
    active: taskStep.active,
    failed: taskStep.failed,
    evaluating: taskStep.evaluating,
  };

  // Insert Task Eval step before Decision only if job has task evaluation enabled
  const steps = taskEnabled
    ? [...baseSteps.slice(0, 3), taskEvalStep, baseSteps[3]]
    : baseSteps;

  return (
    <div className="flex items-center gap-0">
      {steps.map((step, i) => (
        <div key={step.key} className="flex items-center flex-1 last:flex-none">
          <div className="flex flex-col items-center">
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
              step.failed    ? "bg-red-100 text-red-600 ring-2 ring-red-200"
              : step.done    ? "bg-teal-500 text-white"
              : step.active  ? "bg-amber-100 text-amber-600 ring-2 ring-amber-200"
              : "bg-gray-100 text-gray-400"
            }`}>
              {step.evaluating ? (
                <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-30" />
                  <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
                </svg>
              ) : step.failed ? "✕"
                : step.done   ? "✓"
                : i + 1}
            </div>
            <span className={`text-[10px] mt-1 font-medium whitespace-nowrap ${
              step.failed   ? "text-red-600"
              : step.done   ? "text-teal-700"
              : step.active ? "text-amber-600"
              : "text-gray-400"
            }`}>{step.label}</span>
          </div>
          {i < steps.length - 1 && (
            <div className={`flex-1 h-0.5 mb-4 mx-1 ${step.done && !step.failed ? "bg-teal-300" : "bg-gray-100"}`} />
          )}
        </div>
      ))}
    </div>
  );
}
