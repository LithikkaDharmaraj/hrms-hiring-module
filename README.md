# HROS-v1 Interview Platform

A real-time interview platform with AI-powered proctoring, speech-to-text, and text-to-speech capabilities.

## Features

- Real-time video interviews with AI interviewer
- Live proctoring with phone/object detection
- Speech-to-Text (Soniox primary, browser fallback)
- Text-to-Speech (OpenAI TTS)
- AI-powered question generation and follow-ups
- Interview recording and scoring
- ATS integration for resume pre-screening
- Candidate and admin dashboards

## Tech Stack

- **Frontend**: Next.js 14, React, TypeScript, Tailwind CSS
- **Backend**: Node.js, PostgreSQL
- **AI Services**: OpenAI GPT-4o, Soniox STT
- **Real-time**: WebSocket for STT, EventStream for AI responses
- **Proctoring**: MediaPipe for object/face detection

## Setup

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy `.env.example` to `.env.local` and fill in required values:
   - `SONIOX_API_KEY` (from soniox.com)
   - `AI_API_KEY` (OpenAI API key)
   - `OPENAI_API_KEY` (for TTS if using OpenAI provider)
   - `DATABASE_URL` (PostgreSQL connection string)
   - `NEXTAUTH_SECRET` and `NEXTAUTH_URL`
   - Other optional configs as needed
4. Set up the database:
   ```bash
   # Run migrations
   npx prisma migrate dev --name init
   ```
   or manually run the SQL migrations in `/migrations`
5. Start the development server:
   ```bash
   npm run dev
   ```
6. Visit `http://localhost:3000`

## Environment Variables

See `.env.example` for all required and optional variables.

## Project Structure

- `/src/app` - Next.js app router pages and API routes
- `/src/components` - Reusable React components
- `/src/lib` - Utilities, database, providers, etc.
- `/migrations` - Database schema migrations
- `/public` - Static assets

## Key Implementation Notes

### Latency Optimizations (v1)
- AI API timeout reduced from 35s to 15s with retry logic removed
- Transcript loading optimized to load only last 20 entries
- Proctoring violation counts cached with 5-second TTL
- Improved phone detection to reduce false positives from lights

### Proctoring
- Uses MediaPipe for phone/object detection
- Tracks warnings and flags with configurable thresholds
- Interview terminates after reaching max violations

### AI Interview Flow
- Candidate speaks -> STT -> AI generates response -> TTS -> Candidate hears response
- Conversation stored in transcript entries
- Proctoring events logged independently

## Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm start` - Start production server
- `npm run lint` - Run ESLint
- `npm run type-check` - Run TypeScript type checking

## License

MIT
