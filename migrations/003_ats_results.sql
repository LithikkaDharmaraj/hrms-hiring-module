-- Migration 003: Add ATS pre-screen result columns
-- Run: psql -U postgres -d ai_interview_platform -f migrations/003_ats_results.sql

ALTER TABLE interviews
  ADD COLUMN IF NOT EXISTS ats_score FLOAT,
  ADD COLUMN IF NOT EXISTS ats_label VARCHAR(50),
  ADD COLUMN IF NOT EXISTS ats_result JSONB,
  ADD COLUMN IF NOT EXISTS ats_domain VARCHAR(50);
