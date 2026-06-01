# AI Interview Platform (hros-v1) - Comprehensive Developer Guide

Welcome to the AI Interview Platform! This document serves as both a Product Requirements Document (PRD) and an extensive Developer Onboarding Guide. It is designed to help new developers understand the architecture, setup the project, and effectively test complex modules like real-time proctoring and WebSockets.

---

## Table of Contents
1. [Product Overview & Goals](#1-product-overview--goals)
2. [System Architecture](#2-system-architecture)
3. [Directory Structure & Key Files](#3-directory-structure--key-files)
4. [Local Development Setup](#4-local-development-setup)
5. [Testing & Debugging Guide](#5-testing--debugging-guide)
6. [Deep Dive: Core Modules](#6-deep-dive-core-modules)
7. [Troubleshooting](#7-troubleshooting)

---

## 1. Product Overview & Goals
The AI Interview Platform is an automated, AI-driven voice interview system designed to screen, interview, and evaluate candidates autonomously. It streamlines the hiring process by combining ATS (Applicant Tracking System) resume parsing, real-time conversational AI, automated scoring, and candidate proctoring into a single cohesive platform.

**Core Features:**
* **Automate Initial Screening:** Automatically filter candidates based on ATS resume scoring before an interview link is even generated.
* **Standardize Interviews:** Provide a consistent, unbiased interview experience using an AI persona ("Alex") with adaptive question difficulty and domain-specific knowledge.
* **Reduce Time-to-Hire:** Evaluate candidates instantly via AI-generated scorecards detailing strengths, weaknesses, transcript evidence, and a final recommendation.
* **Ensure Interview Integrity:** Monitor candidate behavior through automated proctoring (webcam snapshots, tab switching detection) during the interview session.

---

## 2. System Architecture

### Tech Stack
* **Frontend:** Next.js (React), Tailwind CSS, `@monaco-editor/react`.
* **Backend:** Next.js App Router API Routes (`/api/*`), Custom Node.js Server (`server-custom.js`).
* **Database:** PostgreSQL (via `pg` pool).
* **AI / ML / Audio:**
  * **LLMs:** Juspay AI / GPT-4o / Kimi for interview logic, resume parsing, and scorecard generation.
  * **STT (Speech-to-Text):** WebSocket streaming proxy to Soniox, Deepgram, or Sarvam.
  * **TTS (Text-to-Speech):** Edge TTS via Python CLI wrapper.
  * **Computer Vision (Proctoring):** MediaPipe Vision Tasks (Face Detection, Object Detection) running in-browser via WebAssembly.

### The Custom Server (`server-custom.js`)
Next.js alone does not natively support handling WebSocket upgrades on the same port easily in production. We use a custom Node.js wrapper:
* **In Dev:** Runs a standard Node `http.createServer`, passes requests to Next.js, and catches WS upgrades on `/api/stt-ws`.
* **In Prod:** Monkey-patches Next.js's internal server creation, injecting our WebSocket proxy logic to allow STT streaming over the exact same port without a separate microservice.

---

## 3. Directory Structure & Key Files

* `server-custom.js`: Entry point. Handles ENV loading, DB pooling, and the WebSocket STT proxy.
* `src/components/Proctoring.tsx`: The client-side brain for anti-cheat. Uses MediaPipe to track gaze, phones, and face presence.
* `src/lib/parse-scorecard.ts`: Contains an 8-stage repair mechanism to aggressively sanitize and parse malformed JSON returned by LLMs.
* `src/lib/providers/tts-edge.ts`: Integrates with the `edge-tts` python CLI to generate MP3 speech buffers.
* `src/app/api/(candidate)/parse-resume/route.ts`: Extracts text from PDF (`pdf-parse`), DOCX (`mammoth`), and TXT, then queries an LLM to extract JSON metadata (Name, Email, Phone, etc.).
* `src/app/(platform)/new/page.tsx`: The interview creation UI. Combines resume upload, ATS thresholds, candidate details, and question bank configuration.

---

## 4. Local Development Setup

### Prerequisites
1. **Node.js** (v18+ recommended)
2. **Python** (v3.8+ required for Edge TTS)
3. **PostgreSQL** Database (Local or Cloud)

### Step-by-Step
1. **Install Node Dependencies:**
   ```bash
   npm install
   ```
2. **Install Python Dependencies:**
   The `edge-tts` integration relies on a python package.
   ```bash
   pip install edge-tts
   ```
   *Verify it works by running `edge-tts --version` in your terminal.*
3. **Setup Database:**
   Ensure you have a PostgreSQL database running. Apply your schema migrations (typically using Prisma or raw SQL scripts located in the project).
4. **Configure Environment Variables:**
   Create a `.env.local` file in the root directory.
   ```env
   # Database
   DATABASE_URL="postgresql://postgres:password@localhost:5432/ai_interview_platform"
   
   # AI / LLM Integration
   AI_BASE_URL="https://api.openai.com"
   AI_API_KEY="sk-..."
   AI_MODEL="gpt-4o"
   
   # STT (Choose one: soniox, deepgram, sarvam)
   STT_PROVIDER="soniox"
   SONIOX_API_KEY="..."
   ```
5. **Start the Development Server:**
   Do **NOT** use `npm run dev` if it points to `next dev`. You **must** run through the custom server to enable WebSockets!
   ```bash
   node server-custom.js
   ```
   *The app should now be running on `http://localhost:3000`.*

---

## 5. Testing & Debugging Guide

### 5.1 Debugging Proctoring (`Proctoring.tsx`)
The proctoring module runs heavily optimized Computer Vision models. Debugging silently failing thresholds can be difficult. We built a dedicated debug mode.

**How to Enable Proctoring Debug Mode:**
1. Open the Candidate Interview View.
2. Open Browser DevTools Console.
3. Run: `localStorage.setItem("proctoring_debug", "true"); location.reload();`
4. *Alternatively*, append `?proc_debug` to the URL.

**What to look for in the console:**
* **Gaze Tracking:** Look for logs like `gaze raw=0.450 smoothed=0.320 enter=0.40`. If `smoothed` exceeds `enter`, it triggers a flag. If it's not calibrating, ensure lighting is good (calibration takes 1 frame).
* **Phone Detection:** Look for `phone model: X total detections`. It logs rejected bounding boxes (e.g., `skip: area 0.003 < 0.005`). 
* **Brightness Fallback:** If the ML model fails to load, the system falls back to pixel-brightness block analysis to detect phone screens.

### 5.2 Testing WebSocket STT (`server-custom.js`)
To test if your STT provider is working correctly:
1. Start the interview.
2. Open the Network tab in DevTools -> Filter by **WS** (WebSockets).
3. Look for the `/api/stt-ws` connection.
4. Click the "Messages" tab. You should see binary frames going UP (audio) and JSON strings coming DOWN (transcripts).
5. **Provider Specifics:**
   * *Soniox:* Uses a sliding window logic. `server-custom.js` intercepts and normalizes Soniox tokens so Next.js frontend only sees standard `is_final` booleans.
   * *Deepgram/Sarvam:* Ensure headers/protocols are being passed correctly in the proxy connection.

### 5.3 Testing AI Scorecard Generation (`parse-scorecard.ts`)
Scorecard generation is heavily prompt-dependent and LLMs often output broken JSON (e.g., Markdown wrapping, unescaped quotes, trailing commas). 

**How to test the JSON parser:**
You can create mock strings and pass them to `parseScorecardJSON(raw)`. The parser runs through 8 stages:
1. Native parse.
2. Markdown strip.
3. Greedy Brace Extraction `{ ... }`.
4. Truncated comma repair.
5. Single quote `key` translation.
6. Single quote `value` translation.
7. Closing unclosed brackets.
8. Passing the string through `jsonrepair` library.

### 5.4 Testing Resume Upload & ATS
1. Go to `/new` (Create Interview).
2. Drag and drop a sample PDF or DOCX file.
3. Check the DevTools Network tab for the `/api/parse-resume` response. It should successfully extract candidate metadata using `pdf-parse`/`mammoth` + LLM extraction.
4. If the resume is poor, the ATS integration (`setAtsRejection`) will display the red rejection UI circle preventing interview creation.

---

## 6. Deep Dive: Core Modules

### The STT Proxy Logic
Located in `server-custom.js`, `addWSProxy(server)` listens for `/api/stt-ws`.
* It verifies the interview token against the database via `pg` pool.
* Opens an upstream connection to the STT provider.
* Passes Audio bytes directly to the provider.
* Passes KeepAlive JSON to the provider (translating Next.js KeepAlive syntax to the provider's specific syntax).
* Intercepts messages coming back. *For Soniox*, it rebuilds utterances statefully and emits `<end>` tokens as `is_final=true`.

### The Proctoring State Machine
Located in `Proctoring.tsx`.
* **Phone Detection:** State moves from `absent` -> `suspected` (1st hit) -> `detected` (2 consecutive hits). Requires an Intersect-Over-Union (IoU) continuity to prevent false positives from flickering lights.
* **Gaze Detection:** Calculates the ratio of the nose keypoint relative to the midpoint between the eyes. Uses an Exponential Moving Average (EMA) to prevent rapid flickering. Drops to a harsher EMA if MediaPipe reports low confidence (e.g., bad lighting).

---

## 7. Troubleshooting

**1. `Error: edge-tts CLI is not installed`**
* **Cause:** The Node backend is trying to synthesize speech, but Python is missing.
* **Fix:** Run `pip install edge-tts`. Ensure your system `PATH` sees the installed binary.

**2. WebSocket drops after exactly 10-15 seconds of silence.**
* **Cause:** Your STT provider is timing out because no audio is flowing.
* **Fix:** `server-custom.js` runs a `setInterval` ping every 5s. Ensure the correct Ping JSON (`KeepAlive` or `keepalive`) is being sent for your provider.

**3. MediaPipe FaceDetector fails to load on the frontend.**
* **Cause:** WebAssembly files are blocked by ad-blockers, network policies, or missing internet.
* **Fix:** The system automatically falls back to Chrome's native `FaceDetector` API if available. Ensure `jsDelivr` CDN is accessible.

**4. Database connections are exhausted / "Too many clients".**
* **Cause:** Fast refreshes in development mode duplicate the `pg` Pool.
* **Fix:** `server-custom.js` sets `max: 3` connections. If the issue persists, kill the node process and restart.

**5. "Resume Does Not Meet the Bar" triggers incorrectly.**
* **Cause:** The ATS LLM prompt evaluates the resume harshly against the job role.
* **Fix:** During testing, input highly-senior roles or bypass the ATS check in `/new/page.tsx` temporarily by commenting out the `res.status === 422` handler.