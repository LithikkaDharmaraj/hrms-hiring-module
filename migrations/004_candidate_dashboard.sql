-- Migration 004: Candidate Dashboard & Job Application System
-- Run: psql -U postgres -d ai_interview_platform -f migrations/004_candidate_dashboard.sql

-- Candidates pool organization (separate from hiring orgs)
INSERT INTO organizations (id, name, slug, created_at)
VALUES ('00000000-0000-0000-0000-000000000002', 'Candidates Pool', 'candidates-pool', NOW())
ON CONFLICT (id) DO NOTHING;

-- Jobs posted by organizations
CREATE TABLE IF NOT EXISTS jobs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title         VARCHAR(255) NOT NULL,
  description   TEXT NOT NULL,
  requirements  TEXT,
  department    VARCHAR(100),
  location      VARCHAR(100) DEFAULT 'Remote',
  employment_type VARCHAR(50) DEFAULT 'full-time',
  role_tag      VARCHAR(100),
  level_tag     VARCHAR(50) DEFAULT 'mid',
  status        VARCHAR(20) DEFAULT 'open',
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ATS Service owns this table — no interview data here
CREATE TABLE IF NOT EXISTS ats_evaluations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id    UUID NOT NULL,
  job_id          UUID REFERENCES jobs(id) ON DELETE SET NULL,
  resume_text     TEXT NOT NULL,
  score           FLOAT NOT NULL,
  label           VARCHAR(50) NOT NULL,
  matched_skills  JSONB DEFAULT '[]',
  missing_skills  JSONB DEFAULT '[]',
  suggestions     JSONB DEFAULT '[]',
  domain          VARCHAR(100),
  skill_coverage  FLOAT DEFAULT 0,
  explanation     TEXT,
  is_global       BOOLEAN DEFAULT FALSE,
  full_result     JSONB,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Interview Service owns this table — no ATS data here
CREATE TABLE IF NOT EXISTS interview_tokens (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id    UUID NOT NULL,
  job_id          UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  application_id  UUID,
  token           VARCHAR(255) UNIQUE NOT NULL,
  interview_url   TEXT NOT NULL,
  status          VARCHAR(50) DEFAULT 'pending',
  result          VARCHAR(50),
  expires_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(candidate_id, job_id)
);

-- Orchestration layer — ties ATS + Interview together per application
CREATE TABLE IF NOT EXISTS job_applications (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id          UUID NOT NULL,
  job_id                UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  ats_evaluation_id     UUID REFERENCES ats_evaluations(id) ON DELETE SET NULL,
  interview_token_id    UUID REFERENCES interview_tokens(id) ON DELETE SET NULL,
  status                VARCHAR(50) DEFAULT 'applied',
  applied_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(candidate_id, job_id)
);

-- Candidate-specific profile extending users table
CREATE TABLE IF NOT EXISTS candidate_profiles (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resume_text             TEXT,
  resume_filename         VARCHAR(255),
  global_ats_score        FLOAT,
  global_ats_label        VARCHAR(50),
  global_ats_result       JSONB,
  global_ats_updated_at   TIMESTAMPTZ,
  phone                   VARCHAR(50),
  linkedin_url            VARCHAR(500),
  portfolio_url           VARCHAR(500),
  bio                     TEXT,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_jobs_org_id       ON jobs(org_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status        ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_created_at    ON jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ats_eval_candidate ON ats_evaluations(candidate_id);
CREATE INDEX IF NOT EXISTS idx_ats_eval_job       ON ats_evaluations(job_id);
CREATE INDEX IF NOT EXISTS idx_int_tokens_cand    ON interview_tokens(candidate_id);
CREATE INDEX IF NOT EXISTS idx_int_tokens_token   ON interview_tokens(token);
CREATE INDEX IF NOT EXISTS idx_job_apps_candidate ON job_applications(candidate_id);
CREATE INDEX IF NOT EXISTS idx_job_apps_job       ON job_applications(job_id);
CREATE INDEX IF NOT EXISTS idx_cand_profile_user  ON candidate_profiles(user_id);
