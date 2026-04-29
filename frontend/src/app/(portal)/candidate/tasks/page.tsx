"use client";

import { useState, useEffect, useCallback } from "react";

interface Submission {
  id: string;
  repo_url: string | null;
  submitted_at: string | null;
  status: "submitted" | "evaluating" | "evaluated";
  evaluation_id: string | null;
  decision: "pending" | "selected" | "rejected";
  evaluation_result: Record<string, unknown> | null;
}

interface Task {
  id: string;
  title: string;
  description: string;
  deadline: string;
  durationHours: number | null;
  applicationId: string | null;
  status: string;
  createdAt: string;
  jobTitle: string | null;
  jobRole: string | null;
  jobLevel: string | null;
  submission: Submission | null;
}

function Countdown({ deadline }: { deadline: string }) {
  const [text, setText] = useState("");
  useEffect(() => {
    const tick = () => {
      const diff = new Date(deadline).getTime() - Date.now();
      if (diff <= 0) { setText("Deadline passed"); return; }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setText(`${h}h ${m}m ${s}s`);
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [deadline]);
  const diff = new Date(deadline).getTime() - Date.now();
  const color = diff <= 0 ? "text-red-500" : diff < 3 * 3600000 ? "text-orange-500" : "text-amber-600";
  return <span className={`font-mono text-xs font-bold ${color}`}>{text}</span>;
}

function StatusBadge({ task }: { task: Task }) {
  const sub = task.submission;
  if (sub?.status === "evaluated") {
    const d = sub.decision;
    if (d === "selected") return <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700 border border-green-200">Selected</span>;
    if (d === "rejected") return <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700 border border-red-200">Not Selected</span>;
    return <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-teal-100 text-teal-700 border border-teal-200">Evaluated</span>;
  }
  if (sub?.status === "evaluating") return <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-700 border border-blue-200">Evaluating…</span>;
  if (sub?.status === "submitted") return <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-100 text-purple-700 border border-purple-200">Submitted</span>;
  const deadlinePassed = new Date() > new Date(task.deadline);
  if (deadlinePassed) return <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-600 border border-red-200">Expired</span>;
  return <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700 border border-amber-200">Pending</span>;
}

function TaskCard({ task, onUpdate }: { task: Task; onUpdate: (updated: Task) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [repoUrl, setRepoUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const sub = task.submission;
  const deadlinePassed = new Date() > new Date(task.deadline);
  const evalResult = sub?.evaluation_result as Record<string, unknown> | null;

  async function pollSubmission(subId: string) {
    const res = await fetch(`/api/candidate/tasks/submission/${subId}`).catch(() => null);
    if (!res?.ok) return;
    const data = await res.json();
    onUpdate({ ...task, submission: data });
    return data;
  }

  useEffect(() => {
    if (!sub?.id || sub.status === "evaluated") return;
    if (sub.status !== "evaluating") return;
    const t = setInterval(async () => {
      const data = await pollSubmission(sub.id);
      if (data?.status === "evaluated") clearInterval(t);
    }, 6000);
    return () => clearInterval(t);
  }, [sub?.id, sub?.status]);

  async function handleSubmit() {
    if (!repoUrl.trim()) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/candidate/tasks/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: task.id, repoUrl: repoUrl.trim() }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error || "Submission failed"); return; }
      await pollSubmission(json.submissionId);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Card summary row */}
      <div className="px-5 py-4 flex items-center gap-4">
        <div className="w-10 h-10 rounded-xl bg-teal-50 flex items-center justify-center shrink-0">
          <svg className="w-5 h-5 text-teal-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            {task.jobRole && (
              <span className="text-xs font-semibold text-teal-600 bg-teal-50 px-2 py-0.5 rounded-full border border-teal-100">
                {task.jobRole}
              </span>
            )}
            {task.jobLevel && (
              <span className="text-xs text-gray-400 bg-gray-50 px-2 py-0.5 rounded-full border border-gray-100">
                {task.jobLevel}
              </span>
            )}
          </div>
          <h3 className="text-sm font-bold text-gray-900 truncate">{task.title}</h3>
          {task.jobTitle && (
            <p className="text-xs text-gray-400 mt-0.5">{task.jobTitle}</p>
          )}
        </div>

        <div className="shrink-0 flex flex-col items-end gap-2">
          <StatusBadge task={task} />
          <div className="flex items-center gap-1 text-xs text-gray-400">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <circle cx="12" cy="12" r="10" /><path strokeLinecap="round" d="M12 6v6l4 2" />
            </svg>
            <Countdown deadline={task.deadline} />
          </div>
        </div>

        <button
          onClick={() => setExpanded(v => !v)}
          className="shrink-0 ml-2 p-2 rounded-lg text-gray-400 hover:text-teal-600 hover:bg-teal-50 transition-colors"
          aria-label={expanded ? "Collapse" : "Expand"}
        >
          <svg className={`w-4 h-4 transition-transform ${expanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-gray-100">
          {/* Description */}
          <div className="px-5 py-5">
            <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Task Description</h4>
            <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{task.description}</p>
            {task.durationHours && (
              <p className="text-xs text-gray-400 mt-3">Estimated time: <span className="font-semibold text-gray-500">{task.durationHours}h</span></p>
            )}
          </div>

          <div className="border-t border-gray-100 mx-5" />

          {/* Submission section */}
          <div className="px-5 py-5 space-y-4">
            <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Your Submission</h4>

            {sub ? (
              <div className="space-y-3">
                <div className="flex items-start gap-3 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
                  <div className="w-7 h-7 rounded-lg bg-green-100 flex items-center justify-center shrink-0 mt-0.5">
                    <svg className="w-3.5 h-3.5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-green-800">Repository submitted</p>
                    {sub.repo_url && (
                      <a href={sub.repo_url} target="_blank" rel="noopener noreferrer"
                        className="text-xs text-green-700 hover:underline font-mono break-all mt-0.5 block">
                        {sub.repo_url}
                      </a>
                    )}
                    {sub.submitted_at && (
                      <p className="text-xs text-green-600 mt-1">
                        {new Date(sub.submitted_at).toLocaleString()}
                      </p>
                    )}
                  </div>
                </div>

                {(sub.status === "submitted" || sub.status === "evaluating") && (
                  <div className="flex items-center gap-3 bg-teal-50 border border-teal-100 rounded-xl px-4 py-3">
                    <svg className="w-5 h-5 animate-spin text-teal-500 shrink-0" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                      <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-75" />
                    </svg>
                    <div>
                      <p className="text-sm font-medium text-teal-700">Evaluating your repository…</p>
                      <p className="text-xs text-teal-500 mt-0.5">This takes 1–3 minutes. You can safely close this tab.</p>
                    </div>
                  </div>
                )}

                {sub.status === "evaluated" && evalResult && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-4 bg-teal-50 border border-teal-100 rounded-xl px-5 py-4">
                      <div className="text-center shrink-0">
                        <p className="text-3xl font-bold text-teal-700">{Math.round((evalResult.overall_score as number) ?? 0)}</p>
                        <p className="text-xs text-teal-400">/100</p>
                      </div>
                      <div className="w-px h-10 bg-teal-200" />
                      <div>
                        <p className="text-sm font-semibold text-teal-800">Evaluation complete</p>
                        {evalResult.overall_grade && (
                          <p className="text-xs text-teal-600 mt-0.5">Grade: <span className="font-bold">{String(evalResult.overall_grade)}</span></p>
                        )}
                        <p className="text-xs text-teal-400 mt-0.5">Full report available to the hiring team.</p>
                      </div>
                    </div>

                    {sub.decision !== "pending" && (
                      <div className={`flex items-center gap-2 rounded-xl px-4 py-3 ${
                        sub.decision === "selected"
                          ? "bg-green-50 border border-green-200"
                          : "bg-red-50 border border-red-200"
                      }`}>
                        <svg className={`w-5 h-5 ${sub.decision === "selected" ? "text-green-500" : "text-red-400"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          {sub.decision === "selected"
                            ? <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            : <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />}
                        </svg>
                        <p className={`text-sm font-semibold ${sub.decision === "selected" ? "text-green-800" : "text-red-700"}`}>
                          {sub.decision === "selected"
                            ? "Congratulations! You have been selected."
                            : "Thank you for your submission. We won't be moving forward at this time."}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : deadlinePassed ? (
              <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4 text-center">
                <p className="text-sm font-semibold text-red-700">Submission window closed</p>
                <p className="text-xs text-red-500 mt-1">The deadline has passed. Contact your recruiter if you believe this is an error.</p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 space-y-1">
                  <p className="text-xs font-semibold text-amber-700">Before submitting:</p>
                  <ul className="text-xs text-amber-700 list-disc list-inside space-y-0.5">
                    <li>Your repository must be <strong>public</strong></li>
                    <li>Include a <strong>README</strong> with setup instructions</li>
                    <li>Submit from your <strong>personal GitHub account</strong></li>
                    <li>Only <strong>one submission</strong> is allowed per task</li>
                  </ul>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">
                    GitHub Repository URL <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="url"
                    value={repoUrl}
                    onChange={(e) => setRepoUrl(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                    placeholder="https://github.com/your-username/your-repo"
                    className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-transparent"
                  />
                </div>

                {error && (
                  <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                    <p className="text-xs text-red-600 font-medium">{error}</p>
                  </div>
                )}

                <button
                  onClick={handleSubmit}
                  disabled={submitting || !repoUrl.trim()}
                  className="w-full bg-teal-600 hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl text-sm transition-colors flex items-center justify-center gap-2"
                >
                  {submitting ? (
                    <>
                      <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                        <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-75" />
                      </svg>
                      Submitting…
                    </>
                  ) : "Submit Repository"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function CandidateTasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const res = await fetch("/api/candidate/tasks").catch(() => null);
    if (res?.ok) {
      const d = await res.json();
      if (Array.isArray(d.tasks)) {
        setTasks(d.tasks);
      }
    }
  }, []);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  // Poll every 30s if there are no tasks yet
  useEffect(() => {
    if (tasks.length > 0) return;
    if (loading) return;
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [tasks.length, loading, load]);

  function updateTask(updated: Task) {
    setTasks(prev => prev.map(t => t.id === updated.id ? updated : t));
  }

  const pending = tasks.filter(t => !t.submission && new Date() <= new Date(t.deadline));
  const active = tasks.filter(t => t.submission && t.submission.status !== "evaluated");
  const completed = tasks.filter(t => t.submission?.status === "evaluated");

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Tasks</h1>
        <p className="text-sm text-gray-500 mt-1">Your task assignments as part of the hiring process.</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-7 h-7 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : tasks.length === 0 ? (
        <div className="bg-white rounded-2xl border border-dashed border-gray-200 p-14 text-center">
          <div className="w-14 h-14 mx-auto rounded-full bg-teal-50 flex items-center justify-center mb-4">
            <svg className="w-7 h-7 text-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          </div>
          <p className="text-gray-700 font-semibold">No tasks assigned yet</p>
          <p className="text-sm text-gray-400 mt-1">Tasks are assigned after your interview is completed. Check back shortly.</p>
          <p className="text-xs text-gray-300 mt-3">This page refreshes automatically every 30 seconds.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {pending.length > 0 && (
            <section>
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                Pending — {pending.length} task{pending.length > 1 ? "s" : ""}
              </h2>
              <div className="space-y-3">
                {pending.map(t => <TaskCard key={t.id} task={t} onUpdate={updateTask} />)}
              </div>
            </section>
          )}

          {active.length > 0 && (
            <section>
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                In Progress — {active.length} task{active.length > 1 ? "s" : ""}
              </h2>
              <div className="space-y-3">
                {active.map(t => <TaskCard key={t.id} task={t} onUpdate={updateTask} />)}
              </div>
            </section>
          )}

          {completed.length > 0 && (
            <section>
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                Completed — {completed.length} task{completed.length > 1 ? "s" : ""}
              </h2>
              <div className="space-y-3">
                {completed.map(t => <TaskCard key={t.id} task={t} onUpdate={updateTask} />)}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
