"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";

interface TaskState {
  hasTask: boolean;
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

  useEffect(() => {
    const tick = () => {
      const diff = new Date(deadlineAt).getTime() - Date.now();
      if (diff <= 0) { setRemaining("Deadline passed"); return; }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setRemaining(`${h}h ${m}m ${s}s remaining`);
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [deadlineAt]);

  const urgent = new Date(deadlineAt).getTime() - Date.now() < 3 * 3600000;
  return (
    <span className={`font-mono text-xs font-semibold ${urgent ? "text-red-600" : "text-amber-600"}`}>
      {remaining}
    </span>
  );
}

export default function CompletedPage() {
  const { id } = useParams<{ id: string }>();
  const [interview, setInterview] = useState<any>(null);
  const [task, setTask] = useState<TaskState | null>(null);
  const [showConfetti, setShowConfetti] = useState(true);

  const token = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("token") ?? "" : "";

  useEffect(() => {
    const params = token ? `?token=${token}` : "";
    fetch(`/api/interview/${id}${params}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data) setInterview(data); })
      .catch(() => {});

    fetch(`/api/task-submit/${id}${params}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data) setTask(data); })
      .catch(() => {});

    const timer = setTimeout(() => setShowConfetti(false), 3000);
    return () => clearTimeout(timer);
  }, [id, token]);

  const deadlinePassed = task?.deadlineAt ? new Date() > new Date(task.deadlineAt) : false;

  return (
    <div className="min-h-screen bg-[#F9FAFB] flex flex-col items-center justify-start p-4 pt-10 relative overflow-hidden">
      {/* Confetti dots */}
      {showConfetti && (
        <div className="absolute inset-0 pointer-events-none">
          {Array.from({ length: 20 }).map((_, i) => {
            const seed = (i * 7 + 3) % 20;
            return (
              <div
                key={i}
                className="absolute rounded-full animate-fade-in"
                style={{
                  width: `${4 + (seed % 6)}px`,
                  height: `${4 + ((seed * 3) % 6)}px`,
                  left: `${10 + ((seed * 17) % 80)}%`,
                  top: `${5 + ((seed * 13) % 40)}%`,
                  backgroundColor: ["#818cf8", "#34d399", "#fbbf24", "#f472b6", "#60a5fa"][i % 5],
                  opacity: 0,
                  animation: `fadeInUp 0.6s ease-out ${i * 80}ms forwards`,
                  animationFillMode: "forwards",
                }}
              />
            );
          })}
        </div>
      )}

      <div className="w-full max-w-lg relative z-10 space-y-4">
        {/* Branding */}
        <div className="text-center animate-fade-in-down">
          <div className="inline-flex items-center gap-2.5">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25z" />
              </svg>
            </div>
            <span className="text-lg font-semibold text-gray-900">InterviewAI</span>
          </div>
        </div>

        {/* Interview complete card */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-lg shadow-gray-200/50 p-8 text-center animate-fade-in-up">
          <div className="mx-auto mb-6 relative">
            <div className="flex h-16 w-16 mx-auto items-center justify-center rounded-full bg-green-50 animate-scale-in" style={{ animationDelay: "200ms", opacity: 0 }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-8 w-8 text-green-500">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </div>
          </div>

          <h1 className="text-xl font-bold text-gray-900 mb-1 animate-fade-in-up" style={{ animationDelay: "300ms", opacity: 0 }}>
            Interview Complete
          </h1>
          <p className="text-gray-500 text-sm mb-6 animate-fade-in-up" style={{ animationDelay: "400ms", opacity: 0 }}>
            Thank you for your time. Your interview has been submitted successfully.
          </p>

          <div className="bg-gray-50 rounded-xl border border-gray-100 p-4 text-left space-y-3 animate-fade-in-up" style={{ animationDelay: "500ms", opacity: 0 }}>
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-50">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4 text-indigo-600">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                </svg>
              </div>
              <div>
                <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Role</p>
                <p className="text-sm text-gray-800 font-medium">{interview?.role || "—"} · {interview?.level || "—"}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-green-50">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4 text-green-500">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
              </div>
              <div>
                <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Status</p>
                <p className="text-sm text-green-600 font-semibold">Submitted for Review</p>
              </div>
            </div>
          </div>
        </div>

        {/* Task assigned notification banner */}
        {task?.hasTask && (
          <div className="flex items-start gap-3 bg-indigo-50 border border-indigo-200 rounded-2xl px-5 py-4 animate-fade-in-up" style={{ animationDelay: "560ms", opacity: 0 }}>
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-600 mt-0.5">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2" />
              </svg>
            </div>
            <div className="flex-1">
              <p className="text-sm font-bold text-indigo-900">Take-home task assigned</p>
              <p className="text-xs text-indigo-700 mt-0.5 leading-relaxed">
                A coding task has been assigned as the next step in your application. You have{" "}
                {task.deadlineAt ? (
                  <strong>{Math.max(0, Math.ceil((new Date(task.deadlineAt).getTime() - Date.now()) / 3600000))} hours</strong>
                ) : "48 hours"}{" "}
                to submit your GitHub repository.
              </p>
            </div>
          </div>
        )}

        {/* Take-home task card */}
        {task?.hasTask && (
          <div className="bg-white rounded-2xl border border-indigo-200 shadow-lg shadow-indigo-100/30 overflow-hidden animate-fade-in-up" style={{ animationDelay: "600ms", opacity: 0 }}>
            {/* Indigo accent bar */}
            <div className="bg-indigo-600 px-6 py-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/20">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4 text-white">
                    <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
                    <rect x="9" y="3" width="6" height="4" rx="1" />
                    <path d="M9 12h6M9 16h4" />
                  </svg>
                </div>
                <div>
                  <p className="text-xs text-indigo-200 font-semibold uppercase tracking-wider">Take-Home Assignment</p>
                  <p className="text-sm font-bold text-white leading-tight">{task.taskTitle}</p>
                </div>
              </div>
              {task.deadlineAt && !task.submittedAt && !deadlinePassed && (
                <div className="shrink-0 flex items-center gap-1 bg-white/10 rounded-lg px-2.5 py-1">
                  <svg className="w-3 h-3 text-amber-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" />
                  </svg>
                  <Countdown deadlineAt={task.deadlineAt} />
                </div>
              )}
              {deadlinePassed && !task.submittedAt && (
                <span className="text-xs font-semibold text-red-300 bg-white/10 rounded-lg px-2.5 py-1">Deadline passed</span>
              )}
            </div>

            <div className="px-6 py-5 space-y-4">
              <p className="text-sm text-gray-600 leading-relaxed">
                A take-home task has been assigned as part of your application process.
                Click below to view the full task description and submit your GitHub repository.
              </p>

              {/* Status pill if already submitted */}
              {(task.submittedAt) && (
                <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
                  <svg className="w-5 h-5 text-green-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <div>
                    <p className="text-sm font-semibold text-green-800">Repository submitted</p>
                    <p className="text-xs text-green-600 font-mono mt-0.5 break-all">{task.repoUrl}</p>
                  </div>
                </div>
              )}

              <a
                href={`/task/${id}?token=${token}`}
                className="flex items-center justify-center gap-2 w-full bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold py-2.5 rounded-xl transition"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
                  <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
                  <rect x="9" y="3" width="6" height="4" rx="1" />
                  <path d="M9 12h6M9 16h4" />
                </svg>
                {task.submittedAt ? "View Task Dashboard" : "View Task & Submit"}
              </a>
            </div>
          </div>
        )}

        {/* What happens next — only if no task */}
        {!task?.hasTask && (
          <div className="bg-white rounded-2xl border border-gray-200 p-6 animate-fade-in-up" style={{ animationDelay: "600ms", opacity: 0 }}>
            <div className="flex items-start gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-100 mt-0.5">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4 text-indigo-600">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 16v-4M12 8h.01" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-800 mb-1">What happens next?</p>
                <p className="text-sm text-gray-600 leading-relaxed">
                  Our team will review your interview responses and contact you via email with next steps.
                </p>
              </div>
            </div>
          </div>
        )}

        <p className="text-center text-xs text-gray-400 animate-fade-in" style={{ animationDelay: "800ms", opacity: 0 }}>
          Powered by InterviewAI
        </p>
      </div>
    </div>
  );
}
