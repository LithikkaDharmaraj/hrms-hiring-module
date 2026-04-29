import express from "express";
import cors from "cors";
import { sessionMiddleware } from "./middleware/auth";
import { validateEnv } from "./lib/env";
import apiRouter from "./routes/index";

validateEnv();

const app = express();

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

app.use(cors({
  origin: [FRONTEND_URL, "http://localhost:3000", "http://localhost:3001"],
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "x-internal-key"],
}));

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Decode NextAuth session token from Authorization: Bearer <jwe>
app.use(sessionMiddleware);

app.use("/api", apiRouter);

export default app;
