import { NextResponse } from "next/server";
import { randomUUID, randomBytes } from "crypto";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { saveInterview, Interview, updateInterview } from "@/lib/store";
import { sendInterviewInvite } from "@/lib/email";
import { rateLimit } from "@/lib/rate-limit";
import { pool } from "@/lib/db";
import mammoth from "mammoth";
import { inferDomain } from "@/lib/infer-domain";

async function extractTextFromPDF(buffer: Buffer): Promise<string> {
  try {
    // Use lib/pdf-parse.js directly to skip the buggy index.js
    // (index.js has a debug mode that reads a test file on require())
    const pdfParse = require("pdf-parse/lib/pdf-parse.js");
    const data = await pdfParse(buffer);
    const text = data.text?.trim() || "";
    console.log(`PDF parsed: ${text.length} chars`);
    return text || "Resume provided but could not be parsed. Proceed with general interview questions.";
  } catch (err) {
    console.error("PDF parse failed:", err);
    return "Resume provided but could not be parsed. Proceed with general interview questions.";
  }
}

export async function POST(req: Request) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    if (!rateLimit(ip, 10, 60000)) {
      return NextResponse.json({ error: "Too many requests. Try again later." }, { status: 429 });
    }

    const formData = await req.formData();
    const resumeFile = formData.get("resume") as File | null;
    const role = formData.get("role") as string;
    const level = formData.get("level") as string;
    const candidateEmail = formData.get("candidateEmail") as string;
    const candidateName = (formData.get("candidateName") as string) || "";
    const candidatePhone = (formData.get("candidatePhone") as string) || "";
    const focusAreas = (formData.get("focusAreas") as string)?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
    const duration = parseInt(formData.get("duration") as string) || 30;
    const roundType = (formData.get("roundType") as string) || "General";
    const language = (formData.get("language") as string) || "";
    const emailTemplateId = (formData.get("emailTemplateId") as string) || "";
    const additionalContext = (formData.get("additionalContext") as string) || "";
    const questionBankId = formData.get("questionBankId") as string;

    if (!role || !level) {
      return NextResponse.json({ error: "Missing required fields: role, level" }, { status: 400 });
    }

    let resumeText = "";
    let resumeFileName = "";
    let resumeBuffer: Buffer | null = null;

    if (resumeFile && resumeFile.size > 0) {
      const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
      if (resumeFile.size > MAX_FILE_SIZE) {
        return NextResponse.json({ error: "Resume file too large. Maximum size is 10MB." }, { status: 400 });
      }
      const ALLOWED_TYPES = ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "text/plain"];
      const ALLOWED_EXTENSIONS = [".pdf", ".docx", ".txt"];
      const ext = resumeFile.name.toLowerCase().split(".").pop();
      if (!ALLOWED_TYPES.includes(resumeFile.type) && !ALLOWED_EXTENSIONS.includes(`.${ext}`)) {
        return NextResponse.json({ error: "Invalid file type. Supported: PDF, DOCX, TXT." }, { status: 400 });
      }
      const arrayBuffer = await resumeFile.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      resumeBuffer = buffer;
      resumeFileName = resumeFile.name;

      if (resumeFile.name.toLowerCase().endsWith(".pdf")) {
        resumeText = await extractTextFromPDF(buffer);
      } else if (resumeFile.name.toLowerCase().endsWith(".docx")) {
        const result = await mammoth.extractRawText({ buffer });
        resumeText = result.value;
      } else {
        resumeText = buffer.toString("utf-8");
      }

      console.log(`Resume parsed: ${resumeFileName}, text length: ${resumeText.length}`);
    }

    if (!resumeText) {
      resumeText = "No resume content available. Proceed with general interview questions for the role.";
    }

    // Load question bank if selected
    let questionBankQuestions: string[] = [];
    if (questionBankId) {
      try {
        const { rows } = await pool.query("SELECT questions FROM question_banks WHERE id = $1", [questionBankId]);
        if (rows.length > 0 && rows[0].questions) {
          questionBankQuestions = Array.isArray(rows[0].questions) ? rows[0].questions : JSON.parse(rows[0].questions);
        }
      } catch (err) {
        console.error("Failed to load question bank:", err);
      }
    }

    // Append question bank questions to resume context
    if (questionBankQuestions.length > 0) {
      resumeText += `\n\n--- QUESTION BANK ---\nUse these questions during the interview:\n${questionBankQuestions.map((q, i) => `${i + 1}. ${q}`).join("\n")}`;
    }

    // Append additional context (test scores, hiring manager notes, etc.)
    if (additionalContext) {
      resumeText += `\n\n--- INTERVIEWER NOTES ---\nThe hiring team has provided the following context. Use this to guide your questions and probe specific areas:\n${additionalContext}`;
    }

    const session = await getServerSession(authOptions);
    const id = randomUUID();
    const token = randomBytes(32).toString("hex");

    // Interview link expires 7 days from now by default
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    const interview: Interview = {
      id,
      resume: resumeText,
      resumeFileName,
      candidateEmail: candidateEmail || "",
      candidateName: candidateName || "",
      candidatePhone: candidatePhone || "",
      token,
      browserFingerprint: null,
      role,
      level,
      focusAreas,
      duration,
      roundType,
      language,
      status: "waiting",
      transcript: [],
      proctoring: [],
      scorecard: null,
      createdAt: new Date().toISOString(),
      startedAt: null,
      endedAt: null,
      expiresAt: expiresAt.toISOString(),
      orgId: (session?.user as any)?.orgId || undefined,
      createdBy: (session?.user as any)?.id || undefined,
    };

    // Run ATS scoring synchronously before creating the interview
    let atsResultData: any = null;
    let atsScore: number | null = null;
    let atsLabel: string | null = null;
    let atsDomain: string | null = null;

    if (resumeBuffer !== null) {
      try {
        const atsUrl = process.env.ATS_API_URL || "http://localhost:8000";
        const jdText = `${level} ${role}${focusAreas.length ? `. Required skills: ${focusAreas.join(", ")}` : ""}`;

        // Call ATSv4 JSON API — two parallel endpoints
        const [kwRes, evalRes] = await Promise.all([
          fetch(`${atsUrl}/api/v1/ats/keywords`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ resume_text: resumeText.substring(0, 6000), job_text: jdText }),
          }),
          fetch(`${atsUrl}/api/v1/ats/evaluate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ resume_text: resumeText.substring(0, 6000), job_text: jdText }),
          }),
        ]);

        if (kwRes.ok && evalRes.ok) {
          const kw = await kwRes.json();
          const ev = await evalRes.json();
          atsScore = Math.max(0, Math.min(100, Number(ev.score) || 0));
          atsLabel = atsScore >= 50 ? "Pass" : "Reject";
          atsDomain = inferDomain(`${role} ${jdText}`);
          atsResultData = {
            score: atsScore,
            grade: ev.grade,
            label: atsLabel,
            overall_summary: ev.overall_summary,
            strengths: ev.strengths,
            risks: ev.risks,
            interview_focus: ev.interview_focus,
            matched_skills: (kw.keyword_matches || []).map((m: { job_keyword: string }) => m.job_keyword),
            missing_skills: kw.missing_keywords || [],
            keyword_coverage: kw.keyword_coverage,
            _source: "atsv4",
          };
        }
      } catch (err) {
        console.error("ATS scoring failed (non-blocking):", err);
      }
    }

    // Block interview creation if ATS score is below threshold
    if (atsScore !== null && atsScore < 50) {
      return NextResponse.json(
        { qualified: false, atsScore, atsLabel, atsResult: atsResultData, atsDomain },
        { status: 422 }
      );
    }

    await saveInterview(interview);

    // Persist ATS result alongside the interview record
    if (atsResultData) {
      await updateInterview(id, {
        atsScore,
        atsLabel,
        atsResult: atsResultData,
        atsDomain,
      } as any);
    }

    const interviewUrl = `/interview/${id}?token=${token}`;

    if (candidateEmail && emailTemplateId) {
      const fullUrl = `${req.headers.get("origin") || ""}${interviewUrl}`;
      // Load custom template from DB
      const { rows: tplRows } = await pool.query("SELECT subject, body FROM email_templates WHERE id = $1", [emailTemplateId]);
      if (tplRows.length > 0) {
        const tpl = tplRows[0];
        const orgName = (session?.user as any)?.orgName || "InterviewAI";
        const firstName = (candidateName || "").split(" ")[0] || "there";
        // Replace template variables
        const subject = tpl.subject
          .replace(/\{\{role\}\}/g, role).replace(/\{\{orgName\}\}/g, orgName)
          .replace(/\{\{candidateName\}\}/g, candidateName || "Candidate")
          .replace(/\{\{firstName\}\}/g, firstName).replace(/\{\{level\}\}/g, level)
          .replace(/\{\{duration\}\}/g, String(duration));
        const bodyText = tpl.body
          .replace(/\{\{role\}\}/g, role).replace(/\{\{orgName\}\}/g, orgName)
          .replace(/\{\{candidateName\}\}/g, candidateName || "Candidate")
          .replace(/\{\{firstName\}\}/g, firstName).replace(/\{\{level\}\}/g, level)
          .replace(/\{\{duration\}\}/g, String(duration));
        // Send using the template
        const { sendCustomEmail } = await import("@/lib/email");
        sendCustomEmail(candidateEmail, subject, bodyText, fullUrl, orgName).catch(console.error);
      } else {
        sendInterviewInvite(candidateEmail, candidateName || candidateEmail, fullUrl, role, duration).catch(console.error);
      }
    } else if (candidateEmail) {
      const fullUrl = `${req.headers.get("origin") || ""}${interviewUrl}`;
      sendInterviewInvite(candidateEmail, candidateName || candidateEmail, fullUrl, role, duration).catch(console.error);
    }

    return NextResponse.json({
      id, token, url: interviewUrl, candidateEmail,
      qualified: true,
      atsScore,
      atsLabel,
      atsResult: atsResultData,
      atsDomain,
    });
  } catch (error) {
    console.error("Failed to create interview:", error);
    return NextResponse.json({ error: "Failed to create interview" }, { status: 500 });
  }
}
