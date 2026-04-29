"use client";

import { useEffect, useRef, useCallback } from "react";

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

async function sendProctoringEvent(interviewId: string, type: string, severity: string, message: string, token?: string) {
  try {
    const res = await fetch("/api/proctor-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ interviewId, type, severity, message, token }),
    });
    if (!res.ok) {
      console.error(`[Proctoring] Failed to save event ${type}: HTTP ${res.status}`, await res.text().catch(() => ""));
    }
  } catch (err) {
    console.error(`[Proctoring] Failed to send event ${type}:`, err);
  }
}

export default function Proctoring({ videoRef, interviewId, enabled, onAlert, token }: ProctoringProps) {
  // faceLandmarkerRef removed — FaceLandmarker model no longer available on Google CDN
  const faceCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const photoCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const phoneCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastTabSwitchRef = useRef(0);
  const photoCountRef = useRef(0);
  const lastAlertTimeRef = useRef<Record<string, number>>({});

  const captureViolationPhoto = useCallback((violationType: string = "violation", label?: string) => {
    const video = videoRef.current;
    const canvas = photoCanvasRef.current;
    if (!video || !canvas || video.readyState < 2) return;
    canvas.width = 480;
    canvas.height = 360;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, 480, 360);
    const photoLabel = label || violationType.replace(/_/g, " ");
    canvas.toBlob((blob) => {
      if (!blob) return;
      const formData = new FormData();
      formData.append("interviewId", interviewId);
      formData.append("type", "violation_photo");
      formData.append("severity", "flag");
      formData.append("message", `[${photoLabel}] Photo captured`);
      formData.append("photo", blob, `${violationType}.webp`);
      if (token) formData.append("token", token);
      fetch("/api/proctor-event", { method: "POST", body: formData }).catch(() => {});
    }, "image/webp", 0.65);
  }, [videoRef, interviewId, token]);

  const alert = useCallback(
    (type: string, severity: string, message: string, forcePhoto = false) => {
      const now = Date.now();
      const cooldowns: Record<string, number> = {
        second_monitor: 300000,
        multiple_faces: 15000,
        face_missing: 20000,
        looking_away: 15000,
        devtools_open: 60000,
        phone_detected: 30000,
        fullscreen_exit: 15000,
        window_blur: 8000,
        virtual_camera: 300000,
      };
      const cooldown = cooldowns[type] || 5000;
      const lastTime = lastAlertTimeRef.current[type] || 0;
      if (now - lastTime < cooldown) return;
      lastAlertTimeRef.current[type] = now;

      onAlert({ type, severity, message });
      sendProctoringEvent(interviewId, type, severity, message, token);

      // Always capture photo for key violations; others max 1 per 30s
      if (severity === "flag") {
        const alwaysPhoto = ["multiple_faces", "looking_away"];
        const lastPhoto = lastAlertTimeRef.current["_violation_photo"] || 0;
        if (forcePhoto || alwaysPhoto.includes(type) || now - lastPhoto > 30000) {
          lastAlertTimeRef.current["_violation_photo"] = now;
          captureViolationPhoto(type, message);
        }
      }
    },
    [onAlert, interviewId, token, captureViolationPhoto]
  );

  useEffect(() => {
    faceCanvasRef.current = document.createElement("canvas");
    photoCanvasRef.current = document.createElement("canvas");
    phoneCanvasRef.current = document.createElement("canvas");
  }, []);

  // Tab switch detection is now handled by the combined window focus loss detector below

  // Fullscreen exit detection — fires alert, InterviewRoom handles the mandatory re-enter prompt
  useEffect(() => {
    if (!enabled) return;
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement) {
        alert("fullscreen_exit", "flag", "Candidate exited fullscreen mode");
      }
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, [enabled, alert]);

  // Window focus loss detection — only counts sustained loss (>2s) to avoid OS notification false positives
  useEffect(() => {
    if (!enabled) return;
    let blurStart = 0;
    let lastAlert = 0;
    let shortBlurCount = 0;
    let shortBlurResetTimer: NodeJS.Timeout | null = null;
    let pollLostStart = 0; // tracks sustained focus loss across polls

    const fireAlert = (duration: number) => {
      const now = Date.now();
      if (now - lastAlert < 10000) return; // 10s global debounce (was 5s)
      lastAlert = now;
      if (duration > 15000) {
        alert("window_blur", "flag", `Candidate left the interview window for ${Math.round(duration / 1000)}s`);
      } else {
        alert("window_blur", "flag", `Candidate left the interview window briefly`);
      }
    };

    const handleBlur = () => { blurStart = Date.now(); };
    const handleFocus = () => {
      if (!blurStart) return;
      const duration = Date.now() - blurStart;
      blurStart = 0;
      // Flag sustained loss >5s
      if (duration > 5000) {
        fireAlert(duration);
      } else {
        // Short blur — track frequency. 3+ short blurs in 60s = suspicious
        shortBlurCount++;
        if (shortBlurResetTimer) clearTimeout(shortBlurResetTimer);
        shortBlurResetTimer = setTimeout(() => { shortBlurCount = 0; }, 60000);
        if (shortBlurCount >= 3) {
          fireAlert(duration);
          shortBlurCount = 0;
        }
      }
    };

    // Visibility change for tab switches — fires immediately when tab hidden
    const handleVisibility = () => {
      if (document.hidden) {
        blurStart = Date.now();
        // Fire immediately — tab switching is always intentional
        const now = Date.now();
        if (now - lastAlert < 8000) return;
        lastAlert = now;
        alert("window_blur", "flag", "Candidate switched tabs or left the interview window");
      } else if (blurStart) {
        blurStart = 0;
      }
    };

    window.addEventListener("blur", handleBlur);
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);

    // Periodic focus poll — catches tab/window switches blur/visibility miss.
    // Now requires SUSTAINED loss (≥10s) before firing, not just one missed poll.
    const focusPoll = setInterval(() => {
      if (!document.hasFocus()) {
        if (!pollLostStart) {
          pollLostStart = Date.now();
        } else if (Date.now() - pollLostStart > 10000) {
          // 10s of sustained focus loss confirmed by polling
          fireAlert(Date.now() - pollLostStart);
          pollLostStart = 0;
        }
      } else {
        pollLostStart = 0;
      }
    }, 5000);

    return () => {
      window.removeEventListener("blur", handleBlur);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
      clearInterval(focusPoll);
      if (shortBlurResetTimer) clearTimeout(shortBlurResetTimer);
    };
  }, [enabled, alert]);

  // Copy/paste blocking REMOVED — candidates can now type messages in the
  // chat input and need to paste code/text. Keyboard shortcuts allowed.

  // Second monitor / extended display detection
  useEffect(() => {
    if (!enabled) return;
    const checkMultipleScreens = () => {
      // Method 1: screen.isExtended (Chrome 93+)
      if ('isExtended' in window.screen && (window.screen as any).isExtended) {
        alert("second_monitor", "flag", "Extended display detected — please use a single screen");
        return;
      }
      // Method 2: Compare available screen size with window screen size
      // If available width is much larger than screen width, likely multiple monitors
      if (window.screen.availWidth > window.screen.width * 1.5) {
        alert("second_monitor", "flag", "Multiple screens detected");
        return;
      }
      // Method 3: Window Segments API (newer browsers)
      if ('getWindowSegments' in window.visualViewport!) {
        try {
          const segments = (window.visualViewport as any).getWindowSegments();
          if (segments && segments.length > 1) {
            alert("second_monitor", "flag", "Multiple display segments detected");
          }
        } catch {}
      }
    };
    // Check on mount and on resize (monitors added/removed trigger resize)
    checkMultipleScreens();
    window.addEventListener("resize", checkMultipleScreens);
    return () => window.removeEventListener("resize", checkMultipleScreens);
  }, [enabled, alert]);

  // DevTools detection
  useEffect(() => {
    if (!enabled) return;
    let devtoolsOpen = false;

    const checkDevTools = () => {
      // Method 1: Window size difference — DevTools changes outerHeight/innerHeight ratio
      const widthThreshold = window.outerWidth - window.innerWidth > 160;
      const heightThreshold = window.outerHeight - window.innerHeight > 200;

      if (widthThreshold || heightThreshold) {
        if (!devtoolsOpen) {
          devtoolsOpen = true;
          alert("devtools_open", "flag", "Developer tools detected — please close them");
        }
      } else {
        devtoolsOpen = false;
      }
    };

    const interval = setInterval(checkDevTools, 5000);

    // Also block right-click context menu
    const blockContext = (e: MouseEvent) => {
      e.preventDefault();
      alert("devtools_open", "info", "Right-click disabled during interview");
    };
    document.addEventListener("contextmenu", blockContext);

    // Block F12 and Ctrl+Shift+I/J/C
    const blockShortcuts = (e: KeyboardEvent) => {
      if (e.key === "F12" ||
          ((e.ctrlKey || e.metaKey) && e.shiftKey && ["I","J","C","i","j","c"].includes(e.key))) {
        e.preventDefault();
        alert("devtools_open", "info", "Developer shortcuts blocked");
      }
    };
    document.addEventListener("keydown", blockShortcuts);

    return () => {
      clearInterval(interval);
      document.removeEventListener("contextmenu", blockContext);
      document.removeEventListener("keydown", blockShortcuts);
    };
  }, [enabled, alert]);

  // Face detection using MediaPipe FaceDetector (BlazeFace)
  // Works on ALL browsers — detects face count + bounding box position
  // Chrome native FaceDetector used as immediate fallback while MediaPipe loads
  const nativeFaceDetectorRef = useRef<any>(null);
  const mediaPipeDetectorRef = useRef<any>(null);
  const detectionFailedRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    // Chrome native FaceDetector (instant, no download)
    if ("FaceDetector" in window) {
      try {
        nativeFaceDetectorRef.current = new (window as any).FaceDetector({ maxDetectedFaces: 5, fastMode: true });
        console.log("[Proctoring] Chrome FaceDetector available");
      } catch { nativeFaceDetectorRef.current = null; }
    }

    // MediaPipe FaceDetector for all browsers (1MB model, works everywhere)
    let cancelled = false;
    (async () => {
      try {
        const vision = await import("@mediapipe/tasks-vision");
        const { FaceDetector, FilesetResolver } = vision;
        const filesetResolver = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm"
        );
        if (cancelled) return;
        // Try GPU first, then CPU
        let loaded = false;
        for (const delegate of ["GPU", "CPU"] as const) {
          try {
            mediaPipeDetectorRef.current = await FaceDetector.createFromOptions(filesetResolver, {
              baseOptions: {
                modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite",
                delegate,
              },
              runningMode: "IMAGE",
              minDetectionConfidence: 0.5,
            });
            console.log(`[Proctoring] MediaPipe FaceDetector loaded (${delegate})`);
            loaded = true;
            break;
          } catch (e) {
            console.warn(`[Proctoring] MediaPipe ${delegate} failed:`, e);
          }
        }
        if (!loaded) console.error("[Proctoring] MediaPipe FaceDetector unavailable");
      } catch (err) {
        console.warn("[Proctoring] MediaPipe FaceDetector failed:", err);
      }
    })();

    // Require CONSECUTIVE misses before alerting — single frame with bad lighting shouldn't count
    let consecutiveFaceMissing = 0;
    let consecutiveLookAway = 0;

    const detect = async () => {
      const video = videoRef.current;
      if (!video || video.readyState < 2 || video.videoWidth === 0) return;

      let faceCount = -1;
      let detections: any[] = [];

      // Try MediaPipe first (gives keypoints for gaze), then Chrome native
      if (mediaPipeDetectorRef.current) {
        try {
          const result = await mediaPipeDetectorRef.current.detect(video);
          faceCount = result.detections.length;
          detections = result.detections;
        } catch {}
      } else if (nativeFaceDetectorRef.current) {
        try {
          const faces = await nativeFaceDetectorRef.current.detect(video);
          faceCount = faces.length;
        } catch {}
      }

      if (faceCount === -1 && !detectionFailedRef.current) {
        detectionFailedRef.current = true;
        console.error("[Proctoring] No face detector available — face detection disabled");
        sendProctoringEvent(interviewId, "detection_unavailable", "info", "Face detection unavailable on this browser", token);
      }

      if (faceCount === 0) {
        consecutiveFaceMissing++;
        consecutiveLookAway = 0;
        // Only alert after 3 consecutive misses (~18s) — handles bad lighting, sneezing, leaning
        if (consecutiveFaceMissing >= 3) {
          alert("face_missing", "flag", "No face detected — please face the camera");
          consecutiveFaceMissing = 0;
        }
      } else if (faceCount > 1) {
        consecutiveFaceMissing = 0;
        consecutiveLookAway = 0;
        // Fire immediately — another person is a strong integrity signal
        const label = faceCount === 2
          ? "Another person detected in frame"
          : `${faceCount} persons detected in frame`;
        alert("multiple_faces", "flag", label);
      } else {
        // Exactly one face — check if candidate is looking away using keypoints
        consecutiveFaceMissing = 0;

        const kps = detections[0]?.keypoints;
        if (kps && kps.length >= 3) {
          // BlazeFace keypoints: 0=right eye, 1=left eye, 2=nose tip
          const rightEye = kps[0];
          const leftEye  = kps[1];
          const nose     = kps[2];

          const eyeMidX     = (rightEye.x + leftEye.x) / 2;
          const eyeSpan     = Math.abs(leftEye.x - rightEye.x);
          const noseOffsetX = Math.abs(nose.x - eyeMidX);
          // Ratio > 0.62 → head turned significantly sideways
          const gaze = eyeSpan > 0.01 ? noseOffsetX / eyeSpan : 0;

          if (gaze > 0.62) {
            consecutiveLookAway++;
            // 2 consecutive detections (~12s) before firing to avoid false positives
            if (consecutiveLookAway >= 2) {
              alert("looking_away", "flag", "Candidate looking away from screen");
              consecutiveLookAway = 0;
            }
          } else {
            consecutiveLookAway = 0;
          }
        } else {
          consecutiveLookAway = 0;
        }
      }
    };

    const interval = setInterval(detect, 6000); // 6s interval (was 4s) — less CPU, fewer false positives
    return () => {
      cancelled = true;
      clearInterval(interval);
      // Clean up MediaPipe GPU resources
      if (mediaPipeDetectorRef.current) {
        try { mediaPipeDetectorRef.current.close(); } catch {}
        mediaPipeDetectorRef.current = null;
      }
    };
  }, [enabled, videoRef, alert]);

  // Virtual camera detection
  useEffect(() => {
    if (!enabled) return;
    (async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoInputs = devices.filter(d => d.kind === "videoinput");
        const virtualPatterns = /obs|virtual|manycam|camtwist|snap.?camera|xsplit|streamlabs|fake|droidcam/i;
        for (const device of videoInputs) {
          if (virtualPatterns.test(device.label)) {
            alert("virtual_camera", "flag", `Virtual camera detected: ${device.label}`);
            break;
          }
        }
        // Also check active video track settings
        const video = videoRef.current;
        if (video?.srcObject) {
          const track = (video.srcObject as MediaStream).getVideoTracks()[0];
          if (track) {
            const settings = track.getSettings();
            // Virtual cameras often report 0 for deviceId or unusual frameRate
            if (settings.frameRate && (settings.frameRate < 10 || settings.frameRate > 120)) {
              alert("virtual_camera", "flag", "Unusual camera frame rate detected");
            }
          }
        }
      } catch {}
    })();
  }, [enabled, videoRef, alert]);

  // Periodic photo capture — first at 30s, then every 2 min. WebP + binary upload for minimal size.
  useEffect(() => {
    if (!enabled) return;
    const capture = () => {
      const video = videoRef.current;
      const canvas = photoCanvasRef.current;
      if (!video || !canvas || video.readyState < 2) return;
      canvas.width = 320;
      canvas.height = 240;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, 320, 240);
      photoCountRef.current++;
      const count = photoCountRef.current;
      // WebP binary upload — decent quality for review
      canvas.toBlob((blob) => {
        if (!blob) return;
        const formData = new FormData();
        formData.append("interviewId", interviewId);
        formData.append("type", "photo_capture");
        formData.append("severity", "info");
        formData.append("message", `Photo #${count}`);
        formData.append("photo", blob, `photo_${count}.webp`);
        if (token) formData.append("token", token);
        fetch("/api/proctor-event", { method: "POST", body: formData }).catch(() => {});
      }, "image/webp", 0.5);
    };
    const first = setTimeout(capture, 30000);
    const interval = setInterval(capture, 120000);
    return () => { clearTimeout(first); clearInterval(interval); };
  }, [enabled, videoRef, interviewId]);

  // Phone detection — grid-based bright region analysis with shape + contrast validation
  // Replaces naive corner-pixel brightness check that caused false positives from lamps/windows.
  useEffect(() => {
    if (!enabled) return;

    // ── Tunable config ────────────────────────────────────────────────────────
    const GRID_COLS = 16;
    const GRID_ROWS = 12;
    const TOTAL_CELLS = GRID_COLS * GRID_ROWS;
    const BRIGHTNESS_THRESH = 215;   // per-cell avg brightness to count as bright (0-255)
    const MIN_REGION_RATIO = 0.04;   // phone region must be ≥4% of frame cells
    const MAX_REGION_RATIO = 0.38;   // phone region must be ≤38% (large = background light)
    const ASPECT_MIN = 0.28;         // min bbox w/h (very landscape phone)
    const ASPECT_MAX = 3.6;          // max bbox w/h (very portrait phone)
    const FILL_MIN = 0.55;           // ≥55% of bbox cells must be bright (solid rectangle)
    const CONTRAST_MIN = 1.4;        // region must be 40% brighter than surroundings
    const CONFIDENCE_THRESH = 0.72;  // overall confidence gate (0–1)
    const CONSECUTIVE_REQUIRED = 4;  // must pass in 4 consecutive intervals (~8s)
    const INTERVAL_MS = 2000;        // detection interval
    // ─────────────────────────────────────────────────────────────────────────

    let consecutiveSuspicious = 0;

    const analyze = () => {
      const video = videoRef.current;
      const canvas = phoneCanvasRef.current;
      if (!video || !canvas || video.readyState < 2 || video.videoWidth === 0) return;

      const W = 160, H = 120;
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, W, H);
      const data = ctx.getImageData(0, 0, W, H).data;

      // Build per-cell average brightness grid
      const cellW = W / GRID_COLS;
      const cellH = H / GRID_ROWS;
      const cellBrightness = new Float32Array(TOTAL_CELLS);
      const brightCell = new Uint8Array(TOTAL_CELLS);

      for (let gr = 0; gr < GRID_ROWS; gr++) {
        for (let gc = 0; gc < GRID_COLS; gc++) {
          let sum = 0, count = 0;
          const x0 = Math.floor(gc * cellW), y0 = Math.floor(gr * cellH);
          const x1 = Math.floor((gc + 1) * cellW), y1 = Math.floor((gr + 1) * cellH);
          for (let y = y0; y < y1; y++) {
            for (let x = x0; x < x1; x++) {
              const i = (y * W + x) * 4;
              sum += (data[i] + data[i + 1] + data[i + 2]) / 3;
              count++;
            }
          }
          const avg = count > 0 ? sum / count : 0;
          const ci = gr * GRID_COLS + gc;
          cellBrightness[ci] = avg;
          brightCell[ci] = avg > BRIGHTNESS_THRESH ? 1 : 0;
        }
      }

      // BFS — find largest connected component of bright cells
      const visited = new Uint8Array(TOTAL_CELLS);
      let largestSize = 0;
      let largestCells: number[] = [];

      for (let start = 0; start < TOTAL_CELLS; start++) {
        if (!brightCell[start] || visited[start]) continue;
        const component: number[] = [];
        const queue: number[] = [start];
        visited[start] = 1;
        let qi = 0;
        while (qi < queue.length) {
          const curr = queue[qi++];
          component.push(curr);
          const r = Math.floor(curr / GRID_COLS);
          const c = curr % GRID_COLS;
          if (r > 0 && brightCell[curr - GRID_COLS] && !visited[curr - GRID_COLS]) { visited[curr - GRID_COLS] = 1; queue.push(curr - GRID_COLS); }
          if (r < GRID_ROWS - 1 && brightCell[curr + GRID_COLS] && !visited[curr + GRID_COLS]) { visited[curr + GRID_COLS] = 1; queue.push(curr + GRID_COLS); }
          if (c > 0 && brightCell[curr - 1] && !visited[curr - 1]) { visited[curr - 1] = 1; queue.push(curr - 1); }
          if (c < GRID_COLS - 1 && brightCell[curr + 1] && !visited[curr + 1]) { visited[curr + 1] = 1; queue.push(curr + 1); }
        }
        if (component.length > largestSize) { largestSize = component.length; largestCells = component; }
      }

      // Gate 1 — size filter
      const sizeRatio = largestSize / TOTAL_CELLS;
      if (sizeRatio < MIN_REGION_RATIO || sizeRatio > MAX_REGION_RATIO) {
        consecutiveSuspicious = Math.max(0, consecutiveSuspicious - 1);
        return;
      }

      // Gate 2 — bounding box aspect ratio (phone-like shape)
      const compSet = new Set(largestCells);
      let minR = GRID_ROWS, maxR = 0, minC = GRID_COLS, maxC = 0;
      for (const idx of largestCells) {
        const r = Math.floor(idx / GRID_COLS);
        const c = idx % GRID_COLS;
        if (r < minR) minR = r; if (r > maxR) maxR = r;
        if (c < minC) minC = c; if (c > maxC) maxC = c;
      }
      const bboxH = maxR - minR + 1;
      const bboxW = maxC - minC + 1;
      const aspect = bboxW / Math.max(bboxH, 1);
      const aspectOk = aspect >= ASPECT_MIN && aspect <= ASPECT_MAX;

      // Gate 3 — fill ratio (real phone screen = solid rectangle, not scattered noise)
      const bboxCells = bboxH * bboxW;
      const fillRatio = largestSize / Math.max(bboxCells, 1);
      const fillOk = fillRatio >= FILL_MIN;

      // Gate 4 — contrast: region must be significantly brighter than rest of frame
      let regionSum = 0;
      for (const idx of largestCells) regionSum += cellBrightness[idx];
      const regionAvg = regionSum / largestSize;

      let surroundSum = 0, surroundCount = 0;
      for (let i = 0; i < TOTAL_CELLS; i++) {
        if (!compSet.has(i)) { surroundSum += cellBrightness[i]; surroundCount++; }
      }
      const surroundAvg = surroundCount > 0 ? surroundSum / surroundCount : 1;
      const contrastRatio = regionAvg / Math.max(surroundAvg, 1);
      const contrastOk = contrastRatio >= CONTRAST_MIN;

      // Composite confidence score
      let confidence = 0;
      if (aspectOk) confidence += 0.30;
      if (fillOk) confidence += 0.25;
      if (contrastOk) confidence += 0.30;
      if (sizeRatio >= 0.06 && sizeRatio <= 0.25) confidence += 0.15; // ideal phone size

      // Debug log — helps tune thresholds
      console.debug(
        `[Proctoring:phone] size=${(sizeRatio * 100).toFixed(1)}% aspect=${aspect.toFixed(2)} ` +
        `fill=${(fillRatio * 100).toFixed(1)}% contrast=${contrastRatio.toFixed(2)} ` +
        `confidence=${confidence.toFixed(2)} consecutive=${consecutiveSuspicious}`
      );

      if (confidence >= CONFIDENCE_THRESH) {
        consecutiveSuspicious++;
        if (consecutiveSuspicious >= CONSECUTIVE_REQUIRED) {
          alert("phone_detected", "flag", "Possible phone detected — please keep devices away");
          consecutiveSuspicious = 0;
        }
      } else {
        consecutiveSuspicious = Math.max(0, consecutiveSuspicious - 1);
      }
    };

    const interval = setInterval(analyze, INTERVAL_MS);
    return () => clearInterval(interval);
  }, [enabled, videoRef, alert]);

  return null;
}
