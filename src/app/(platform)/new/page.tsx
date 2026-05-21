"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useSession } from "next-auth/react";
import { DashboardLayout } from "@/components/DashboardLayout";

const LEVELS = ["Intern", "Junior", "Mid", "Senior", "Staff", "Principal", "Manager", "Director"];
const DURATIONS = [10, 15, 20, 30, 45, 60];
const ROUND_TYPES = ["General", "Technical", "Behavioral", "System Design", "Coding", "HR", "Culture Fit", "Managerial", "Case Study", "Puzzle"];
const CODING_LANGUAGES = ["JavaScript", "TypeScript", "Python", "Java", "C++", "Go", "Rust", "Haskell", "Kotlin", "Swift", "Ruby", "C#", "Scala", "SQL", "PHP"];
const FOCUS_AREAS = [
  "Technical Skills", "Behavioral", "System Design", "Problem Solving",
  "Leadership", "Communication", "Domain Knowledge", "Customer Handling",
  "Process & Operations", "People Management", "Analytical Thinking",
  "Culture Fit", "Stakeholder Management", "Project Management",
];

interface QuestionBank {
  id: number;
  name: string;
  role: string;
  level: string;
  round_type: string;
  questions: string[];
}

function SectionHeader({ step, title, subtitle }: { step: number; title: string; subtitle: string }) {
  return (
    <div className="flex items-start gap-3 mb-4">
      <div className="w-7 h-7 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
        {step}
      </div>
      <div>
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>
      </div>
    </div>
  );
}

export default function NewInterviewPage() {
  const { data: session } = useSession();
  const [candidates, setCandidates] = useState([{ email: "", name: "", phone: "" }]);
  const [role, setRole] = useState("");
  const [level, setLevel] = useState("Senior");
  const [duration, setDuration] = useState(30);
  const [roundType, setRoundType] = useState("General");
  const [codingLanguage, setCodingLanguage] = useState("JavaScript");
  const [focusAreas, setFocusAreas] = useState<string[]>(["Technical Skills"]);
  const [additionalContext, setAdditionalContext] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [interviewLink, setInterviewLink] = useState("");
  const [atsRejection, setAtsRejection] = useState<{ atsScore: number; atsLabel: string; atsResult: any } | null>(null);
  const [atsPassResult, setAtsPassResult] = useState<{ atsScore: number; atsLabel: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [questionBanks, setQuestionBanks] = useState<QuestionBank[]>([]);
  const [selectedBankId, setSelectedBankId] = useState<string>("");
  const [emailTemplates, setEmailTemplates] = useState<{ id: string; name: string; subject: string; description: string }[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/questions")
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setQuestionBanks(data); })
      .catch(() => {});
    fetch("/api/email-templates")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setEmailTemplates(data);
          const def = data.find((t: any) => t.is_default);
          if (def) setSelectedTemplateId(def.id);
        }
      })
      .catch(() => {});
  }, []);

  const toggleFocus = (area: string) => {
    setFocusAreas((prev) =>
      prev.includes(area) ? prev.filter((a) => a !== area) : [...prev, area]
    );
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile && /\.(pdf|doc|docx|txt)$/i.test(droppedFile.name)) {
      setFile(droppedFile);
    }
  }, []);

  const updateCandidate = (i: number, field: string, value: string) => setCandidates(prev => prev.map((c, idx) => idx === i ? { ...c, [field]: value } : c));

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const PHONE_RE = /^[+]?[\d\s\-().]{7,15}$/;

  const c0 = candidates[0];
  const hasContext = !!file;
  const isValid = !!c0.name.trim() && !!c0.email.trim() && EMAIL_RE.test(c0.email.trim()) && !!c0.phone.trim() && PHONE_RE.test(c0.phone.trim());
  const canSubmit = role && isValid && hasContext && !submitting;

  const emailError = (email: string) => email && !EMAIL_RE.test(email.trim()) ? "Invalid email address" : "";
  const phoneError = (phone: string) => !phone.trim() ? "Phone number is required" : !PHONE_RE.test(phone.trim()) ? "Invalid phone number" : "";
  const nameError = (name: string) => !name.trim() ? "Name is required" : "";

  const buildFormData = (c: { email: string; name: string; phone: string }) => {
    const formData = new FormData();
    formData.append("candidateEmail", c.email.trim());
    formData.append("candidateName", c.name.trim());
    formData.append("candidatePhone", c.phone.trim());
    formData.append("role", role);
    formData.append("level", level);
    formData.append("duration", String(duration));
    formData.append("focusAreas", focusAreas.join(","));
    formData.append("roundType", roundType);
    if (roundType === "Coding") formData.append("language", codingLanguage);
    if (selectedBankId) formData.append("questionBankId", selectedBankId);
    if (additionalContext.trim()) formData.append("additionalContext", additionalContext.trim());
    if (selectedTemplateId) formData.append("emailTemplateId", selectedTemplateId);
    if (file) formData.append("resume", file);
    return formData;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    setAtsRejection(null);
    setAtsPassResult(null);

    try {
      const res = await fetch("/api/create-interview", { method: "POST", body: buildFormData(candidates[0]) });
      const data = await res.json();

      if (res.status === 422 && data.qualified === false) {
        setAtsRejection({ atsScore: data.atsScore, atsLabel: data.atsLabel, atsResult: data.atsResult });
        return;
      }

      if (!res.ok) { alert(`Error: ${data.error || "Failed"}`); return; }

      if (data.id) {
        if (data.atsScore !== null && data.atsScore !== undefined) {
          setAtsPassResult({ atsScore: data.atsScore, atsLabel: data.atsLabel });
        }
        const link = data.token
          ? `${window.location.origin}/interview/${data.id}?token=${data.token}`
          : `${window.location.origin}/interview/${data.id}`;
        setInterviewLink(link);
      }
    } catch (err) {
      console.error("Create interview failed:", err);
      alert("Failed to create interview.");
    } finally {
      setSubmitting(false);
    }
  };

  const copyLink = () => {
    navigator.clipboard.writeText(interviewLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <DashboardLayout>
      <div className="max-w-3xl mx-auto">
        {/* Page header */}
        <div className="mb-8 animate-fade-in-down">
          <h1 className="text-2xl font-bold text-gray-900">Create Interview</h1>
          <p className="text-sm text-gray-500 mt-1">Set up an AI-powered interview session for your candidate</p>
        </div>

        {atsRejection ? (
          /* ── ATS Rejection Screen ───────────────────────────────── */
          <div className="card p-10 text-center space-y-6 animate-scale-in">
            <div className="w-16 h-16 mx-auto rounded-2xl bg-red-50 flex items-center justify-center">
              <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900 mb-1">Resume Does Not Meet the Bar</h2>
              <p className="text-sm text-gray-500">ATS score is below the minimum threshold of 50 to proceed</p>
            </div>

            {/* Score display */}
            <div className="flex items-center justify-center gap-4">
              <div className="relative w-28 h-28">
                <svg className="w-full h-full -rotate-90" viewBox="0 0 80 80">
                  <circle cx="40" cy="40" r="36" fill="none" stroke="#fee2e2" strokeWidth="6" />
                  <circle
                    cx="40" cy="40" r="36" fill="none" stroke="#ef4444" strokeWidth="6"
                    strokeLinecap="round"
                    strokeDasharray={2 * Math.PI * 36}
                    strokeDashoffset={2 * Math.PI * 36 * (1 - atsRejection.atsScore / 100)}
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-2xl font-bold text-red-600">{Math.round(atsRejection.atsScore)}</span>
                  <span className="text-xs text-gray-400">/100</span>
                </div>
              </div>
              <div className="text-left">
                <span className="inline-block px-3 py-1 bg-red-100 text-red-700 text-sm font-medium rounded-full mb-2">
                  {atsRejection.atsLabel}
                </span>
                {atsRejection.atsResult?.domain && (
                  <p className="text-xs text-gray-500 capitalize">Domain: {atsRejection.atsResult.domain}</p>
                )}
                {atsRejection.atsResult?.skill_coverage !== undefined && (
                  <p className="text-xs text-gray-500">
                    Skill coverage: {Math.round(atsRejection.atsResult.skill_coverage * 100)}%
                  </p>
                )}
              </div>
            </div>

            {/* Skill gaps */}
            {atsRejection.atsResult?.missing_skills?.length > 0 && (
              <div className="text-left bg-gray-50 rounded-xl p-4 space-y-2">
                <p className="text-xs font-medium text-gray-600 uppercase tracking-wider">Missing Skills</p>
                <div className="flex flex-wrap gap-1.5">
                  {atsRejection.atsResult.missing_skills.map((s: string) => (
                    <span key={s} className="px-2 py-0.5 bg-red-50 text-red-700 text-xs rounded-md border border-red-100">{s}</span>
                  ))}
                </div>
              </div>
            )}

            {atsRejection.atsResult?.matched_skills?.length > 0 && (
              <div className="text-left bg-gray-50 rounded-xl p-4 space-y-2">
                <p className="text-xs font-medium text-gray-600 uppercase tracking-wider">Matched Skills</p>
                <div className="flex flex-wrap gap-1.5">
                  {atsRejection.atsResult.matched_skills.map((s: string) => (
                    <span key={s} className="px-2 py-0.5 bg-green-50 text-green-700 text-xs rounded-md border border-green-100">{s}</span>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => setAtsRejection(null)}
                className="btn-secondary flex-1"
              >
                Back to Form
              </button>
              <button
                onClick={() => { setAtsRejection(null); setAtsPassResult(null); setFile(null); setRole(""); setCandidates([{ email: "", name: "", phone: "" }]); setAdditionalContext(""); setSelectedBankId(""); setSelectedTemplateId(""); }}
                className="btn-primary flex-1"
              >
                Start Over
              </button>
            </div>
          </div>
        ) : interviewLink ? (
          /* ── Success State ──────────────────────────────────────── */
          <div className="card p-10 text-center space-y-6 animate-scale-in relative overflow-hidden">
            {/* Subtle celebration dots */}
            <div className="absolute inset-0 pointer-events-none">
              {[...Array(8)].map((_, i) => (
                <div
                  key={i}
                  className="absolute rounded-full animate-fade-in"
                  style={{
                    width: `${3 + Math.random() * 4}px`,
                    height: `${3 + Math.random() * 4}px`,
                    left: `${15 + Math.random() * 70}%`,
                    top: `${5 + Math.random() * 30}%`,
                    backgroundColor: ["#818cf8", "#34d399", "#fbbf24"][i % 3],
                    opacity: 0.3,
                    animationDelay: `${i * 100}ms`,
                  }}
                />
              ))}
            </div>

            <div className="relative">
              <div className="w-16 h-16 mx-auto rounded-2xl bg-green-50 flex items-center justify-center">
                <svg className="w-8 h-8 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900 mb-1">Interview Created</h2>
              <p className="text-gray-500">Share this link with the candidate to begin the interview</p>
            </div>
            <div className="flex items-center gap-2 bg-gray-50 rounded-lg p-3 border border-gray-200">
              <input readOnly value={interviewLink} className="flex-1 bg-transparent text-sm text-gray-700 outline-none truncate" />
              <button onClick={copyLink} className="btn-primary shrink-0 !py-1.5 !px-3 text-xs">
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
            {selectedTemplateId ? (
              <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-4 py-3">
                <svg className="w-5 h-5 text-green-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <p className="text-sm text-green-700">Interview invite email sent to <strong>{candidates[0]?.email}</strong></p>
              </div>
            ) : (
              <p className="text-xs text-gray-400 text-center">No email template was selected — share the link manually.</p>
            )}
            <div className="flex gap-3">
              <button onClick={() => { setInterviewLink(""); setFile(null); setRole(""); setCandidates([{email:"",name:"",phone:""}]); setAdditionalContext(""); setSelectedBankId(""); setSelectedTemplateId(""); setAtsRejection(null); setAtsPassResult(null); }} className="btn-primary flex-1">
                Create Another
              </button>
              <button
                onClick={() => { window.location.href = `mailto:${candidates[0]?.email || ""}?subject=Your Interview&body=Here is your interview link: ${encodeURIComponent(interviewLink)}`; }}
                className="btn-secondary flex-1"
              >
                Open in Mail App
              </button>
            </div>
          </div>
        ) : (
          /* ── Form ───────────────────────────────────────────────── */
          <form onSubmit={handleSubmit} className="space-y-6">

            {/* Section 1: Candidate Info */}
            <div className="card p-6 animate-fade-in-up border-l-4 border-l-indigo-500">
              <SectionHeader step={1} title="Candidate Information" subtitle="Who are you interviewing?" />
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="label">Name <span className="text-red-400">*</span></label>
                    <input type="text" required value={candidates[0].name} onChange={(e) => updateCandidate(0, "name", e.target.value)}
                      placeholder="e.g. Vijay Gupta"
                      className={`input-field ${candidates[0].name !== undefined && nameError(candidates[0].name) ? "border-red-300 focus:ring-red-400" : ""}`} />
                    {candidates[0].name !== undefined && candidates[0].name !== "" && nameError(candidates[0].name) && (
                      <p className="text-xs text-red-500 mt-1">{nameError(candidates[0].name)}</p>
                    )}
                  </div>
                  <div>
                    <label className="label">Email <span className="text-red-400">*</span></label>
                    <input type="email" required value={candidates[0].email} onChange={(e) => updateCandidate(0, "email", e.target.value)}
                      placeholder="candidate@example.com"
                      className={`input-field ${candidates[0].email && emailError(candidates[0].email) ? "border-red-300 focus:ring-red-400" : ""}`} />
                    {candidates[0].email && emailError(candidates[0].email) && (
                      <p className="text-xs text-red-500 mt-1">{emailError(candidates[0].email)}</p>
                    )}
                  </div>
                  <div>
                    <label className="label">Phone <span className="text-red-400">*</span></label>
                    <input type="tel" required value={candidates[0].phone} onChange={(e) => updateCandidate(0, "phone", e.target.value)}
                      placeholder="+91 98765 43210"
                      className={`input-field ${candidates[0].phone && phoneError(candidates[0].phone) ? "border-red-300 focus:ring-red-400" : ""}`} />
                    {candidates[0].phone && phoneError(candidates[0].phone) && (
                      <p className="text-xs text-red-500 mt-1">{phoneError(candidates[0].phone)}</p>
                    )}
                  </div>
                </div>
                <div>
                  <label className="label">Role <span className="text-red-400">*</span></label>
                  <input type="text" required value={role} onChange={(e) => setRole(e.target.value)}
                    placeholder="e.g. Senior SDET, HR Manager, Sales Lead" className="input-field" />
                </div>

                {/* Email Template */}
                {emailTemplates.length > 0 && (
                  <div>
                    <label className="label">
                      Email Template <span className="text-gray-400 font-normal">(sent with interview link)</span>
                    </label>
                    <select
                      value={selectedTemplateId}
                      onChange={(e) => setSelectedTemplateId(e.target.value)}
                      className="input-field"
                    >
                      <option value="">Don't send email</option>
                      {emailTemplates.map((t) => (
                        <option key={t.id} value={t.id}>{t.name} — {t.description}</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Resume Upload */}
                <div>
                  <label className="label">
                    Resume <span className="text-red-400">*</span>
                  </label>
                  <div
                    onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={`border-2 border-dashed rounded-xl text-center cursor-pointer transition-all duration-300
                      ${isDragging ? "border-indigo-400 bg-indigo-50 scale-[1.02] shadow-lg shadow-indigo-100"
                        : file ? "border-green-300 bg-green-50 p-4"
                        : "border-gray-300 hover:border-indigo-300 hover:bg-indigo-50/30 p-6"}`}
                  >
                    <input ref={fileInputRef} type="file" accept=".pdf,.doc,.docx,.txt" className="hidden"
                      onChange={(e) => setFile(e.target.files?.[0] || null)} />
                    {file ? (
                      <div className="flex items-center justify-center gap-3 text-green-700">
                        <div className="w-8 h-8 rounded-lg bg-green-100 flex items-center justify-center">
                          <svg className="w-4 h-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        </div>
                        <span className="text-sm font-medium">{file.name}</span>
                        <button type="button" onClick={(e) => { e.stopPropagation(); setFile(null); }}
                          className="ml-1 p-1 rounded-md text-gray-400 hover:text-red-500 hover:bg-red-50 transition">&times;</button>
                      </div>
                    ) : (
                      <div className="py-2">
                        <div className="w-12 h-12 mx-auto rounded-xl bg-gray-100 flex items-center justify-center mb-3">
                          <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                          </svg>
                        </div>
                        <p className="text-sm text-gray-600 mb-1">Drop resume here or <span className="text-indigo-600 font-medium">browse files</span></p>
                        <p className="text-xs text-gray-400">Supports PDF, DOC, DOCX, TXT</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Section 2: Interview Settings */}
            <div className="card p-6 animate-fade-in-up delay-1 border-l-4 border-l-purple-500">
              <SectionHeader step={2} title="Interview Settings" subtitle="Configure the interview format" />
              <div className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="label">Level</label>
                    <select value={level} onChange={(e) => setLevel(e.target.value)} className="input-field">
                      {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label">Duration</label>
                    <select value={duration} onChange={(e) => setDuration(Number(e.target.value))} className="input-field">
                      {DURATIONS.map((d) => <option key={d} value={d}>{d} min</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label">Round</label>
                    <select value={roundType} onChange={(e) => setRoundType(e.target.value)} className="input-field">
                      {ROUND_TYPES.map((rt) => <option key={rt} value={rt}>{rt}</option>)}
                    </select>
                  </div>
                  {roundType === "Coding" && (
                    <div>
                      <label className="label">Language</label>
                      <select value={codingLanguage} onChange={(e) => setCodingLanguage(e.target.value)} className="input-field">
                        {CODING_LANGUAGES.map((lang) => <option key={lang} value={lang}>{lang}</option>)}
                      </select>
                    </div>
                  )}
                </div>

                {/* Focus Areas */}
                <div>
                  <label className="label">Focus Areas</label>
                  <div className="flex flex-wrap gap-1.5">
                    {FOCUS_AREAS.map((area) => (
                      <button key={area} type="button" onClick={() => toggleFocus(area)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200
                          ${focusAreas.includes(area)
                            ? "bg-indigo-600 text-white shadow-sm shadow-indigo-200"
                            : "bg-gray-50 text-gray-500 border border-gray-200 hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600"}`}>
                        {focusAreas.includes(area) && (
                          <svg className="w-3 h-3 inline-block mr-1 -mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                        {area}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Section 3: Context & Questions */}
            <div className="card p-6 animate-fade-in-up delay-2 border-l-4 border-l-emerald-500">
              <SectionHeader step={3} title="Interview Context" subtitle="Resume is required for ATS scoring. Additional context and question banks are optional." />
              <div className="space-y-4">
                {/* Question Bank */}
                {questionBanks.length > 0 && (
                  <div>
                    <label className="label">
                      Question Bank <span className="text-gray-400 font-normal">(optional)</span>
                    </label>
                    <select value={selectedBankId} onChange={(e) => setSelectedBankId(e.target.value)} className="input-field">
                      <option value="">None — AI will generate questions</option>
                      {questionBanks.map((bank) => (
                        <option key={bank.id} value={String(bank.id)}>
                          {bank.name} ({bank.round_type} &middot; {Array.isArray(bank.questions) ? bank.questions.length : 0}q)
                        </option>
                      ))}
                    </select>
                    {selectedBankId && (() => {
                      const bank = questionBanks.find((b) => String(b.id) === selectedBankId);
                      const qs = bank && Array.isArray(bank.questions) ? bank.questions : [];
                      return qs.length > 0 ? (
                        <div className="mt-2 space-y-1 max-h-[100px] overflow-y-auto rounded-lg border border-gray-100 p-2 bg-gray-50">
                          {qs.map((q, i) => (
                            <p key={i} className="text-xs text-gray-600">{i + 1}. {q}</p>
                          ))}
                        </div>
                      ) : null;
                    })()}
                  </div>
                )}

                {/* Additional Context */}
                <div>
                  <label className="label">
                    Additional Notes <span className="text-gray-400 font-normal">(optional)</span>
                  </label>
                  <textarea value={additionalContext} onChange={(e) => setAdditionalContext(e.target.value)}
                    placeholder={[
                      "Add any context for the AI interviewer:",
                      "",
                      "Test scores:",
                      "  Scored 85% on coding test, weak on recursion and graphs",
                      "",
                      "Coding problem to ask:",
                      "  Design an LRU cache. Expected: HashMap + DLL, O(1) get/put",
                      "",
                      "Custom scenario:",
                      "  Start with: You have a service handling 10K RPS that suddenly spikes to 50K...",
                      "",
                      "Hiring manager notes:",
                      "  Claims 5 yrs React but resume shows only 2 projects — verify depth",
                      "",
                      "Previous round feedback:",
                      "  Strong on coding, weak on system design — probe deeper",
                      "",
                      "Domain-specific:",
                      "  Ask about GDPR compliance and data retention policies",
                    ].join("\n")}
                    rows={6} className="input-field resize-none" />
                </div>

                {/* Validation hint */}
                {!hasContext && (
                  <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5">
                    <svg className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                    </svg>
                    <p className="text-xs text-amber-700">
                      Resume is required — it is used for ATS pre-screening before the interview link is generated.
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Submit */}
            <div className="animate-fade-in-up delay-3">
              <button type="submit" disabled={!canSubmit}
                className="btn-primary w-full !py-3 text-base disabled:opacity-40 disabled:cursor-not-allowed hover:translate-y-[-1px] hover:shadow-md transition-all">
                {submitting ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                      <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-75" />
                    </svg>
                    {file ? "Analyzing Resume..." : "Creating Interview..."}
                  </span>
                ) : (
                  "Create Interview"
                )}
              </button>
              {!hasContext && (
                <p className="text-xs text-center text-gray-400 mt-2">
                  Upload a resume to enable — required for ATS scoring
                </p>
              )}
              {hasContext && !isValid && (candidates[0].email || candidates[0].phone || candidates[0].name) && (
                <p className="text-xs text-center text-red-400 mt-2">
                  Fix name, email and phone errors above to continue
                </p>
              )}
            </div>
          </form>
        )}
      </div>
    </DashboardLayout>
  );
}

