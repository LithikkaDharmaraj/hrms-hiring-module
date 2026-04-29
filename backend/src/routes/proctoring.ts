import { Router, Request, Response } from "express";
import multer from "multer";
import { addProctoringEvent } from "../lib/store";
import { validateInterviewAccessPost } from "../middleware/auth";
import { pool } from "../lib/db";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// POST /api/proctor-event
router.post("/proctor-event", upload.single("photo"), async (req: Request, res: Response) => {
  try {
    let interviewId: string, type: string, severity: string, message: string, token: string | undefined;
    let photoData: Buffer | string | undefined;

    const contentType = req.headers["content-type"] || "";

    if (contentType.includes("multipart/form-data")) {
      interviewId = req.body.interviewId;
      type = req.body.type;
      severity = req.body.severity;
      message = req.body.message;
      token = req.body.token || undefined;
      if (req.file) {
        if (req.file.buffer.length > 100000) return res.status(400).json({ error: "Photo too large" });
        photoData = req.file.buffer;
      }
    } else {
      interviewId = req.body.interviewId;
      type = req.body.type;
      severity = req.body.severity;
      message = req.body.message;
      token = req.body.token;
      if (req.body.photo) {
        if (req.body.photo.length > 50000) return res.status(400).json({ error: "Photo too large" });
        photoData = req.body.photo;
      }
    }

    if (!interviewId || !type || !severity || !message) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    if (!(await validateInterviewAccessPost(req, interviewId, token))) {
      return res.status(403).json({ error: "Invalid interview" });
    }

    await addProctoringEvent(interviewId, {
      type, severity, message, timestamp: new Date().toISOString(), photo: photoData,
    } as any);

    return res.json({ ok: true });
  } catch (err) {
    console.error("Proctor event error:", err);
    return res.status(500).json({ error: "Failed to save proctoring event" });
  }
});

// POST /api/proctor-heartbeat
router.post("/proctor-heartbeat", async (req: Request, res: Response) => {
  try {
    const { interviewId, token } = req.body;
    if (!interviewId) return res.status(400).json({ error: "Missing interviewId" });
    if (!(await validateInterviewAccessPost(req, interviewId, token))) {
      return res.status(403).json({ error: "Unauthorized" });
    }
    await pool.query(
      "UPDATE interviews SET last_heartbeat_at = NOW() WHERE id = $1 AND status = 'in_progress'",
      [interviewId]
    );
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: "Failed" });
  }
});

export default router;
