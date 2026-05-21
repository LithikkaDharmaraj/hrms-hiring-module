import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

interface ExtractedFields {
  name?: string;
  phone?: string;
  linkedin_url?: string;
  github_url?: string;
}

async function extractFieldsFromResume(text: string): Promise<ExtractedFields> {
  const aiBase = process.env.AI_BASE_URL;
  const aiKey = process.env.AI_API_KEY;
  if (!aiBase || !aiKey) return {};

  const prompt = `Extract contact details from this resume. Return ONLY valid JSON, no markdown.

Resume (first 3000 chars):
${text.substring(0, 3000)}

JSON format:
{
  "name": "<full name or null>",
  "phone": "<phone number with country code or null>",
  "linkedin_url": "<full LinkedIn URL or null>",
  "github_url": "<full GitHub URL or null>"
}

Rules:
- Only extract clearly present values; use null if not found
- linkedin_url must start with https://linkedin.com or https://www.linkedin.com
- github_url must start with https://github.com`;

  const res = await fetch(`${aiBase}/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${aiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.AI_MODEL || "gpt-4o",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 200,
      temperature: 0,
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) return {};
  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content || "";
  const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    const fields: ExtractedFields = {};
    if (parsed.name && typeof parsed.name === "string") fields.name = parsed.name.trim();
    if (parsed.phone && typeof parsed.phone === "string") fields.phone = parsed.phone.trim();
    if (parsed.linkedin_url && typeof parsed.linkedin_url === "string") fields.linkedin_url = parsed.linkedin_url.trim();
    if (parsed.github_url && typeof parsed.github_url === "string") fields.github_url = parsed.github_url.trim();
    return fields;
  } catch {
    return {};
  }
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const mimeType = file.type;
    const fileName = file.name.toLowerCase();

    let text = "";

    if (mimeType === "application/pdf" || fileName.endsWith(".pdf")) {
      // Use lib path directly — the default export tries to load a test file on import
      const pdfParse = (await import("pdf-parse/lib/pdf-parse.js")).default;
      const data = await pdfParse(buffer);
      text = data.text;
    } else if (
      mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      fileName.endsWith(".docx")
    ) {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer });
      text = result.value;
    } else if (mimeType === "text/plain" || fileName.endsWith(".txt")) {
      text = buffer.toString("utf-8");
    } else {
      return NextResponse.json({ error: "Unsupported file type. Please upload a PDF, DOCX, or TXT file." }, { status: 400 });
    }

    text = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

    if (!text || text.length < 50) {
      return NextResponse.json({ error: "Could not extract text from the file. Please try a different format." }, { status: 422 });
    }

    // Extract structured fields in parallel with returning text — non-blocking
    const extracted = await extractFieldsFromResume(text).catch(() => ({} as ExtractedFields));

    return NextResponse.json({ text, extracted });
  } catch (err) {
    console.error("[parse-resume]", err);
    return NextResponse.json({ error: "Failed to parse file" }, { status: 500 });
  }
}
