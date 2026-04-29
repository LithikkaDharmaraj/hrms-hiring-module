import { NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import type { NextRequest } from "next/server";

// Expose raw NextAuth JWE token for backend Authorization: Bearer <token> calls
export async function GET(req: NextRequest) {
  const token = await getToken({ req, raw: true, secret: process.env.NEXTAUTH_SECRET });
  if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  return NextResponse.json({ token });
}
