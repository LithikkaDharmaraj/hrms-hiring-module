import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getInterview } from "@/lib/store";
import { sendSelectionEmail, sendRejectionEmail } from "@/lib/email";
import { pool } from "@/lib/db";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { interviewId, type } = await req.json();
  if (!interviewId || !["selection", "rejection"].includes(type)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const interview = await getInterview(interviewId);
  if (!interview) {
    return NextResponse.json({ error: "Interview not found" }, { status: 404 });
  }
  if (!interview.candidateEmail) {
    return NextResponse.json({ error: "No candidate email on file" }, { status: 400 });
  }

  const { rows } = await pool.query(
    "SELECT o.name FROM organizations o JOIN users u ON u.org_id = o.id WHERE u.id = $1",
    [(session.user as any).id]
  );
  const orgName = rows[0]?.name || "InterviewAI";

  if (type === "selection") {
    await sendSelectionEmail(interview.candidateEmail, interview.candidateName || interview.candidateEmail, interview.role, orgName);
  } else {
    await sendRejectionEmail(interview.candidateEmail, interview.candidateName || interview.candidateEmail, interview.role, orgName);
  }

  return NextResponse.json({ ok: true });
}
