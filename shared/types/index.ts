// Shared TypeScript types between frontend and backend

export interface User {
  id: string;
  email: string;
  name: string;
  role: "admin" | "interviewer" | "candidate" | "member";
  orgId: string;
  orgName?: string;
}

export interface Interview {
  id: string;
  resume: string;
  resumeFileName?: string;
  candidateEmail?: string;
  candidateName?: string;
  token: string;
  role: string;
  level: string;
  focusAreas: string[];
  duration: number;
  status: "waiting" | "in_progress" | "completed";
  scorecard?: Scorecard | null;
  transcript: TranscriptEntry[];
  createdAt?: string;
  startedAt?: string;
  endedAt?: string;
  expiresAt?: string;
  orgId?: string;
}

export interface TranscriptEntry {
  role: "ai" | "candidate";
  text: string;
  timestamp: string;
}

export interface Scorecard {
  overall: number;
  communication: number;
  technical: number;
  problemSolving: number;
  culturalFit: number;
  summary: string;
  strengths: string[];
  improvements: string[];
  recommendation: string;
  combinedScore?: number;
}

export interface Job {
  id: string;
  orgId: string;
  title: string;
  description: string;
  requirements?: string;
  department?: string;
  location: string;
  employmentType: string;
  roleTag: string;
  levelTag: string;
  interviewDuration: number;
  status: "open" | "closed" | "draft";
  taskEnabled: boolean;
  taskTitle?: string;
  taskDescription?: string;
  taskDurationHours?: number;
  createdAt: string;
}

export interface CandidateProfile {
  id: string;
  userId: string;
  resumeText?: string;
  resumeFilename?: string;
  phone?: string;
  linkedinUrl?: string;
  portfolioUrl?: string;
  bio?: string;
  globalAtsScore?: number;
  globalAtsLabel?: string;
  updatedAt?: string;
}

export interface JobApplication {
  id: string;
  candidateId: string;
  jobId: string;
  status: string;
  appliedAt: string;
  updatedAt: string;
  atsEvaluationId?: string;
  interviewTokenId?: string;
}
