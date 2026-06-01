"use client";

import { useEffect, useRef, useCallback } from "react";

// ─── Debug mode ───────────────────────────────────────────────────────────────
// Enable in-browser: append ?proc_debug to the interview URL
// OR run in console: localStorage.setItem("proctoring_debug","true"); location.reload()
// Shows per-frame confidence, IoU, rejection reasons, threshold crossings, state transitions.
const isDebug = () => {
  if (typeof window === "undefined") return false;
  try {
    return window.location.search.includes("proc_debug") ||
      localStorage.getItem("proctoring_debug") === "true";
  } catch { return false; }
};
const dbg = (...args: any[]) => { if (isDebug()) console.log("[Proc]", ...args); };

// ─── Tunable constants ────────────────────────────────────────────────────────
// Change values here — never touch the logic below.

/**
 * Tier-1 phone detection: MediaPipe ObjectDetector (EfficientDet-Lite0, ~4 MB).
 * Increased confidence threshold and confirm frames to reduce false positives from lights.
 */
const PHONE_MODEL = {
  MIN_CONFIDENCE: 0.50,  // Increased from 0.35 to reduce false positives
  MIN_BBOX_AREA: 0.005,  // Slightly increased to ignore very small detections
  MAX_BBOX_AREA: 0.60,   // Decreased from 0.80 to ignore overly large detections
  MIN_ASPECT: 0.40,      // Increased from 0.20 - phones are typically taller than wide
  MAX_ASPECT: 2.50,      // Decreased from 4.00 - phones are typically taller than wide
  BORDER_MARGIN: 0.05,   // Increased from 0.02 to avoid edge detections
  IOU_THRESHOLD: 0.20,   // Increased from 0.10 for stricter temporal consistency
  // 2 frames × 3 s = ~6 s of continuous phone presence before first alert.
  CONFIRM_FRAMES: 2,     // Increased from 1 to require multiple consecutive detections
  ABSENCE_RESET_MS: 10_000, // Increased from 8_000 for more stable tracking
  ESCALATION_INTERVAL_MS: 60_000, // Increased from 45_000 to reduce alert frequency
  // Poll every 3 s for quicker response.
  POLL_MS: 3_000,
} as const;

/**
 * Tier-2 phone detection: brightness block analysis.
 * Runs when ObjectDetector model is not loaded. Added geometry validation
 * to reduce false positives from lights and bright rectangular objects.
 */
const BRIGHTNESS = {
  W: 240, H: 180,
  BLOCK: 20,
  ABS_THRESH: 195,  // Increased from 185 to be more selective about bright pixels
  REL_THRESH: 40,   // Increased from 35 to require brighter relative to surroundings
  MIN_BLOCKS: 2,    // Increased from 1 to require more connected bright pixels
  MAX_ASPECT_RATIO: 3.0, // Added: reject overly wide/tall rectangles (likely not phones)
  MIN_ASPECT_RATIO: 0.3, // Added: reject squares or tall thin shapes
  MIN_BLOCK_AREA: 15,  // Added: minimum pixels for a valid bright block
  MAX_BLOCK_AREA: 100, // Added: maximum pixels for a valid bright block
  // 3 frames × 3 s = 9 s continuous before alert (more conservative)
  CONFIRM_FRAMES: 3,   // Increased from 2 to require more consecutive detections
} as const;

/**
 * Gaze / head-pose tracking via BlazeFace keypoints.
 * Key changes:
 *   - EMA_ALPHA raised 0.55 → 0.70: reaches threshold in ~2 frames not ~4
 *   - THRESHOLD_ENTER lowered 0.60 → 0.50: moderate head turn now flagged
 *   - CALIBRATION_FRAMES reduced 3 → 2 and no longer requires high confidence
 *     (previous bug: calibration never completed under poor lighting)
 *   - Baseline no longer added to thresholds (was silently raising them by 0–0.05)
 */
const GAZE = {
  // 0.80: reacts to a turn within ~1 frame.
  EMA_ALPHA: 0.80,
  LOW_CONF_EMA: 0.40,
  MIN_KP_CONF: 0.35,
  // Calibrate in 1 frame (~3 s) so gaze detection activates almost immediately.
  CALIBRATION_FRAMES: 1,
  // 0.40: catches moderate head turns (was 0.50).
  THRESHOLD_ENTER: 0.40,
  // 0.24: wider hysteresis gap prevents rapid toggling.
  THRESHOLD_EXIT: 0.24,
  // 1 consecutive frame above threshold → alert (was 2 = 8 s).
  CONFIRM_FRAMES: 1,
  POLL_MS: 3_000,
} as const;

/** Face presence detection */
const FACE = {
  // 2 consecutive misses × 3 s = 6 s before face_missing alert (was 12 s).
  CONSECUTIVE_MISS: 2,
} as const;

// ─────────────────────────────────────────────────────────────────────────────

interface ProctoringAlert {
  type: string;
  severity: string;
  message: string;
}

interface ProctoringProps {
  videoRef: React.RefObject<HTMLVideoElement>;
  interviewId: string;
  enabled: boolean;
  onAlert: (alert: ProctoringAlert) => void;
  token?: string;
}

/** Normalized bounding box (values 0–1 relative to frame dimensions) */
interface BBox { x: number; y: number; w: number; h: number; }

/** Phone state machine */
interface PhoneState {
  phase: "absent" | "suspected" | "detected";
  consecutiveHits: number;
  lastBBox: BBox | null;
  detectedAt: number | null;
  lastAlertAt: number | null;
  lastSeenAt: number | null;
  escalationCount: number;
  usingModel: boolean;
}

/** Gaze tracking state */
interface GazeState {
  smoothed: number;
  isLookingAway: boolean;
  consecutive: number;
  baseline: number | null;
  calibSamples: number[];
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function iou(a: BBox, b: BBox): number {
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  if (inter === 0) return 0;
  return inter / (a.w * a.h + b.w * b.h - inter);
}

function ema(prev: number, next: number, alpha: number): number {
  return alpha * next + (1 - alpha) * prev;
}

function median(arr: number[]): number {
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ─────────────────────────────────────────────────────────────────────────────

async function sendProctoringEvent(
  interviewId: string, type: string, severity: string, message: string, token?: string,
) {
  try {
    const res = await fetch("/api/proctor-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ interviewId, type, severity, message, token }),
    });
    if (!res.ok)
      console.error(`[Proctoring] Failed ${type}: HTTP ${res.status}`, await res.text().catch(() => ""));
  } catch (err) {
    console.error(`[Proctoring] Send error ${type}:`, err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────

export default function Proctoring({ videoRef, interviewId, enabled, onAlert, token }: ProctoringProps) {
  const faceCanvasRef  = useRef<HTMLCanvasElement | null>(null);
  const photoCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const phoneCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const photoCountRef  = useRef(0);
  const lastAlertTimeRef = useRef<Record<string, number>>({});

  const nativeFaceRef = useRef<any>(null);
  const mpFaceRef     = useRef<any>(null);
  const mpObjectRef   = useRef<any>(null);
  const detFailedRef  = useRef(false);

  const phoneRef = useRef<PhoneState>({
    phase: "absent", consecutiveHits: 0, lastBBox: null,
    detectedAt: null, lastAlertAt: null, lastSeenAt: null,
    escalationCount: 0, usingModel: false,
  });

  const gazeRef = useRef<GazeState>({
    smoothed: 0, isLookingAway: false, consecutive: 0,
    baseline: null, calibSamples: [],
  });

  // ── captureViolationPhoto ─────────────────────────────────────────────────
  const captureViolationPhoto = useCallback((violationType = "violation", label?: string) => {
    const video = videoRef.current, canvas = photoCanvasRef.current;
    if (!video || !canvas || video.readyState < 2) return;
    canvas.width = 480; canvas.height = 360;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, 480, 360);
    const photoLabel = label || violationType.replace(/_/g, " ");
    canvas.toBlob((blob) => {
      if (!blob) return;
      const fd = new FormData();
      fd.append("interviewId", interviewId);
      fd.append("type", "violation_photo");
      fd.append("severity", "flag");
      fd.append("message", `[${photoLabel}] Photo captured`);
      fd.append("photo", blob, `${violationType}.webp`);
      if (token) fd.append("token", token);
      fetch("/api/proctor-event", { method: "POST", body: fd }).catch(() => {});
    }, "image/webp", 0.65);
  }, [videoRef, interviewId, token]);

  // ── alert() — unchanged cooldown contract ─────────────────────────────────
  const alert = useCallback((type: string, severity: string, message: string, forcePhoto = false) => {
    const now = Date.now();
    const cooldowns: Record<string, number> = {
      second_monitor: 300_000, multiple_faces: 15_000, face_missing: 20_000,
      looking_away: 15_000, devtools_open: 60_000, phone_detected: 20_000,
      fullscreen_exit: 15_000, window_blur: 8_000, virtual_camera: 300_000,
    };
    const cooldown = cooldowns[type] ?? 5_000;
    const last = lastAlertTimeRef.current[type] ?? 0;
    if (now - last < cooldown) {
      dbg(`alert() blocked by cooldown — type=${type} remaining=${Math.round((cooldown - (now - last)) / 1000)}s`);
      return;
    }
    lastAlertTimeRef.current[type] = now;
    onAlert({ type, severity, message });
    sendProctoringEvent(interviewId, type, severity, message, token);
    if (severity === "flag") {
      const alwaysPhoto = ["multiple_faces", "looking_away"];
      const lastPhoto = lastAlertTimeRef.current["_violation_photo"] ?? 0;
      if (forcePhoto || alwaysPhoto.includes(type) || now - lastPhoto > 30_000) {
        lastAlertTimeRef.current["_violation_photo"] = now;
        captureViolationPhoto(type, message);
      }
    }
  }, [onAlert, interviewId, token, captureViolationPhoto]);

  // ── Canvas init ───────────────────────────────────────────────────────────
  useEffect(() => {
    faceCanvasRef.current  = document.createElement("canvas");
    photoCanvasRef.current = document.createElement("canvas");
    phoneCanvasRef.current = document.createElement("canvas");
  }, []);

  // ── Fullscreen exit ── (unchanged) ────────────────────────────────────────
  useEffect(() => {
    if (!enabled) return;
    const h = () => { if (!document.fullscreenElement) alert("fullscreen_exit", "flag", "Candidate exited fullscreen mode"); };
    document.addEventListener("fullscreenchange", h);
    return () => document.removeEventListener("fullscreenchange", h);
  }, [enabled, alert]);

  // ── Window / tab focus loss ── (unchanged) ────────────────────────────────
  useEffect(() => {
    if (!enabled) return;
    let blurStart = 0, lastAlert = 0, shortBlurCount = 0, pollLostStart = 0;
    let shortBlurReset: NodeJS.Timeout | null = null;
    const fire = (dur: number) => {
      const now = Date.now();
      if (now - lastAlert < 10_000) return;
      lastAlert = now;
      alert("window_blur", "flag", dur > 15_000
        ? `Candidate left the interview window for ${Math.round(dur / 1000)}s`
        : "Candidate left the interview window briefly");
    };
    const onBlur  = () => { blurStart = Date.now(); };
    const onFocus = () => {
      if (!blurStart) return;
      const dur = Date.now() - blurStart; blurStart = 0;
      if (dur > 5_000) { fire(dur); } else {
        shortBlurCount++;
        if (shortBlurReset) clearTimeout(shortBlurReset);
        shortBlurReset = setTimeout(() => { shortBlurCount = 0; }, 60_000);
        if (shortBlurCount >= 3) { fire(dur); shortBlurCount = 0; }
      }
    };
    const onVis = () => {
      if (document.hidden) {
        blurStart = Date.now();
        const now = Date.now();
        if (now - lastAlert < 8_000) return;
        lastAlert = now;
        alert("window_blur", "flag", "Candidate switched tabs or left the interview window");
      } else if (blurStart) { blurStart = 0; }
    };
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);
    const poll = setInterval(() => {
      if (!document.hasFocus()) {
        if (!pollLostStart) pollLostStart = Date.now();
        else if (Date.now() - pollLostStart > 10_000) { fire(Date.now() - pollLostStart); pollLostStart = 0; }
      } else { pollLostStart = 0; }
    }, 5_000);
    return () => {
      window.removeEventListener("blur", onBlur); window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
      clearInterval(poll); if (shortBlurReset) clearTimeout(shortBlurReset);
    };
  }, [enabled, alert]);

  // ── Multiple screens ── (unchanged) ───────────────────────────────────────
  useEffect(() => {
    if (!enabled) return;
    const check = () => {
      if ("isExtended" in window.screen && (window.screen as any).isExtended) {
        alert("second_monitor", "flag", "Extended display detected — please use a single screen"); return;
      }
      if (window.screen.availWidth > window.screen.width * 1.5) {
        alert("second_monitor", "flag", "Multiple screens detected"); return;
      }
      try {
        const segs = (window.visualViewport as any)?.getWindowSegments?.();
        if (segs?.length > 1) alert("second_monitor", "flag", "Multiple display segments detected");
      } catch {}
    };
    check(); window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [enabled, alert]);

  // ── DevTools ── (unchanged) ───────────────────────────────────────────────
  useEffect(() => {
    if (!enabled) return;
    let open = false;
    const check = () => {
      const w = window.outerWidth - window.innerWidth > 160;
      const h = window.outerHeight - window.innerHeight > 200;
      if (w || h) { if (!open) { open = true; alert("devtools_open", "flag", "Developer tools detected — please close them"); } }
      else { open = false; }
    };
    const iv = setInterval(check, 5_000);
    const blockCtx  = (e: MouseEvent) => { e.preventDefault(); alert("devtools_open", "info", "Right-click disabled during interview"); };
    const blockKeys = (e: KeyboardEvent) => {
      if (e.key === "F12" || ((e.ctrlKey || e.metaKey) && e.shiftKey && ["I","J","C","i","j","c"].includes(e.key))) {
        e.preventDefault(); alert("devtools_open", "info", "Developer shortcuts blocked");
      }
    };
    document.addEventListener("contextmenu", blockCtx); document.addEventListener("keydown", blockKeys);
    return () => { clearInterval(iv); document.removeEventListener("contextmenu", blockCtx); document.removeEventListener("keydown", blockKeys); };
  }, [enabled, alert]);

  // ── Virtual camera ── (unchanged) ─────────────────────────────────────────
  useEffect(() => {
    if (!enabled) return;
    (async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const virtual = /obs|virtual|manycam|camtwist|snap.?camera|xsplit|streamlabs|fake|droidcam/i;
        for (const d of devices.filter(d => d.kind === "videoinput"))
          if (virtual.test(d.label)) { alert("virtual_camera", "flag", `Virtual camera detected: ${d.label}`); break; }
        const track = (videoRef.current?.srcObject as MediaStream)?.getVideoTracks()[0];
        if (track) {
          const fr = track.getSettings().frameRate;
          if (fr && (fr < 10 || fr > 120)) alert("virtual_camera", "flag", "Unusual camera frame rate detected");
        }
      } catch {}
    })();
  }, [enabled, videoRef, alert]);

  // ── Periodic baseline photo capture ── (unchanged) ────────────────────────
  useEffect(() => {
    if (!enabled) return;
    const snap = () => {
      const video = videoRef.current, canvas = photoCanvasRef.current;
      if (!video || !canvas || video.readyState < 2) return;
      canvas.width = 320; canvas.height = 240;
      const ctx = canvas.getContext("2d"); if (!ctx) return;
      ctx.drawImage(video, 0, 0, 320, 240);
      const n = ++photoCountRef.current;
      canvas.toBlob((blob) => {
        if (!blob) return;
        const fd = new FormData();
        fd.append("interviewId", interviewId); fd.append("type", "photo_capture");
        fd.append("severity", "info"); fd.append("message", `Photo #${n}`);
        fd.append("photo", blob, `photo_${n}.webp`);
        if (token) fd.append("token", token);
        fetch("/api/proctor-event", { method: "POST", body: fd }).catch(() => {});
      }, "image/webp", 0.5);
    };
    const t = setTimeout(snap, 30_000); const iv = setInterval(snap, 120_000);
    return () => { clearTimeout(t); clearInterval(iv); };
  }, [enabled, videoRef, interviewId, token]);

  // ── FACE + GAZE DETECTION ─────────────────────────────────────────────────
  //
  // Key fixes vs previous version:
  //   1. Calibration no longer requires high confidence — bug where poor lighting
  //      caused calibration to never complete, silencing ALL gaze alerts forever.
  //   2. EMA_ALPHA raised 0.55 → 0.70: threshold reached in ~2 frames, not ~4.
  //   3. THRESHOLD_ENTER lowered 0.60 → 0.50: moderate sustained head turn flagged.
  //   4. Baseline no longer added to thresholds: was silently raising the enter
  //      threshold by up to 0.14, making it nearly impossible to cross.
  //   5. Poll interval 6 s → 4 s: more responsive detection cadence.
  //   6. Debug logging added for every detection tick.
  //
  useEffect(() => {
    if (!enabled) return;

    // Reset gaze state on (re)start so calibration runs fresh
    gazeRef.current = { smoothed: 0, isLookingAway: false, consecutive: 0, baseline: null, calibSamples: [] };

    if ("FaceDetector" in window) {
      try {
        nativeFaceRef.current = new (window as any).FaceDetector({ maxDetectedFaces: 5, fastMode: true });
        console.log("[Proctoring] Chrome native FaceDetector available");
      } catch { nativeFaceRef.current = null; }
    }

    let cancelled = false;
    (async () => {
      try {
        const { FaceDetector, FilesetResolver } = await import("@mediapipe/tasks-vision");
        const wasm = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm");
        if (cancelled) return;
        for (const delegate of ["GPU", "CPU"] as const) {
          try {
            mpFaceRef.current = await FaceDetector.createFromOptions(wasm, {
              baseOptions: {
                modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite",
                delegate,
              },
              runningMode: "IMAGE",
              minDetectionConfidence: 0.40,
            });
            console.log(`[Proctoring] MediaPipe FaceDetector loaded (${delegate})`);
            break;
          } catch {}
        }
      } catch (err) { console.warn("[Proctoring] MediaPipe FaceDetector unavailable:", err); }
    })();

    let consecutiveMiss = 0;

    const detect = async () => {
      const video = videoRef.current;
      if (!video || video.readyState < 2 || video.videoWidth === 0) return;

      let count = -1;
      let detections: any[] = [];

      if (mpFaceRef.current) {
        try { const r = await mpFaceRef.current.detect(video); count = r.detections.length; detections = r.detections; } catch {}
      } else if (nativeFaceRef.current) {
        try { const r = await nativeFaceRef.current.detect(video); count = r.length; } catch {}
      }

      if (count === -1 && !detFailedRef.current) {
        detFailedRef.current = true;
        console.error("[Proctoring] No face detector available — face detection disabled");
        sendProctoringEvent(interviewId, "detection_unavailable", "info", "Face detection unavailable on this browser", token);
      }

      dbg(`face count=${count}`);

      if (count === 0) {
        consecutiveMiss++;
        gazeRef.current.consecutive = 0; gazeRef.current.isLookingAway = false;
        dbg(`face_missing consecutive=${consecutiveMiss}/${FACE.CONSECUTIVE_MISS}`);
        if (consecutiveMiss >= FACE.CONSECUTIVE_MISS) {
          alert("face_missing", "flag", "No face detected — please face the camera");
          consecutiveMiss = 0;
        }
        return;
      }

      if (count > 1) {
        consecutiveMiss = 0; gazeRef.current.consecutive = 0;
        alert("multiple_faces", "flag",
          count === 2 ? "Another person detected in frame" : `${count} persons detected in frame`);
        return;
      }

      // ── Single face — gaze analysis ──────────────────────────────────────
      consecutiveMiss = 0;
      const det  = detections[0];
      const kps  = det?.keypoints;
      const conf = det?.categories?.[0]?.score ?? 1.0;

      if (!kps || kps.length < 3) {
        // No keypoints available (native detector path) — decay without penalty
        gazeRef.current.consecutive = Math.max(0, gazeRef.current.consecutive - 1);
        dbg(`gaze: no keypoints (conf=${conf.toFixed(2)})`);
        return;
      }

      // BlazeFace kps: 0=right-eye, 1=left-eye, 2=nose-tip (all normalized 0–1)
      const rightEye = kps[0], leftEye = kps[1], nose = kps[2];
      const eyeMidX  = (rightEye.x + leftEye.x) / 2;
      const eyeSpan  = Math.abs(leftEye.x - rightEye.x);
      // Ratio: 0 = perfect frontal, grows as head turns sideways
      const rawGaze = eyeSpan > 0.01 ? Math.abs(nose.x - eyeMidX) / eyeSpan : 0;

      const gs = gazeRef.current;

      // ── Calibration phase ────────────────────────────────────────────────
      // BUG FIX: removed `if (conf >= MIN_KP_CONF)` guard here.
      // The old guard caused calibration to never complete under poor lighting,
      // silencing all gaze alerts for the entire interview session.
      if (gs.calibSamples.length < GAZE.CALIBRATION_FRAMES) {
        gs.calibSamples.push(rawGaze);
        dbg(`gaze calibration ${gs.calibSamples.length}/${GAZE.CALIBRATION_FRAMES} rawGaze=${rawGaze.toFixed(3)}`);
        if (gs.calibSamples.length === GAZE.CALIBRATION_FRAMES) {
          gs.baseline = median(gs.calibSamples);
          gs.smoothed = gs.baseline;
          console.log(`[Proctoring] Gaze baseline calibrated: ${gs.baseline.toFixed(3)}`);
        }
        return; // No alerts during calibration window
      }

      // ── EMA smoothing ────────────────────────────────────────────────────
      // Low-confidence frames (bad lighting) use stronger smoothing so they
      // cannot spike the EMA past the threshold on their own.
      const alpha = conf >= GAZE.MIN_KP_CONF ? GAZE.EMA_ALPHA : GAZE.LOW_CONF_EMA;
      gs.smoothed = ema(gs.smoothed, rawGaze, alpha);

      dbg(`gaze raw=${rawGaze.toFixed(3)} smoothed=${gs.smoothed.toFixed(3)} enter=${GAZE.THRESHOLD_ENTER} conf=${conf.toFixed(2)} consecutive=${gs.consecutive} lookingAway=${gs.isLookingAway}`);

      // ── Hysteresis state machine ──────────────────────────────────────────
      // ENTER: smoothed must exceed THRESHOLD_ENTER for CONFIRM_FRAMES consecutive ticks.
      // EXIT:  smoothed must drop below THRESHOLD_EXIT (gap of 0.18 prevents toggling).
      // No baseline is added to thresholds here — the EMA starting at baseline already
      // accounts for natural head pose. Adding it was silently raising the enter
      // threshold by 0–0.14, making detection fail for most candidates.
      if (!gs.isLookingAway) {
        if (gs.smoothed > GAZE.THRESHOLD_ENTER) {
          gs.consecutive++;
          dbg(`gaze above enter threshold — consecutive=${gs.consecutive}/${GAZE.CONFIRM_FRAMES}`);
          if (gs.consecutive >= GAZE.CONFIRM_FRAMES) {
            gs.isLookingAway = true; gs.consecutive = 0;
            console.log(`[Proctoring] looking_away fired — smoothed=${gs.smoothed.toFixed(3)}`);
            alert("looking_away", "flag", "Candidate looking away from screen");
          }
        } else {
          gs.consecutive = Math.max(0, gs.consecutive - 1);
        }
      } else {
        if (gs.smoothed <= GAZE.THRESHOLD_EXIT) {
          dbg(`gaze returned below exit threshold — clearing looking-away state`);
          gs.isLookingAway = false; gs.consecutive = 0;
        }
        // alert() cooldown (15 s) prevents spam while still in looking-away state
      }
    };

    const iv = setInterval(detect, GAZE.POLL_MS);
    return () => {
      cancelled = true; clearInterval(iv);
      if (mpFaceRef.current) { try { mpFaceRef.current.close(); } catch {} mpFaceRef.current = null; }
    };
  }, [enabled, videoRef, alert, interviewId, token]);

  // ── PHONE DETECTION ───────────────────────────────────────────────────────
  //
  // Architecture (unchanged):
  //   Tier 1 — MediaPipe ObjectDetector: semantic "cell phone" class
  //   Tier 2 — Brightness analysis: fallback when model unavailable
  //   Both feed the same state machine (persistence, IoU, escalation).
  //
  // State machine behavior:
  //   absent → suspected (first hit) → detected (CONFIRM_FRAMES hits → alert)
  //   detected → escalation alert every ESCALATION_INTERVAL_MS while visible
  //   any state → absent after ABSENCE_RESET_MS of no hits (enables re-entry)
  //
  // Key threshold changes vs previous:
  //   MIN_CONFIDENCE: 0.55 → 0.45    IOU_THRESHOLD: 0.25 → 0.15
  //   CONFIRM_FRAMES: 3 → 2          POLL_MS: 6 s → 4 s
  //   Brightness ABS_THRESH: 225→200  REL_THRESH: 60→45  MIN_BLOCKS: 3→2
  //   Geometry (aspect/area) check removed from brightness fallback
  //
  useEffect(() => {
    if (!enabled) return;

    phoneRef.current = {
      phase: "absent", consecutiveHits: 0, lastBBox: null,
      detectedAt: null, lastAlertAt: null, lastSeenAt: null,
      escalationCount: 0, usingModel: false,
    };

    let cancelled = false;

    // ── Load MediaPipe ObjectDetector (async) ─────────────────────────────
    (async () => {
      try {
        const { ObjectDetector, FilesetResolver } = await import("@mediapipe/tasks-vision");
        const wasm = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm");
        if (cancelled) return;
        for (const delegate of ["GPU", "CPU"] as const) {
          try {
            mpObjectRef.current = await ObjectDetector.createFromOptions(wasm, {
              baseOptions: {
                modelAssetPath: "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/latest/efficientdet_lite0.tflite",
                delegate,
              },
              runningMode: "IMAGE",
              scoreThreshold: PHONE_MODEL.MIN_CONFIDENCE,
              maxResults: 10,
            });
            phoneRef.current.usingModel = true;
            console.log(`[Proctoring] ObjectDetector loaded (${delegate}) — ML phone detection active`);
            break;
          } catch (e) { console.warn(`[Proctoring] ObjectDetector ${delegate} failed:`, e); }
        }
        if (!mpObjectRef.current) console.warn("[Proctoring] ObjectDetector unavailable — brightness fallback active");
      } catch (err) { console.warn("[Proctoring] ObjectDetector import failed:", err); }
    })();

    // ── Emit phone alert (initial or escalation) ──────────────────────────
    const emitPhoneAlert = (escalation: boolean) => {
      const ps = phoneRef.current, now = Date.now();
      if (!escalation) {
        ps.detectedAt = now; ps.lastAlertAt = now; ps.escalationCount = 1;
        console.log("[Proctoring] phone_detected — initial alert");
        alert("phone_detected", "flag", "Phone or mobile device detected", true);
      } else {
        ps.escalationCount++; ps.lastAlertAt = now;
        const elapsed = Math.round((now - (ps.detectedAt ?? now)) / 1000);
        const msg = `Phone still visible (${elapsed}s, alert #${ps.escalationCount})`;
        console.log(`[Proctoring] phone_detected escalation #${ps.escalationCount}`);
        onAlert({ type: "phone_detected", severity: "flag", message: msg });
        sendProctoringEvent(interviewId, "phone_detected", "flag", msg, token);
        captureViolationPhoto("phone_detected", msg);
        lastAlertTimeRef.current["phone_detected"] = now;
      }
    };

    // ── Tier 1: MediaPipe ObjectDetector ──────────────────────────────────
    const detectWithModel = (video: HTMLVideoElement): BBox | null => {
      if (!mpObjectRef.current) return null;
      try {
        const result = mpObjectRef.current.detect(video);
        if (!result?.detections) { dbg("phone model: no detections"); return null; }

        dbg(`phone model: ${result.detections.length} total detections`);
        for (const det of result.detections) {
          const cat = det.categories?.[0];
          if (!cat) continue;

          const name  = cat.categoryName?.toLowerCase() ?? "";
          const score = cat.score;
          dbg(`  object: "${name}" conf=${score.toFixed(3)}`);

          if (name !== "cell phone") { dbg(`  → skip: not cell phone`); continue; }
          if (score < PHONE_MODEL.MIN_CONFIDENCE) { dbg(`  → skip: conf ${score.toFixed(3)} < ${PHONE_MODEL.MIN_CONFIDENCE}`); continue; }

          const bb = det.boundingBox;
          if (!bb) { dbg("  → skip: no boundingBox"); continue; }

          const vw = video.videoWidth || 640, vh = video.videoHeight || 480;
          const bbox: BBox = { x: bb.originX / vw, y: bb.originY / vh, w: bb.width / vw, h: bb.height / vh };
          const area   = bbox.w * bbox.h;
          const cx     = bbox.x + bbox.w / 2, cy = bbox.y + bbox.h / 2;
          const aspect = bbox.w / (bbox.h || 0.001);

          if (area < PHONE_MODEL.MIN_BBOX_AREA) { dbg(`  → skip: area ${area.toFixed(4)} < ${PHONE_MODEL.MIN_BBOX_AREA}`); continue; }
          if (area > PHONE_MODEL.MAX_BBOX_AREA) { dbg(`  → skip: area ${area.toFixed(4)} > ${PHONE_MODEL.MAX_BBOX_AREA}`); continue; }
          if (cx < PHONE_MODEL.BORDER_MARGIN || cx > 1 - PHONE_MODEL.BORDER_MARGIN) { dbg(`  → skip: cx=${cx.toFixed(2)} in border zone`); continue; }
          if (cy < PHONE_MODEL.BORDER_MARGIN || cy > 1 - PHONE_MODEL.BORDER_MARGIN) { dbg(`  → skip: cy=${cy.toFixed(2)} in border zone`); continue; }
          if (aspect < PHONE_MODEL.MIN_ASPECT || aspect > PHONE_MODEL.MAX_ASPECT) { dbg(`  → skip: aspect ${aspect.toFixed(2)} out of [${PHONE_MODEL.MIN_ASPECT}, ${PHONE_MODEL.MAX_ASPECT}]`); continue; }

          dbg(`  ✓ ACCEPTED conf=${score.toFixed(3)} area=${area.toFixed(3)} aspect=${aspect.toFixed(2)}`);
          return bbox;
        }
        return null;
      } catch (e) { dbg("phone model error:", e); return null; }
    };

    // ── Tier 2: brightness block analysis ────────────────────────────────
    // Note: Added geometry validation to reduce false positives from lights.
    const detectWithBrightness = (): BBox | null => {
      const video = videoRef.current;
      if (!video) return null;

      // Create temporary canvas to capture frame
      const canvas = document.createElement('canvas');
      canvas.width = BRIGHTNESS.W;
      canvas.height = BRIGHTNESS.H;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;

      ctx.drawImage(video, 0, 0, BRIGHTNESS.W, BRIGHTNESS.H);
      const imageData = ctx.getImageData(0, 0, BRIGHTNESS.W, BRIGHTNESS.H);
      const data = imageData.data;

      // Find bright blocks
      const visited = new Array(BRIGHTNESS.W * BRIGHTNESS.H).fill(false);
      let bestBBox: BBox | null = null;
      let bestScore = 0;

      // Scan for bright pixel blocks
      for (let y = 0; y < BRIGHTNESS.H; y += BRIGHTNESS.BLOCK) {
        for (let x = 0; x < BRIGHTNESS.W; x += BRIGHTNESS.BLOCK) {
          let brightCount = 0;
          let totalPixels = 0;

          // Check this block
          for (let dy = 0; dy < BRIGHTNESS.BLOCK && y + dy < BRIGHTNESS.H; dy++) {
            for (let dx = 0; dx < BRIGHTNESS.BLOCK && x + dx < BRIGHTNESS.W; dx++) {
              const i = ((y + dy) * BRIGHTNESS.W + (x + dx)) * 4;
              const r = data[i];
              const g = data[i + 1];
              const b = data[i + 2];

              // Simple brightness calculation
              const brightness = (r + g + b) / 3;
              if (brightness > BRIGHTNESS.ABS_THRESH) {
                brightCount++;
              }
              totalPixels++;
            }
          }

          // Calculate ratio of bright pixels in this block
          const brightRatio = brightCount / totalPixels;

          // If enough bright pixels, analyze this block
          if (brightRatio > (BRIGHTNESS.REL_THRESH / 100)) {
            const blockX = x;
            const blockY = y;
            const blockW = Math.min(BRIGHTNESS.BLOCK, BRIGHTNESS.W - x);
            const blockH = Math.min(BRIGHTNESS.BLOCK, BRIGHTNESS.H - y);

            // Convert to normalized coordinates (0-1)
            const bbox: BBox = {
              x: blockX / BRIGHTNESS.W,
              y: blockY / BRIGHTNESS.H,
              w: blockW / BRIGHTNESS.W,
              h: blockH / BRIGHTNESS.H
            };

            // Calculate aspect ratio
            const aspectRatio = bbox.w / (bbox.h || 0.001);

            // Check if aspect ratio is within phone-like bounds
            if (aspectRatio >= BRIGHTNESS.MIN_ASPECT_RATIO &&
                aspectRatio <= BRIGHTNESS.MAX_ASPECT_RATIO &&
                blockW * blockH >= BRIGHTNESS.MIN_BLOCK_AREA &&
                blockW * blockH <= BRIGHTNESS.MAX_BLOCK_AREA) {

              // Simple scoring based on how "phone-like" the rectangle is
              // Ideal phone aspect ratio is around 0.5-0.6 (taller than wide)
              const idealAspect = 0.55;
              const aspectScore = 1.0 - Math.abs(aspectRatio - idealAspect) / idealAspect;
              const sizeScore = Math.min(1.0, (blockW * blockH) / 50.0); // Normalize by expected size
              const score = (aspectScore * 0.7) + (sizeScore * 0.3);

              if (score > bestScore) {
                bestScore = score;
                bestBBox = bbox;
              }
            }
          }
        }
      }

      // Only return if we found a reasonably good candidate
      return bestScore > 0.3 ? bestBBox : null;
    };

    // ── State machine ──────────────────────────────────────────────────────
    const updateStateMachine = (detBBox: BBox | null) => {
      const ps  = phoneRef.current, now = Date.now();
      const confirmFrames = ps.usingModel ? PHONE_MODEL.CONFIRM_FRAMES : BRIGHTNESS.CONFIRM_FRAMES;

      if (detBBox !== null) {
        ps.lastSeenAt = now;

        // IoU continuity: large position jump → object identity uncertain → partial regression
        let iouScore = 1;
        let iouConsistent = true;
        if (ps.lastBBox !== null && ps.phase !== "absent") {
          iouScore = iou(detBBox, ps.lastBBox);
          iouConsistent = iouScore >= PHONE_MODEL.IOU_THRESHOLD;
        }
        ps.lastBBox = detBBox;

        if (iouConsistent) {
          ps.consecutiveHits++;
        } else {
          ps.consecutiveHits = Math.max(1, Math.floor(ps.consecutiveHits / 2));
        }
        if (ps.phase === "absent") ps.phase = "suspected";

        dbg(`phone state=${ps.phase} hits=${ps.consecutiveHits}/${confirmFrames} iou=${iouScore.toFixed(2)} iouOk=${iouConsistent}`);

        if (ps.phase === "suspected" && ps.consecutiveHits >= confirmFrames) {
          ps.phase = "detected";
          emitPhoneAlert(false);
        } else if (ps.phase === "detected") {
          if (ps.lastAlertAt !== null && now - ps.lastAlertAt >= PHONE_MODEL.ESCALATION_INTERVAL_MS) {
            emitPhoneAlert(true);
          }
        }
      } else {
        // Negative frame — decay counter
        if (ps.consecutiveHits > 0) ps.consecutiveHits = Math.max(0, ps.consecutiveHits - 1);
        dbg(`phone miss — state=${ps.phase} hits=${ps.consecutiveHits}`);

        // Full reset after sustained absence → enables re-entry detection
        if (ps.phase !== "absent" && ps.lastSeenAt !== null) {
          if (now - ps.lastSeenAt >= PHONE_MODEL.ABSENCE_RESET_MS) {
            console.log("[Proctoring] Phone tracking reset — re-entry will trigger new alert");
            phoneRef.current = {
              phase: "absent", consecutiveHits: 0, lastBBox: null,
              detectedAt: null, lastAlertAt: null, lastSeenAt: ps.lastSeenAt,
              escalationCount: 0, usingModel: ps.usingModel,
            };
          }
        } else if (ps.phase === "absent") {
          ps.consecutiveHits = 0;
        }
      }
    };

    const analyze = () => {
      const video = videoRef.current;
      if (!video || video.readyState < 2 || video.videoWidth === 0) return;
      const bbox = mpObjectRef.current ? detectWithModel(video) : detectWithBrightness();
      updateStateMachine(bbox);
    };

    const iv = setInterval(analyze, PHONE_MODEL.POLL_MS);
    return () => {
      cancelled = true; clearInterval(iv);
      if (mpObjectRef.current) { try { mpObjectRef.current.close(); } catch {} mpObjectRef.current = null; }
    };
  }, [enabled, videoRef, alert, onAlert, interviewId, token, captureViolationPhoto]);

  return null;
}
