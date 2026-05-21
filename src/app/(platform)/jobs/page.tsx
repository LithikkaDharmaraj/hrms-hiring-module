"use client";

import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";

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
  interview_duration: number;
  status: string;
  created_at: string;
  application_count: number | string;
}

const INTERVIEW_DURATIONS = [10, 15, 20, 30, 45, 60, 90];

const levelOptions = ["intern", "fresher", "junior", "mid", "senior", "staff", "manager", "director"];
const typeOptions = ["full-time", "part-time", "contract", "internship"];

const blank = { title: "", description: "", requirements: "", department: "", location: "Remote", employment_type: "full-time", role_tag: "", level_tag: "mid", interview_duration: 30 };

export default function JobsManagementPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Job | null>(null);
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);
  const [filterStatus, setFilterStatus] = useState("open");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  useEffect(() => { fetchJobs(); }, [filterStatus]);

  async function fetchJobs() {
    setLoading(true);
    const res = await fetch(`/api/jobs?status=${filterStatus}`);
    if (res.ok) { const d = await res.json(); setJobs(d.jobs || []); }
    setLoading(false);
  }

  function openCreate() { setEditing(null); setForm(blank); setShowModal(true); }
  function openEdit(j: Job) {
    setEditing(j);
    setForm({ title: j.title, description: j.description, requirements: j.requirements || "", department: j.department || "", location: j.location, employment_type: j.employment_type, role_tag: j.role_tag || "", level_tag: j.level_tag || "mid", interview_duration: j.interview_duration || 30 });
    setShowModal(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      if (editing) {
        await fetch(`/api/jobs/${editing.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      } else {
        await fetch("/api/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      }
      setShowModal(false);
      fetchJobs();
    } finally { setSaving(false); }
  }

  async function handleDelete(id: string) {
    await fetch(`/api/jobs/${id}`, { method: "DELETE" });
    setConfirmDelete(null);
    fetchJobs();
  }

  async function toggleStatus(job: Job) {
    const newStatus = job.status === "open" ? "closed" : "open";
    await fetch(`/api/jobs/${job.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: newStatus }) });
    fetchJobs();
  }

  const openCount = jobs.filter(j => j.status === "open").length;

  return (
    <DashboardLayout>
      <div className="p-6 lg:p-8 max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Job Postings</h1>
            <p className="text-gray-500 text-sm mt-1">Create and manage open positions for candidates to apply</p>
          </div>
          <button onClick={openCreate} className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-xl transition-colors shadow-sm">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Post a Job
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          {[
            { label: "Total Posted", value: jobs.length },
            { label: "Currently Open", value: openCount },
            { label: "Total Applicants", value: jobs.reduce((s, j) => s + Number(j.application_count || 0), 0) },
          ].map((s) => (
            <div key={s.label} className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
              <div className="text-2xl font-bold text-gray-900">{s.value}</div>
              <div className="text-sm text-gray-500 mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Filter Tabs */}
        <div className="flex gap-2 mb-5">
          {["open", "closed"].map((s) => (
            <button key={s} onClick={() => setFilterStatus(s)}
              className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                filterStatus === s ? "bg-indigo-600 text-white" : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
              }`}>
              {s.charAt(0).toUpperCase() + s.slice(1)} Jobs
            </button>
          ))}
        </div>

        {/* Jobs Table */}
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <div className="w-7 h-7 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : jobs.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-2xl border border-gray-100">
            <p className="text-gray-500 text-sm">No {filterStatus} jobs yet.</p>
            <button onClick={openCreate} className="mt-3 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700 transition-colors">
              Post First Job
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {jobs.map((job) => (
              <div key={job.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-semibold text-gray-900">{job.title}</h3>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        job.status === "open" ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500"
                      }`}>
                        {job.status}
                      </span>
                      {job.level_tag && <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 text-xs rounded-full">{job.level_tag}</span>}
                    </div>
                    <div className="flex flex-wrap gap-3 mt-1.5 text-xs text-gray-500">
                      {job.department && <span>{job.department}</span>}
                      <span>{job.location}</span>
                      <span>{job.employment_type}</span>
                      <span className="font-medium text-indigo-600">{job.interview_duration || 30} min interview</span>
                      <span>{job.application_count} applicant{Number(job.application_count) !== 1 ? "s" : ""}</span>
                      <span>Posted {new Date(job.created_at).toLocaleDateString()}</span>
                    </div>
                    <p className="text-xs text-gray-500 mt-2 line-clamp-1">{job.description}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button onClick={() => toggleStatus(job)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors border ${
                        job.status === "open"
                          ? "border-gray-200 text-gray-600 hover:bg-gray-50"
                          : "border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                      }`}>
                      {job.status === "open" ? "Close" : "Reopen"}
                    </button>
                    <button onClick={() => openEdit(job)} className="p-1.5 text-gray-400 hover:text-indigo-600 rounded-lg hover:bg-indigo-50 transition-colors">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
                      </svg>
                    </button>
                    <button onClick={() => setConfirmDelete(job.id)} className="p-1.5 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50 transition-colors">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Delete Confirm */}
        {confirmDelete && (
          <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full">
              <h3 className="font-semibold text-gray-900 mb-2">Delete Job?</h3>
              <p className="text-sm text-gray-500 mb-4">This will remove the job posting and all related applications. This cannot be undone.</p>
              <div className="flex gap-3">
                <button onClick={() => setConfirmDelete(null)} className="flex-1 py-2 border border-gray-200 text-sm text-gray-600 rounded-xl hover:bg-gray-50">Cancel</button>
                <button onClick={() => handleDelete(confirmDelete)} className="flex-1 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-xl transition-colors">Delete</button>
              </div>
            </div>
          </div>
        )}

        {/* Create / Edit Modal */}
        {showModal && (
          <div className="fixed inset-0 z-50 bg-black/30 flex items-start justify-center p-4 overflow-y-auto">
            <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full my-8">
              <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
                <h2 className="font-semibold text-gray-900">{editing ? "Edit Job" : "Post a New Job"}</h2>
                <button onClick={() => setShowModal(false)} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <form onSubmit={handleSubmit} className="p-6 space-y-4">
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-gray-600 mb-1">Job Title *</label>
                    <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
                      placeholder="e.g. Senior Backend Engineer"
                      className="w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Department</label>
                    <input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })}
                      placeholder="Engineering"
                      className="w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Location</label>
                    <select value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })}
                      className="w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                      <option value="Remote">Remote</option>
                      <option value="Onsite">Onsite</option>
                      <option value="Online">Online</option>
                      <option value="Hybrid">Hybrid</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Employment Type</label>
                    <select value={form.employment_type} onChange={(e) => setForm({ ...form, employment_type: e.target.value })}
                      className="w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                      {typeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Level</label>
                    <select value={form.level_tag} onChange={(e) => setForm({ ...form, level_tag: e.target.value })}
                      className="w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                      {levelOptions.map((l) => <option key={l} value={l}>{l}</option>)}
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-gray-600 mb-1">Interview Duration</label>
                    <div className="flex gap-2 flex-wrap">
                      {INTERVIEW_DURATIONS.map((d) => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => setForm({ ...form, interview_duration: d })}
                          className={`px-4 py-2 rounded-xl text-sm font-medium border transition-colors ${
                            form.interview_duration === d
                              ? "bg-indigo-600 text-white border-indigo-600"
                              : "bg-white text-gray-600 border-gray-200 hover:border-indigo-300 hover:bg-indigo-50"
                          }`}
                        >
                          {d} min
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-gray-400 mt-1.5">Duration of the AI interview session candidates will take</p>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Job Description (JD) *</label>
                  <textarea required value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                    rows={6} placeholder="Describe the role, responsibilities, and what you're looking for…&#10;&#10;This will be used for ATS scoring."
                    className="w-full px-3.5 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Requirements</label>
                  <textarea value={form.requirements} onChange={(e) => setForm({ ...form, requirements: e.target.value })}
                    rows={4} placeholder="Required skills, qualifications, experience…"
                    className="w-full px-3.5 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y" />
                </div>

                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={() => setShowModal(false)}
                    className="flex-1 py-2.5 border border-gray-200 text-gray-600 text-sm font-medium rounded-xl hover:bg-gray-50">
                    Cancel
                  </button>
                  <button type="submit" disabled={saving}
                    className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors">
                    {saving ? "Saving…" : editing ? "Save Changes" : "Post Job"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
