import { Request, Response, NextFunction } from "express";
import { hkdf } from "@panva/hkdf";
import { jwtDecrypt } from "jose";
import { pool } from "../lib/db";

// Derive NextAuth v4 encryption key from NEXTAUTH_SECRET using HKDF
async function getEncryptionKey(secret: string): Promise<Uint8Array> {
  return hkdf("sha256", secret, "", "NextAuth.js Generated Encryption Key", 32);
}

// Decode a NextAuth v4 JWE session token
export async function decodeNextAuthToken(token: string): Promise<Record<string, any> | null> {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) return null;
  try {
    const encKey = await getEncryptionKey(secret);
    const { payload } = await jwtDecrypt(token, encKey, { clockTolerance: 15 });
    return payload as Record<string, any>;
  } catch {
    return null;
  }
}

// Express middleware: extracts session from Authorization: Bearer <token>
// Populates req.user with decoded session data if valid
export async function sessionMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const payload = await decodeNextAuthToken(token);
    if (payload) {
      (req as any).user = {
        id: payload.id || payload.sub,
        email: payload.email,
        name: payload.name,
        orgId: payload.orgId,
        orgName: payload.orgName,
        role: payload.role,
      };
    }
  }
  next();
}

// Require a valid session — returns 401 if not authenticated
export function requireSession(req: Request, res: Response, next: NextFunction) {
  if (!(req as any).user) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// Require admin or interviewer role
export function requireHR(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user;
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  if (user.role !== "admin" && user.role !== "interviewer") {
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
}

// Require admin role
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user;
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  if (user.role !== "admin") {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}

// Validate access to an interview: session (org-scoped) OR token (candidate)
export async function validateInterviewAccess(
  req: Request,
  interviewId: string
): Promise<{ authorized: boolean; session: any }> {
  const user = (req as any).user;
  if (user && user.role !== "candidate") {
    const { rows } = await pool.query("SELECT org_id FROM interviews WHERE id = $1", [interviewId]);
    if (rows.length > 0 && rows[0].org_id && user.orgId && rows[0].org_id !== user.orgId) {
      return { authorized: false, session: null };
    }
    return { authorized: true, session: user };
  }

  // Candidate token-based access
  const token = (req.query.token as string) || req.body?.token;
  if (token) {
    const { rows } = await pool.query(
      "SELECT id FROM interviews WHERE id = $1 AND token = $2",
      [interviewId, token]
    );
    if (rows.length > 0) return { authorized: true, session: null };
  }

  return { authorized: false, session: null };
}

// Validate access for POST endpoints (session OR body token)
export async function validateInterviewAccessPost(
  req: Request,
  interviewId: string,
  token?: string
): Promise<boolean> {
  const user = (req as any).user;
  if (user && user.role !== "candidate") {
    const { rows } = await pool.query("SELECT org_id FROM interviews WHERE id = $1", [interviewId]);
    if (rows.length > 0 && rows[0].org_id && user.orgId && rows[0].org_id !== user.orgId) {
      return false;
    }
    return true;
  }

  const t = token || (req.query.token as string) || req.body?.token;
  if (t) {
    const { rows } = await pool.query(
      "SELECT id FROM interviews WHERE id = $1 AND token = $2",
      [interviewId, t]
    );
    if (rows.length > 0) return true;
  }

  return false;
}
