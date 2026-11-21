import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, Camera, Sparkles, Upload } from 'lucide-react';
import { getPreferredWebcamStream } from '../../lib/camera';

interface FaceAlignmentProps {
  onCapture: (imageUrl: string) => void;
  onCancel: () => void;
}

const MIN_CAPTURE_WIDTH = 480;
const MIN_CAPTURE_HEIGHT = 360;
const COUNTDOWN_SECONDS = 3;

export function FaceAlignment({ onCapture, onCancel }: FaceAlignmentProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const analyzeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const capturedRef = useRef(false);

  const [camReady, setCamReady] = useState<boolean>(false);
  const [camError, setCamError] = useState<string | null>(null);
  const [isCapturingState, setIsCapturingState] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      if (dataUrl) {
        streamRef.current?.getTracks().forEach(t => t.stop());
        streamRef.current = null;
        onCapture(dataUrl);
      }
    };
    reader.readAsDataURL(file);
  };

  // Alignment state (simplified — internal checks still run)
  const [isAligned, setIsAligned] = useState<boolean>(false);
  const [guidanceMsg, setGuidanceMsg] = useState<string>('Connecting to camera…');

  // Countdown state
  const [countdown, setCountdown] = useState<number | null>(null);
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownValueRef = useRef<number>(0);

  // Previous frame luminance for motion analysis
  const prevLuminanceRef = useRef<number | null>(null);

  // ── Camera setup ─────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function startCamera() {
      try {
        const { stream: mediaStream } = await getPreferredWebcamStream({
          width: { ideal: 1280 },
          height: { ideal: 720 },
        });

        if (cancelled) {
          mediaStream.getTracks().forEach(t => t.stop());
          return;
        }

        streamRef.current = mediaStream;
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
        }
      } catch (err) {
        if (!cancelled) {
          console.error('[FaceAlignment] Camera error:', err);
          setCamError('Camera access denied or unavailable. Please allow camera access and try again.');
        }
      }
    }

    startCamera();

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    };
  }, []);

  const handleVideoCanPlay = useCallback(() => {
    setCamReady(true);
  }, []);

  // ── Snapshot capture logic ────────────────────────────────────────────────
  const captureSnapshot = useCallback(() => {
    if (capturedRef.current) return;
    capturedRef.current = true;
    setIsCapturingState(true);

    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (!video || !canvas) {
      onCancel();
      return;
    }

    const vw = video.videoWidth;
    const vh = video.videoHeight;

    if (vw < MIN_CAPTURE_WIDTH || vh < MIN_CAPTURE_HEIGHT) {
      console.warn('[FaceAlignment] Video not ready yet, retrying in 300ms…');
      capturedRef.current = false;
      setTimeout(captureSnapshot, 300);
      return;
    }

    const maxDim = 1280;
    let targetW = vw;
    let targetH = vh;
    if (vw > maxDim || vh > maxDim) {
      if (vw > vh) {
        targetW = maxDim;
        targetH = Math.round((vh / vw) * maxDim);
      } else {
        targetH = maxDim;
        targetW = Math.round((vw / vh) * maxDim);
      }
    }

    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(video, 0, 0, targetW, targetH);
    }

    const imageUrl = canvas.toDataURL('image/jpeg', 0.92);

    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;

    onCapture(imageUrl);
  }, [onCapture, onCancel]);

  // ── Cancel countdown ─────────────────────────────────────────────────────
  const cancelCountdown = useCallback(() => {
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    countdownValueRef.current = 0;
    setCountdown(null);
  }, []);

  // ── Start countdown ──────────────────────────────────────────────────────
  const startCountdown = useCallback(() => {
    if (countdownTimerRef.current || capturedRef.current) return;

    countdownValueRef.current = COUNTDOWN_SECONDS;
    setCountdown(COUNTDOWN_SECONDS);

    countdownTimerRef.current = setInterval(() => {
      countdownValueRef.current -= 1;
      setCountdown(countdownValueRef.current);

      if (countdownValueRef.current <= 0) {
        if (countdownTimerRef.current) {
          clearInterval(countdownTimerRef.current);
          countdownTimerRef.current = null;
        }
        // Auto-capture
        captureSnapshot();
      }
    }, 1000);
  }, [captureSnapshot]);

  // ── Real-time Video Analysis Loop ────────────────────────────────────────
  useEffect(() => {
    if (!camReady || capturedRef.current) return;

    if (!analyzeCanvasRef.current) {
      analyzeCanvasRef.current = document.createElement('canvas');
      analyzeCanvasRef.current.width = 160;
      analyzeCanvasRef.current.height = 120;
    }

    const analyzeCanvas = analyzeCanvasRef.current;
    const ctx = analyzeCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    const intervalId = setInterval(() => {
      const video = videoRef.current;
      if (!video || video.paused || video.ended || capturedRef.current) return;

      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (vw < 100 || vh < 100) return;

      ctx.drawImage(video, 0, 0, 160, 120);
      const frameData = ctx.getImageData(0, 0, 160, 120);
      const data = frameData.data;

      // Sample pixels within central face oval
      let totalLuminance = 0;
      let count = 0;
      let leftLum = 0, leftCount = 0;
      let rightLum = 0, rightCount = 0;
      let lumValues: number[] = [];

      for (let y = 20; y < 100; y += 2) {
        for (let x = 40; x < 120; x += 2) {
          const idx = (y * 160 + x) * 4;
          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];
          const lum = 0.299 * r + 0.587 * g + 0.114 * b;

          totalLuminance += lum;
          count++;
          lumValues.push(lum);

          if (x < 80) {
            leftLum += lum;
            leftCount++;
          } else {
            rightLum += lum;
            rightCount++;
          }
        }
      }

      if (count === 0) return;
      const avgLum = totalLuminance / count;

      const sumDiffSq = lumValues.reduce((acc, v) => acc + Math.pow(v - avgLum, 2), 0);
      const stdDev = Math.sqrt(sumDiffSq / count);

      // 1. Lighting Check (70 - 225 luminance range)
      const lightGood = avgLum >= 70 && avgLum <= 225;

      // 2. Alignment & Centering Check
      const avgLeft = leftCount > 0 ? leftLum / leftCount : 0;
      const avgRight = rightCount > 0 ? rightLum / rightCount : 0;
      const lrRatio = Math.max(avgLeft, avgRight) > 0 ? Math.min(avgLeft, avgRight) / Math.max(avgLeft, avgRight) : 0;
      const alignGood = stdDev >= 12 && lrRatio >= 0.48;

      // 3. Motion & Stability Check
      let stableGood = true;
      if (prevLuminanceRef.current !== null) {
        const motionDelta = Math.abs(avgLum - prevLuminanceRef.current);
        if (motionDelta > 15) stableGood = false;
      }
      prevLuminanceRef.current = avgLum;

      // 4. Unobstructed & Clarity Check
      const unobstructedGood = stdDev >= 15 && stdDev <= 65;

      const allGood = lightGood && alignGood && stableGood && unobstructedGood;
      setIsAligned(allGood);

      // Set guidance message
      if (!alignGood) {
        setGuidanceMsg(stdDev < 12 ? 'Position your face inside the frame' : 'Center your face in the guide');
      } else if (!lightGood) {
        setGuidanceMsg(avgLum < 70 ? 'Move to brighter lighting' : 'Reduce harsh glare');
      } else if (!stableGood) {
        setGuidanceMsg('Hold still for accurate scan');
      } else if (!unobstructedGood) {
        setGuidanceMsg('Ensure face is clear & unobstructed');
      } else {
        setGuidanceMsg('Face aligned — hold steady');
      }

      // Countdown logic: start when aligned, cancel when not
      if (allGood && !countdownTimerRef.current && !capturedRef.current) {
        startCountdown();
      } else if (!allGood && countdownTimerRef.current) {
        cancelCountdown();
      }
    }, 120);

    return () => {
      clearInterval(intervalId);
      cancelCountdown();
    };
  }, [camReady, startCountdown, cancelCountdown]);

  const handleCancel = useCallback(() => {
    cancelCountdown();
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    onCancel();
  }, [onCancel, cancelCountdown]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 bg-background flex flex-col items-center justify-center z-50 overflow-hidden"
    >
      {/* Header */}
      <div className="absolute top-8 left-8 right-8 flex justify-between items-center z-10">
        <button
          onClick={handleCancel}
          className="flex items-center gap-2 text-on-surface-variant hover:text-white transition-colors"
        >
          <ArrowLeft size={20} />
          <span className="font-semibold text-lg">Cancel</span>
        </button>
        <span className="font-bold text-lg glow-text tracking-wide">Orion Smart Mirror</span>
      </div>

      {/* Title */}
      <div className="text-center mb-4 relative z-10 mt-10 px-4">
        <h2 className="text-3xl font-extrabold mb-2 text-white drop-shadow-lg flex items-center justify-center gap-2">
          <Sparkles className="text-primary animate-pulse" size={24} />
          Analyzing Your Skin
        </h2>
        <p className="text-sm font-medium text-on-surface-variant max-w-md mx-auto">
          {camError
            ? camError
            : camReady
            ? guidanceMsg
            : 'Connecting to camera…'}
        </p>
      </div>

      {/* Oval Viewfinder Container */}
      <div className="relative w-full max-w-xs md:max-w-sm aspect-[3/4] flex items-center justify-center">
        {/* Glow ambient background — uses accent color */}
        <div
          className={`absolute inset-0 blur-[90px] rounded-[50%] transition-colors duration-500 ${
            isAligned
              ? 'bg-primary/50'
              : 'bg-primary/20'
          }`}
        />

        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.5 }}
          className={`w-full h-full rounded-[45%] border-2 relative flex items-center justify-center overflow-hidden transition-all duration-300 ${
            isAligned
              ? 'border-primary shadow-[0_0_40px_var(--color-accent-glow,rgba(56,189,248,0.6))]'
              : 'border-white/30 shadow-[0_0_20px_rgba(255,255,255,0.15)]'
          }`}
        >
          {/* Hidden capture canvas */}
          <canvas ref={canvasRef} className="hidden" />

          {/* Live camera feed */}
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            onCanPlay={handleVideoCanPlay}
            className="w-full h-full object-cover scale-x-[-1]"
          />

          {/* Camera Error overlay */}
          {camError && (
            <div className="absolute inset-0 flex items-center justify-center text-center p-6 bg-surface-container/90">
              <p className="text-sm text-red-300 font-semibold">{camError}</p>
            </div>
          )}

          {/* Countdown Overlay */}
          <AnimatePresence>
            {countdown !== null && countdown > 0 && (
              <motion.div
                key={countdown}
                initial={{ scale: 1.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.5, opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="absolute inset-0 flex items-center justify-center pointer-events-none z-20"
              >
                <span className="text-8xl font-black text-primary drop-shadow-[0_0_30px_var(--color-accent-glow,rgba(56,189,248,0.8))]">
                  {countdown}
                </span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Capture Flash Effect */}
          {isCapturingState && (
            <motion.div
              initial={{ opacity: 0.9 }}
              animate={{ opacity: 0 }}
              transition={{ duration: 0.4 }}
              className="absolute inset-0 bg-white pointer-events-none z-30"
            />
          )}

          {/* Face Structural Guide Overlay Lines */}
          <div className="absolute top-[30%] w-full h-[1px] bg-white/20 shadow-[0_0_8px_rgba(255,255,255,0.4)] pointer-events-none" />
          <div className="absolute top-[50%] w-full h-[1px] bg-white/20 shadow-[0_0_8px_rgba(255,255,255,0.4)] pointer-events-none" />
          <div className="absolute top-[70%] w-full h-[1px] bg-white/20 shadow-[0_0_8px_rgba(255,255,255,0.4)] pointer-events-none" />
        </motion.div>
      </div>

      {/* Bottom Capture Button & Status */}
      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.2 }}
        className="mt-6 flex flex-col items-center gap-3 z-10 px-4"
      >
        {/* Status indicator */}
        <p className={`text-sm font-semibold transition-colors ${isAligned ? 'text-primary' : 'text-on-surface-variant'}`}>
          {countdown !== null && countdown > 0
            ? `Capturing in ${countdown}…`
            : isAligned
            ? 'Ready — capturing shortly'
            : guidanceMsg}
        </p>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center justify-center gap-3">
          <button
            disabled={!camReady || !!camError || isCapturingState}
            onClick={captureSnapshot}
            className={`px-10 py-3.5 rounded-full cursor-pointer transition-all shadow-lg flex items-center gap-2.5 font-bold text-sm ${
              isAligned
                ? 'bg-primary text-on-primary hover:opacity-90 active:scale-95 shadow-[0_0_25px_var(--color-accent-glow,rgba(56,189,248,0.5))]'
                : 'bg-white/10 text-white border border-white/20 hover:bg-white/15 active:scale-95'
            } disabled:opacity-40 disabled:cursor-not-allowed`}
          >
            <Camera size={18} />
            Capture &amp; Analyze
          </button>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="px-6 py-3.5 rounded-full cursor-pointer transition-all bg-white/10 text-white border border-white/20 hover:bg-white/15 active:scale-95 text-sm font-semibold flex items-center gap-2 shadow-lg"
          >
            <Upload size={16} />
            Upload Photo Instead
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileChange}
          />
        </div>
      </motion.div>
    </motion.div>
  );
}
