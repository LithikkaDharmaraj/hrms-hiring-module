"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";

interface TaskData {
  hasTask: boolean;
  candidateName: string | null;
  taskTitle: string | null;
  taskDescription: string | null;
  deadlineAt: string | null;
  submittedAt: string | null;
  repoUrl: string | null;
  evalStatus: string | null;
  evalScore: number | null;
  evalGrade: string | null;
}

function Countdown({ deadlineAt }: { deadlineAt: string }) {
  const [remaining, setRemaining] = useState("");
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    const tick = () => {
      const diff = new Date(deadlineAt).getTime() - Date.now();
      if (diff <= 0) {
        setRemaining("Deadline has passed");
        setExpired(true);
        return;
      }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setRemaining(`${h}h ${m}m ${s}s`);
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [deadlineAt]);

  return (
    <div className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold ${
      expired ? "bg-red-50 text-red-600 border border-red-200" :
      new Date(deadlineAt).getTime() - Date.now() < 3 * 3600000
        ? "bg-red-50 text-red-600 border border-red-200"
        : "bg-amber-50 text-amber-700 border border-amber-200"
    }`}>
      <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <circle cx="12" cy="12" r="10" />
        <path strokeLinecap="round" d="M12 6v6l4 2" />
      </svg>
      {expired ? "Deadline passed" : `${remaining} remaining`}
    </div>
  );
}

export default function TaskPage() {
  const { interviewId } = useParams<{ interviewId: string }>();
  const token = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("token") ?? ""
    : "";

  const [task, setTask] = useState<TaskData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [repoInput, setRepoInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    const params = token ? `?token=${token}` : "";
    fetch(`/api/task-submit/${interviewId}${params}`)
      .then((r) => {
        if (r.status === 401 || r.status === 404) { setNotFound(true); return null; }
        return r.json();
      })
      .then((data) => {
        if (data) {
          setTask(data);
          if (data.submittedAt) setSubmitted(true);
        }
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [interviewId, token]);

  // Poll eval status while running
  useEffect(() => {
    if (!task?.evalStatus || task.evalStatus === "completed" || task.evalStatus === "failed") return;
    const interval = setInterval(async () => {
      const params = token ? `?token=${token}` : "";
      const res = await fetch(`/api/task-submit/${interviewId}${params}`).catch(() => null);
      if (!res?.ok) return;
      const data = await res.json();
      setTask(data);
      if (data.evalStatus === "completed" || data.evalStatus === "failed") clearInterval(interval);
    }, 6000);
    return () => clearInterval(interval);
  }, [interviewId, token, task?.evalStatus]);

  const handleSubmit = async () => {
    if (!repoInput.trim()) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      const res = await fetch(`/api/task-submit/${interviewId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl: repoInput.trim(), token }),
      });
      const json = await res.json();
      if (!res.ok) { setSubmitError(json.error || "Submission failed"); return; }
      setSubmitted(true);
      setTask((prev) => prev ? {
        ...prev,
        repoUrl: repoInput.trim(),
        submittedAt: new Date().toISOString(),
        evalStatus: "pending",
      } : prev);
    } catch (err) {
      setSubmitError(String(err));
    } finally {
      setSubmitting(false);
    }
  };

  // ── Loading ──
  if (loading) {
    return (
      <div className="min-h-screen bg-[#F9FAFB] flex items-center justify-center">
        <div className="w-7 h-7 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // ── Auth / not found ──
  if (notFound || !task) {
    return (
      <div className="min-h-screen bg-[#F9FAFB] flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl border border-gray-200 shadow-lg p-10 text-center max-w-sm">
          <div className="w-14 h-14 mx-auto rounded-full bg-red-50 flex items-center justify-center mb-4">
            <svg className="w-7 h-7 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M4.93 4.93l14.14 14.14" />
            </svg>
          </div>
          <h2 className="text-lg font-bold text-gray-900 mb-1">Link not valid</h2>
          <p className="text-sm text-gray-500">This task link is invalid or has expired. Please use the link from your interview email.</p>
        </div>
      </div>
    );
  }

  // ── No task assigned ──
  if (!task.hasTask) {
    return (
      <div className="min-h-screen bg-[#F9FAFB] flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl border border-gray-200 shadow-lg p-10 text-center max-w-sm space-y-4">
          <div className="w-14 h-14 mx-auto rounded-full bg-indigo-50 flex items-center justify-center">
            <svg className="w-7 h-7 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          </div>
          <h2 className="text-lg font-bold text-gray-900">Task not assigned yet</h2>
          <p className="text-sm text-gray-500 leading-relaxed">
            Your take-home task will be assigned automatically once your interview is complete. Check back after finishing the interview.
          </p>
        </div>
      </div>
    );
  }

  const deadlinePassed = task.deadlineAt ? new Date() > new Date(task.deadlineAt) : false;

  return (
    <div className="min-h-screen bg-[#F9FAFB] py-10 px-4">
      <div className="max-w-2xl mx-auto space-y-5">

        {/* Branding */}
        <div className="flex items-center gap-2.5 mb-2">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25z" />
            </svg>
          </div>
          <span className="text-base font-semibold text-gray-900">InterviewAI</span>
        </div>

        {/* Header banner */}
        <div className="bg-indigo-600 rounded-2xl px-6 py-5 text-white">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center shrink-0 mt-0.5">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <div className="flex-1">
              <p className="text-xs font-semibold text-indigo-200 uppercase tracking-wider mb-0.5">Take-Home Assignment</p>
              <h1 className="text-xl font-bold leading-snug">{task.taskTitle}</h1>
              {task.candidateName && (
                <p className="text-sm text-indigo-100 mt-1">Hi {task.candidateName.split(" ")[0]}, this task was assigned after your interview was completed.</p>
              )}
              {!task.candidateName && (
                <p className="text-sm text-indigo-200 mt-1">This task was assigned after your interview was completed.</p>
              )}
            </div>
          </div>
        </div>

        {/* Deadline strip */}
        {task.deadlineAt && (
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="text-xs text-gray-500">
              Deadline: <span className="font-medium text-gray-700">{new Date(task.deadlineAt).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
            </div>
            {!submitted && !deadlinePassed && <Countdown deadlineAt={task.deadlineAt} />}
            {deadlinePassed && !submitted && (
              <span className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-red-50 text-red-600 border border-red-200">Deadline passed</span>
            )}
            {submitted && (
              <span className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-green-50 text-green-700 border border-green-200">Submitted</span>
            )}
          </div>
        )}

        {/* Task description */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Task Description</h2>
          <div className="prose prose-sm max-w-none text-gray-700 leading-relaxed whitespace-pre-wrap">
            {task.taskDescription}
          </div>
        </div>

        {/* Submission area */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-4">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">Your Submission</h2>

          {/* Already submitted */}
          {submitted ? (
            <div className="space-y-4">
              <div className="flex items-start gap-3 bg-green-50 border border-green-200 rounded-xl px-4 py-4">
                <div className="w-8 h-8 rounded-lg bg-green-100 flex items-center justify-center shrink-0">
                  <svg className="w-4 h-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-green-800">Repository submitted successfully</p>
                  <a href={task.repoUrl ?? "#"} target="_blank" rel="noopener noreferrer"
                    className="text-xs text-green-700 hover:underline font-mono break-all mt-0.5 block">
                    {task.repoUrl}
                  </a>
                  {task.submittedAt && (
                    <p className="text-xs text-green-600 mt-1">
                      Submitted {new Date(task.submittedAt).toLocaleString()}
                    </p>
                  )}
                </div>
              </div>

              {/* Eval status */}
              {task.evalStatus === "pending" || task.evalStatus === "running" || task.evalStatus === "cloning" ? (
                <div className="flex items-center gap-3 px-4 py-3 bg-indigo-50 border border-indigo-100 rounded-xl">
                  <svg className="w-5 h-5 animate-spin text-indigo-500 shrink-0" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                    <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-75" />
                  </svg>
                  <div>
                    <p className="text-sm font-medium text-indigo-700">Evaluating your repository…</p>
                    <p className="text-xs text-indigo-500 mt-0.5 capitalize">Status: {task.evalStatus}</p>
                  </div>
                </div>
              ) : task.evalStatus === "completed" ? (
                <div className="flex items-center gap-4 px-4 py-4 bg-gray-50 border border-gray-200 rounded-xl">
                  <div className="text-center shrink-0">
                    <p className="text-3xl font-bold text-gray-900">{Math.round(task.evalScore ?? 0)}</p>
                    <p className="text-xs text-gray-400">/100</p>
                  </div>
                  <div className="w-px h-10 bg-gray-200" />
                  <div>
                    <p className="text-sm font-semibold text-gray-800">Evaluation complete</p>
                    {task.evalGrade && (
                      <p className="text-xs text-gray-500 mt-0.5">Grade: <span className="font-semibold text-gray-700">{task.evalGrade}</span></p>
                    )}
                    <p className="text-xs text-gray-400 mt-0.5">Full results are available to the hiring team.</p>
                  </div>
                </div>
              ) : task.evalStatus === "failed" ? (
                <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-xl">
                  <p className="text-sm text-red-600 font-medium">Evaluation encountered an issue.</p>
                  <p className="text-xs text-red-400 mt-0.5">The hiring team has been notified. Your submission is still recorded.</p>
                </div>
              ) : null}
            </div>
          ) : deadlinePassed ? (
            <div className="px-4 py-5 bg-red-50 border border-red-200 rounded-xl text-center">
              <p className="text-sm font-semibold text-red-700">Submission window closed</p>
              <p className="text-xs text-red-500 mt-1">The 48-hour deadline has passed. Contact the hiring team if you believe this is an error.</p>
            </div>
          ) : (
            /* Submission form */
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">
                  GitHub Repository URL <span className="text-red-400">*</span>
                </label>
                <input
                  type="url"
                  value={repoInput}
                  onChange={(e) => setRepoInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                  placeholder="https://github.com/your-username/your-repo"
                  className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent"
                />
              </div>

              <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 space-y-1">
                <p className="text-xs font-semibold text-amber-700">Before submitting</p>
                <ul className="text-xs text-amber-700 space-y-0.5 list-disc list-inside">
                  <li>Make sure your repository is <strong>public</strong></li>
                  <li>Include a README with setup and run instructions</li>
                  <li>Submit using <strong>your personal GitHub account</strong> — the profile name must match your registered name</li>
                  <li>You can only submit <strong>once</strong> — make sure it's your final version</li>
                </ul>
              </div>

              {submitError && (
                <p className="text-xs text-red-500 font-medium">{submitError}</p>
              )}

              <button
                onClick={handleSubmit}
                disabled={submitting || !repoInput.trim()}
                className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl text-sm transition-colors"
              >
                {submitting ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                      <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-75" />
                    </svg>
                    Submitting…
                  </span>
                ) : "Submit Repository"}
              </button>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-gray-400 pb-6">
          Powered by InterviewAI · Questions? Contact your recruiter.
        </p>
      </div>
    </div>
  );
}
