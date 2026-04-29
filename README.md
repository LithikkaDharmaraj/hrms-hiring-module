<p align="center">
  <img src="https://img.shields.io/badge/Next.js-14-black?style=for-the-badge&logo=next.js" />
  <img src="https://img.shields.io/badge/Express-5-000000?style=for-the-badge&logo=express" />
  <img src="https://img.shields.io/badge/TypeScript-5.4-blue?style=for-the-badge&logo=typescript" />
  <img src="https://img.shields.io/badge/PostgreSQL-16-336791?style=for-the-badge&logo=postgresql" />
  <img src="https://img.shields.io/badge/Deepgram-STT%2FTTS-13EF93?style=for-the-badge" />
</p>

<h1 align="center">InterviewAI</h1>
<p align="center">AI-powered voice &amp; video interview platform — multi-tenant, real-time proctoring, automated scoring</p>

---

## Architecture

```
ai-interview-hiring/
├── frontend/          Next.js 14 (App Router) — UI only, port 3000
├── backend/           Express 5 (Node.js) — all APIs, port 8000
├── shared/            Shared TypeScript types
├── migrations/        PostgreSQL schema migrations
└── README.md
```

The frontend proxies all `/api/*` requests to the backend via Next.js rewrites.  
NextAuth sessions stay in the frontend; the backend validates JWE tokens on each request.

---

## Quick Start

### Prerequisites

- Node.js 20+
- PostgreSQL 15+

### 1. Database

```bash
psql -U postgres -c "CREATE DATABASE ai_interview_platform;"
psql -U postgres -d ai_interview_platform -f migrations/001_schema.sql
```

### 2. Backend

```bash
cd backend
cp .env.example .env          # edit with your credentials
npm install
npm run dev                    # starts on http://localhost:8000
```

### 3. Frontend

```bash
cd frontend
cp .env.local.example .env.local   # edit if needed
npm install
npm run dev                         # starts on http://localhost:3000
```

Open http://localhost:3000 — login with `admin@interview.ai` / `admin123`

---

## Environment Variables

### Backend (`backend/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `NEXTAUTH_SECRET` | Yes | Must match frontend `NEXTAUTH_SECRET` |
| `FRONTEND_URL` | Yes | Frontend URL (`http://localhost:3000`) |
| `BACKEND_URL` | Yes | Backend URL (`http://localhost:8000`) |
| `AI_BASE_URL` | Yes | OpenAI-compatible API base URL |
| `AI_API_KEY` | Yes | API key for AI model |
| `AI_MODEL` | No | Model name (default: `gpt-4o`) |
| `DEEPGRAM_API_KEY` | Yes | Deepgram API key for STT/TTS |
| `TTS_PROVIDER` | No | `deepgram` (default) or `edge` (free) |
| `SMTP_HOST` | No | Email SMTP host |
| `SMTP_PORT` | No | Email SMTP port |
| `SMTP_USER` | No | Email username |
| `SMTP_PASS` | No | Email password |
| `INTERNAL_SERVICE_KEY` | No | Secret key for internal service-to-service calls |
| `TASK_EVAL_API_URL` | No | Task evaluation service URL (default: `http://localhost:9000`) |

### Frontend (`frontend/.env.local`)

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_API_URL` | Yes | Backend API URL (`http://localhost:8000`) |
| `BACKEND_URL` | Yes | Backend URL for server-side calls (`http://localhost:8000`) |
| `NEXT_PUBLIC_WS_URL` | No | WebSocket URL for STT proxy (defaults to backend URL) |
| `NEXTAUTH_URL` | Yes | Frontend URL (`http://localhost:3000`) |
| `NEXTAUTH_SECRET` | Yes | Must match backend `NEXTAUTH_SECRET` |

---

## Features

- **Voice interviews** — AI conducts real-time conversations with STT + TTS
- **Proctoring** — face detection, eye tracking, tab-switch detection, periodic photo capture
- **Auto-scoring** — 5-dimension scorecard generated when interview ends
- **ATS pipeline** — resume parsing, job matching, candidate ranking
- **Task evaluation** — coding task submission with automated code review
- **Multi-tenant** — organizations, roles (admin / interviewer / member / candidate)
- **Email notifications** — invite, rejection, selection emails

### Supported AI Providers

Works with any OpenAI-compatible API:

| Provider | `AI_BASE_URL` | `AI_MODEL` |
|----------|---------------|------------|
| OpenAI | `https://api.openai.com` | `gpt-4o` |
| Groq | `https://api.groq.com/openai` | `llama-3.1-70b` |
| Together AI | `https://api.together.xyz` | `meta-llama/Llama-3-70b` |
| Local (Ollama) | `http://localhost:11434` | `llama3` |

---

## API Overview

All routes are served by the backend at `http://localhost:8000/api/*`.

| Prefix | Description |
|--------|-------------|
| `/api/auth/*` | Login, register, token validation |
| `/api/interviews/*` | Interview CRUD, start/end lifecycle |
| `/api/ai-*`, `/api/tts`, `/api/stt-ws` | AI responses, TTS, STT WebSocket proxy |
| `/api/candidate/*` | Candidate application, profile, task submission |
| `/api/admin/*` | HR dashboard — candidates, tasks, submissions |
| `/api/jobs/*` | Job posting management |
| `/api/tasks/*` | Task templates (HR) + candidate task portal |
| `/api/services/*` | Internal service endpoints (ATS, interview creation) |
| `/api/users/*` | User management (admin) |
| `/api/health` | Health check |

---

## Database

Schema in [`migrations/001_schema.sql`](migrations/001_schema.sql). Key tables:

```
organizations ── users ── interviews ── transcript_entries
                                    ── proctoring_events
jobs ── job_applications ── candidate_tasks ── task_submissions
```

---

## Security

| Protection | Implementation |
|------------|----------------|
| SQL Injection | Parameterized queries everywhere |
| Auth | NextAuth JWE tokens validated on every backend request via HKDF+jose |
| Password | bcrypt (cost 12) |
| File Upload | 10MB limit + MIME validation |
| Tenant Isolation | Org-scoped queries on all data |
| XSS | HTML-escaped email templates |

---

## License

MIT
