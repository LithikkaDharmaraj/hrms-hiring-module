-- Migration 005: ATS Integration & Candidate Status Enhancements
-- Run: psql -U postgres -d ai_interview_platform -f migrations/005_ats_integration.sql

-- Add github_url to candidate_profiles (portfolio_url is retained for portfolio sites)
ALTER TABLE candidate_profiles
  ADD COLUMN IF NOT EXISTS github_url VARCHAR(500);

-- Add ATS source tracking to ats_evaluations (atsapi vs llm)
ALTER TABLE ats_evaluations
  ADD COLUMN IF NOT EXISTS evaluation_source VARCHAR(20) DEFAULT 'llm';

-- Index for faster application status queries
CREATE INDEX IF NOT EXISTS idx_job_apps_status ON job_applications(status);
CREATE INDEX IF NOT EXISTS idx_job_apps_updated ON job_applications(updated_at DESC);

-- Index proctoring events for admin dashboard performance
CREATE INDEX IF NOT EXISTS idx_proctor_interview_severity ON proctoring_events(interview_id, severity);

-- ──────────────────────────────────────────────
-- Job application status lifecycle reference:
--
--   applied              → candidate submitted application
--   ats_failed           → ATS score below threshold (50)
--   ats_error            → ATS evaluation failed (non-blocking)
--   interview_scheduled  → ATS passed, interview token created
--   interview_in_progress→ candidate started the interview session
--   interview_completed  → interview session ended
--   selected             → admin decision: Hire
--   rejected             → admin decision: Not Hire
--
-- Candidate-visible mapping (display_status):
--   applied              → "Under Review"
--   ats_failed           → "ATS Not Passed"
--   interview_scheduled  → "Interview Ready"
--   interview_completed  → "Under Review" (awaiting admin decision)
--   selected             → "Hired"
--   rejected             → "Not Selected"
-- ──────────────────────────────────────────────
