import { NextResponse } from "next/server";
import { validateAccessPost } from "@/lib/auth-check";
import { pool } from "@/lib/db";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const audio = formData.get("audio") as File | null;
    const interviewId = formData.get("interviewId") as string;
    const token = (formData.get("token") as string) || undefined;

    if (!audio || !interviewId) {
      return NextResponse.json({ error: "Missing audio or interviewId" }, { status: 400 });
    }

    if (!UUID_REGEX.test(interviewId)) {
      return NextResponse.json({ error: "Invalid interview ID" }, { status: 400 });
    }

    if (!(await validateAccessPost(interviewId, token))) {
      return NextResponse.json({ error: "Invalid interview" }, { status: 403 });
    }

    const buffer = Buffer.from(await audio.arrayBuffer());
    const mime = audio.type || "audio/webm";

    await pool.query(
      "UPDATE interviews SET recording_data = $1, recording_mime = $2 WHERE id = $3",
      [buffer, mime, interviewId]
    );

    console.log(`Recording saved to DB for interview ${interviewId} (${buffer.length} bytes)`);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Upload recording failed:", error);
    return NextResponse.json({ error: "Failed to save recording" }, { status: 500 });
  }
}
