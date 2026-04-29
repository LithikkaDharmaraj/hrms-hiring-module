import { Router } from "express";
import multer from "multer";
import { requireSession } from "../middleware/auth";
import authRouter from "./auth";
import interviewRouter from "./interview";
import aiRouter from "./ai";
import adminRouter from "./admin";
import candidateRouter from "./candidate";
import { parseResumeHandler } from "./candidate";
import jobsRouter from "./jobs";
import proctoringRouter from "./proctoring";
import servicesRouter from "./services";
import portalRouter from "./portal";
import tasksRouter from "./tasks";
import systemRouter from "./system";
import usersRouter from "./users";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.use("/auth", authRouter);
router.use("/", interviewRouter);
router.use("/", aiRouter);
router.use("/admin", adminRouter);
router.use("/candidate", candidateRouter);
router.post("/parse-resume", requireSession, upload.single("file"), parseResumeHandler);
router.use("/jobs", jobsRouter);
router.use("/", proctoringRouter);
router.use("/services", servicesRouter);
router.use("/portal", portalRouter);
router.use("/tasks", tasksRouter);
router.use("/", systemRouter);
router.use("/users", usersRouter);

export default router;
