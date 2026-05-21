import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { pool } from "@/lib/db";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const { id } = params;

  if (!UUID_REGEX.test(id)) {
    return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
  }

  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { rows } = await pool.query(
    "SELECT recording_data, recording_mime FROM interviews WHERE id = $1",
    [id]
  );

  if (rows.length === 0 || !rows[0].recording_data) {
    return NextResponse.json({ error: "Recording not found" }, { status: 404 });
  }

  const buffer: Buffer = rows[0].recording_data;
  const mime: string = rows[0].recording_mime || "audio/webm";

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": mime,
      "Content-Length": buffer.length.toString(),
      "Content-Disposition": `attachment; filename="interview-${id}.webm"`,
    },
  });
}
