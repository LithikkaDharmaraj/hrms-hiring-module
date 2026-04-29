"use client";

import { useEffect, useState, useRef } from "react";

interface Profile {
  name: string;
  email: string;
  global_ats_score: number | null;
  global_ats_label: string | null;
  global_ats_result: {
    suggestions?: string[];
    skills?: string[];
    strengths?: string[];
    domain?: string;
    years_experience?: number;
    explanation?: string;
  } | null;
  resume_text: string | null;
  resume_filename: string | null;
  phone: string | null;
  linkedin_url: string | null;
  portfolio_url: string | null;
  bio: string | null;
  global_ats_updated_at: string | null;
}

function ScoreRing({ score, size = 120 }: { score: number; size?: number }) {
  const r = size * 0.37;
  const circ = 2 * Math.PI * r;
  const filled = (score / 100) * circ;
  const color = score >= 70 ? "#10b981" : score >= 50 ? "#f59e0b" : "#ef4444";
  const cx = size / 2;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={cx} cy={cx} r={r} fill="none" stroke="#f3f4f6" strokeWidth="10" />
      <circle
        cx={cx} cy={cx} r={r} fill="none"
        stroke={color} strokeWidth="10"
        strokeDasharray={`${filled} ${circ}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${cx} ${cx})`}
        style={{ transition: "stroke-dasharray 1.2s ease" }}
      />
      <text x={cx} y={cx + 2} textAnchor="middle" dominantBaseline="middle" fontSize={size * 0.22} fontWeight="bold" fill="#111827">
        {score}
      </text>
      <text x={cx} y={cx + size * 0.17} textAnchor="middle" dominantBaseline="middle" fontSize={size * 0.1} fill="#9ca3af">
        /100
      </text>
    </svg>
  );
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [computing, setComputing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState({
    name: "", phone: "", linkedin_url: "", portfolio_url: "", bio: "",
  });
  const [resumeText, setResumeText] = useState("");
  const [resumeFilename, setResumeFilename] = useState("");
  const [resumeTab, setResumeTab] = useState<"paste" | "upload">("paste");
  const [autoFilled, setAutoFilled] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/candidate/profile")
      .then((r) => r.json())
      .then(({ profile: p }) => {
        if (p) {
          setProfile(p);
          setForm({
            name: p.name || "",
            phone: p.phone || "",
            linkedin_url: p.linkedin_url || "",
            portfolio_url: p.portfolio_url || "",
            bio: p.bio || "",
          });
          setResumeText(p.resume_text || "");
          setResumeFilename(p.resume_filename || "");
        }
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch("/api/parse-resume", { method: "POST", body: formData });
    if (res.ok) {
      const { text, extracted } = await res.json();
      setResumeText(text);
      setResumeFilename(file.name);
      // Auto-fill empty form fields with extracted values
      if (extracted) {
        let filled = false;
        setForm((prev) => {
          const next = {
            name: prev.name || extracted.name || prev.name,
            phone: prev.phone || extracted.phone || prev.phone,
            linkedin_url: prev.linkedin_url || extracted.linkedin_url || prev.linkedin_url,
            portfolio_url: prev.portfolio_url || extracted.github_url || prev.portfolio_url,
            bio: prev.bio,
          };
          filled = Object.entries(next).some(
            ([k, v]) => v !== (prev as Record<string, string>)[k]
          );
          return next;
        });
        if (filled) {
          setAutoFilled(true);
          setTimeout(() => setAutoFilled(false), 4000);
        }
      }
    } else {
      // Fallback: read as text for plain text files
      if (file.type === "text/plain") {
        const text = await file.text();
        setResumeText(text);
        setResumeFilename(file.name);
      } else {
        alert("Could not parse file. Please paste your resume as text instead.");
      }
    }
  }

  async function handleSave(recomputeAts = false) {
    setSaving(true);
    if (recomputeAts) setComputing(true);
    try {
      const res = await fetch("/api/candidate/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          resumeText: resumeText || null,
          resumeFilename: resumeFilename || null,
          recomputeAts,
        }),
      });
      if (res.ok) {
        const { profile: p, globalAts } = await res.json();
        setProfile({ ...p, ...(globalAts ? {
          global_ats_score: globalAts.score,
          global_ats_label: globalAts.label,
          global_ats_result: globalAts,
          global_ats_updated_at: new Date().toISOString(),
        } : {}) });
        setSaved(true);
        setTimeout(() => setSaved(false), 2500);
      }
    } finally {
      setSaving(false);
      setComputing(false);
    }
  }

  const atsScore = profile?.global_ats_score;
  const atsResult = profile?.global_ats_result;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="w-8 h-8 border-2 border-teal-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">My Profile</h1>
          <p className="text-gray-500 text-sm mt-1">Keep your profile updated for better ATS scores</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => handleSave(false)}
            disabled={saving}
            className="px-4 py-2 border border-gray-200 text-gray-700 text-sm font-medium rounded-xl hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            {saved ? "Saved ✓" : saving && !computing ? "Saving…" : "Save"}
          </button>
          <button
            onClick={() => handleSave(true)}
            disabled={saving || !resumeText}
            className="px-4 py-2 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors flex items-center gap-2"
          >
            {computing ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Computing…
              </>
            ) : "Save & Compute ATS"}
          </button>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Left: Profile Form */}
        <div className="lg:col-span-2 space-y-5">
          {autoFilled && (
            <div className="flex items-center gap-2 px-4 py-3 bg-teal-50 border border-teal-200 rounded-xl text-sm text-teal-800">
              <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              Fields auto-filled from your resume. Review and save.
            </div>
          )}
          {/* Basic Info */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <h2 className="font-semibold text-gray-900 mb-4">Personal Information</h2>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Full Name</label>
                <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
                <input type="email" value={profile?.email || ""} disabled
                  className="w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-sm bg-gray-50 text-gray-500 cursor-not-allowed" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Phone</label>
                <input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="+91 98765 43210"
                  className="w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">LinkedIn URL</label>
                <input type="url" value={form.linkedin_url} onChange={(e) => setForm({ ...form, linkedin_url: e.target.value })}
                  placeholder="https://linkedin.com/in/…"
                  className="w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Portfolio / GitHub URL</label>
                <input type="url" value={form.portfolio_url} onChange={(e) => setForm({ ...form, portfolio_url: e.target.value })}
                  placeholder="https://github.com/…"
                  className="w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Bio / Summary</label>
                <textarea value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })}
                  rows={3} placeholder="Brief professional summary…"
                  className="w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none" />
              </div>
            </div>
          </div>

          {/* Resume Section */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-gray-900">Resume</h2>
              {resumeFilename && (
                <span className="text-xs text-gray-500 bg-gray-100 px-2.5 py-1 rounded-full">{resumeFilename}</span>
              )}
            </div>

            {/* Tabs */}
            <div className="flex gap-1 p-1 bg-gray-100 rounded-xl mb-4 w-fit">
              {(["paste", "upload"] as const).map((t) => (
                <button key={t} onClick={() => setResumeTab(t)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    resumeTab === t ? "bg-white shadow-sm text-gray-900" : "text-gray-500 hover:text-gray-700"
                  }`}>
                  {t === "paste" ? "Paste Text" : "Upload File"}
                </button>
              ))}
            </div>

            {resumeTab === "paste" ? (
              <textarea
                value={resumeText}
                onChange={(e) => setResumeText(e.target.value)}
                rows={12}
                placeholder="Paste your full resume here…&#10;&#10;Include: summary, experience, education, skills, projects, certifications"
                className="w-full px-3.5 py-3 border border-gray-200 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-teal-500 resize-y"
              />
            ) : (
              <div
                onClick={() => fileRef.current?.click()}
                className="border-2 border-dashed border-gray-200 rounded-xl p-8 text-center cursor-pointer hover:border-teal-400 hover:bg-teal-50/30 transition-colors"
              >
                <svg className="w-10 h-10 text-gray-300 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                </svg>
                <p className="text-sm font-medium text-gray-600">Drop your resume here or click to upload</p>
                <p className="text-xs text-gray-400 mt-1">PDF, DOCX, or TXT</p>
                {resumeText && resumeFilename && (
                  <p className="text-xs text-teal-600 mt-2 font-medium">✓ {resumeFilename} loaded</p>
                )}
              </div>
            )}
            <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,.txt" className="hidden" onChange={handleFileUpload} />

            {resumeText && (
              <p className="text-xs text-gray-400 mt-2 text-right">{resumeText.split(/\s+/).length} words</p>
            )}
          </div>
        </div>

        {/* Right: ATS Score Panel */}
        <div className="space-y-5">
          {/* Score Widget */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <h2 className="font-semibold text-gray-900 mb-1">Global Resume ATS Score</h2>
            <p className="text-xs text-gray-400 mb-4">Based on your uploaded resume quality</p>
            {atsScore !== null && atsScore !== undefined ? (
              <div className="flex flex-col items-center">
                <ScoreRing score={Math.round(atsScore)} />
                <p className="text-xs text-gray-500 font-medium mt-1">Global Resume ATS Score: {Math.round(atsScore)}/100</p>
                <div className={`mt-2 px-3 py-1 rounded-full text-xs font-semibold ${
                  atsScore >= 70 ? "bg-emerald-50 text-emerald-700" :
                  atsScore >= 50 ? "bg-amber-50 text-amber-700" :
                  "bg-red-50 text-red-700"
                }`}>
                  {profile?.global_ats_label}
                </div>
                {atsResult?.domain && (
                  <p className="text-xs text-gray-500 mt-2">Domain: {atsResult.domain}</p>
                )}
                {atsResult?.years_experience !== undefined && (
                  <p className="text-xs text-gray-500">~{atsResult.years_experience} yrs experience</p>
                )}
                {profile?.global_ats_updated_at && (
                  <p className="text-xs text-gray-400 mt-1">
                    Updated {new Date(profile.global_ats_updated_at).toLocaleDateString()}
                  </p>
                )}
              </div>
            ) : (
              <div className="text-center py-4">
                <div className="w-20 h-20 rounded-full border-4 border-gray-100 flex items-center justify-center mx-auto mb-3">
                  <span className="text-2xl text-gray-300">?</span>
                </div>
                <p className="text-sm text-gray-500">Not evaluated yet</p>
                <p className="text-xs text-gray-400 mt-1">Add your resume and click "Save & Compute ATS"</p>
              </div>
            )}
          </div>

          {/* Skills */}
          {atsResult?.skills && atsResult.skills.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Detected Skills</h3>
              <div className="flex flex-wrap gap-1.5">
                {atsResult.skills.slice(0, 15).map((s, i) => (
                  <span key={i} className="px-2 py-0.5 bg-teal-50 text-teal-700 text-xs rounded-full font-medium">{s}</span>
                ))}
              </div>
            </div>
          )}

          {/* Suggestions */}
          {atsResult?.suggestions && atsResult.suggestions.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">How to Improve</h3>
              <ul className="space-y-2.5">
                {atsResult.suggestions.map((s, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <span className="flex-shrink-0 w-5 h-5 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center text-xs font-bold mt-0.5">
                      {i + 1}
                    </span>
                    <span className="text-xs text-gray-700 leading-relaxed">{s}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Explanation */}
          {atsResult?.explanation && (
            <div className="bg-gray-50 rounded-2xl border border-gray-100 p-4">
              <p className="text-xs font-semibold text-gray-500 mb-1.5">ATS Analysis</p>
              <p className="text-xs text-gray-700 leading-relaxed">{atsResult.explanation}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
