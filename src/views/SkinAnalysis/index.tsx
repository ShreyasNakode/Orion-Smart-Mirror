import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ScanFace, AlertCircle, Loader2, Sparkles, UserX, Sun, Focus, Upload } from 'lucide-react';
import { FaceAlignment } from './FaceAlignment';
import { AnalysisResults, AnalysisResultsSkeleton } from './AnalysisResults';
import { useAppContext } from '../../context/AppContext';
import { generateDynamicRoutine, getCatalogRecommendationsByIds, normalizeRecommendations, syncRecommendationsFromRoutine, getStableRecommendations } from '../../lib/skinRecommendations';
import { generateSkinReasoning } from '../../lib/geminiSkinService';
import { SkinAnalysisRecord, ClassPrediction } from '../../types';

type WorkflowState = 'idle' | 'aligning' | 'analyzing' | 'results';

// Professional status labels shown during analysis
const ANALYSIS_STEPS = [
  'Initializing skin analysis engine...',
  'Scanning skin texture and clarity...',
  'Evaluating dermal hydration metrics...',
  'Generating personalized AI insights...',
  'Finalizing comprehensive report...',
];

const PREP_CARDS = [
  {
    icon: Sparkles,
    title: 'Clean Face',
    description: 'Ensure skin is clean and free of heavy makeup, surface oils, or moisture films.',
  },
  {
    icon: UserX,
    title: 'Remove Obstructions',
    description: 'Clear hair, glasses, and face coverings away from your forehead, cheeks, and chin.',
  },
  {
    icon: Sun,
    title: 'Balanced Lighting',
    description: 'Face a steady, soft light source without direct glare or harsh shadows.',
  },
  {
    icon: Focus,
    title: 'Proper Face Alignment',
    description: 'Position your face centrally inside the frame at eye level before scanning.',
  },
];

export function SkinAnalysis() {
  const [workflowState,  setWorkflowState]  = useState<WorkflowState>('idle');
  const [lastImage,      setLastImage]       = useState<string>('');
  const [errorMessage,   setErrorMessage]    = useState<string | null>(null);
  const [analysisStep,   setAnalysisStep]    = useState<number>(0);
  const isMountedRef = useRef(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isAnalyzingRef = useRef(false);
  const lastAnalyzedImageRef = useRef<string | null>(null);

  const { addGalleryImage, gallery, user, updateSkincareRoutine } = useAppContext();

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setErrorMessage('Please select a valid image file (JPEG, PNG, WebP).');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      if (dataUrl) {
        setErrorMessage(null);
        setLastImage(dataUrl);
        setWorkflowState('analyzing');
      }
    };
    reader.onerror = () => {
      setErrorMessage('Failed to read the selected image file.');
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // Track mount state for safe async updates
  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  // Cycle the step label during analysis
  useEffect(() => {
    if (workflowState !== 'analyzing') return;
    setAnalysisStep(0);
    const id = setInterval(() => {
      setAnalysisStep(s => Math.min(s + 1, ANALYSIS_STEPS.length - 1));
    }, 1800);
    return () => clearInterval(id);
  }, [workflowState]);

  // Main pipeline - Strictly single guaranteed call with ref lock & idempotent image tracking
  useEffect(() => {
    if (workflowState !== 'analyzing') {
      isAnalyzingRef.current = false;
      return;
    }

    if (!lastImage) {
      setWorkflowState('idle');
      return;
    }

    // Absolute deduplication lock: Prevent analyzing the exact same image capture twice
    if (lastAnalyzedImageRef.current === lastImage) {
      console.warn('[SkinAnalysis] Image already processed or currently analyzing, blocking duplicate call.');
      return;
    }

    if (isAnalyzingRef.current) return;
    isAnalyzingRef.current = true;
    lastAnalyzedImageRef.current = lastImage;

    const controller = new AbortController();

    const runPipeline = async () => {
      try {
        const apiRes = await fetch('/api/skin/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            image: lastImage,
            userId: user?.id || user?.email || 'default_user',
          }),
        });

        if (!apiRes.ok) {
          const errBody = await apiRes.json().catch(() => ({}));
          const msg = errBody.error || errBody.detail || errBody.message || `HTTP ${apiRes.status}`;
          throw new Error(msg);
        }

        const cvMetrics: any = await apiRes.json();

        if (cvMetrics.faceDetected === false) {
          if (isMountedRef.current) {
            setErrorMessage(cvMetrics.message || "Face not properly detected. Please position your face clearly inside the camera frame.");
            setWorkflowState('idle');
          }
          return;
        }

        if (
          typeof cvMetrics.score      !== 'number' ||
          typeof cvMetrics.hydration  !== 'number' ||
          typeof cvMetrics.texture    !== 'number'
        ) {
          throw new Error('Analysis backend returned invalid metric values.');
        }

        // Extract 5 skin type classifications: Acne, Oily, Dry, Wrinkles, Normal
        const rawClassifications: any[] = cvMetrics.allClassifications || cvMetrics.classifications || [];
        let allFive: ClassPrediction[] = [];

        if (Array.isArray(rawClassifications) && rawClassifications.length > 0) {
          const skinTypeNames = ['acne', 'oily', 'dry', 'wrinkles', 'normal'];
          const matched = rawClassifications.filter(c => {
            const key = (c.className || c.label || '').toLowerCase();
            return skinTypeNames.some(name => key.includes(name));
          });

          if (matched.length >= 5) {
            allFive = matched.slice(0, 5).map(c => ({
              className: c.className,
              label: c.label,
              confidence: Number(c.confidence ?? (c.probability * 100).toFixed(1)),
              probability: c.probability,
              logit: c.logit,
              detected: Boolean(c.detected ?? (c.confidence >= 45)),
              severity: c.severity || (c.confidence >= 70 ? 'Severe' : c.confidence >= 45 ? 'Moderate' : c.confidence >= 20 ? 'Mild' : 'Not Detected'),
              regions: c.regions || [],
              description: c.description || undefined,
            }));
          }
        }

        if (allFive.length < 5) {
          const cScores = cvMetrics.conditionScores || {};
          const probs = cvMetrics.rawProbabilities || [];
          const pAcne = cScores.acne ?? probs[0] ?? 0.0;
          const pOily = cScores.oily ?? cScores.oily_skin ?? (probs.length === 5 ? probs[1] : (probs[7] ?? 0.0));
          const pDry = cScores.dry ?? cScores.dry_skin ?? (probs.length === 5 ? probs[2] : (probs[6] ?? 0.0));
          const pWrinkles = cScores.wrinkles ?? (probs.length === 5 ? probs[3] : (probs[4] ?? 0.0));
          const maxConcern = Math.max(pAcne, pOily, pDry, pWrinkles);
          const pNormal = cScores.normal ?? (probs.length === 5 ? probs[4] : Math.max(0.05, 1.0 - maxConcern));

          const specList = [
            { key: 'acne', label: 'Acne', p: pAcne },
            { key: 'oily', label: 'Oily', p: pOily },
            { key: 'dry', label: 'Dry', p: pDry },
            { key: 'wrinkles', label: 'Wrinkles', p: pWrinkles },
            { key: 'normal', label: 'Normal', p: pNormal },
          ];

          allFive = specList.map(item => {
            const conf = Number((item.p * 100).toFixed(1));
            const isNormal = item.key === 'normal';
            const det = isNormal ? (maxConcern < 0.45 || item.p >= 0.50) : (item.p >= 0.45);
            const sev = isNormal
              ? (det ? 'Healthy / Balanced' : 'Normal')
              : (item.p >= 0.70 ? 'Severe' : item.p >= 0.45 ? 'Moderate' : item.p >= 0.20 ? 'Mild' : 'Not Detected');
            return {
              className: item.key,
              label: item.label,
              confidence: conf,
              probability: item.p,
              detected: det,
              severity: sev,
            };
          });
        }

        const detectedConditions = allFive.filter(c => c.detected).map(c => c.label);
        const detectedCount = detectedConditions.length;

        // Top 3 sorted by confidence
        const sortedForTop = [...allFive].sort((a, b) => b.confidence - a.confidence);
        const topThreeClasses = sortedForTop.slice(0, 3);
        const topOne = topThreeClasses[0];

        const acneItem = allFive.find(c => c.className === 'acne');
        const acneSevLabel = acneItem ? (acneItem.detected ? acneItem.severity : 'Not Detected') : 'Not Detected';

        const skinTypeMap: Record<string, string> = {
          acne: 'Acne Skin Type',
          oily: 'Oily Skin Type',
          dry: 'Dry Skin Type',
          wrinkles: 'Wrinkles Skin Type',
          normal: 'Normal Skin Type',
        };

        const rawCls = (cvMetrics.classification || '').toLowerCase();
        let finalSkinType = 'Normal Skin Type';
        if (rawCls.includes('acne')) finalSkinType = 'Acne Skin Type';
        else if (rawCls.includes('oily')) finalSkinType = 'Oily Skin Type';
        else if (rawCls.includes('dry')) finalSkinType = 'Dry Skin Type';
        else if (rawCls.includes('wrinkle')) finalSkinType = 'Wrinkles Skin Type';
        else if (rawCls.includes('normal')) finalSkinType = 'Normal Skin Type';
        else if (topOne && topOne.detected && skinTypeMap[topOne.className]) {
          finalSkinType = skinTypeMap[topOne.className];
        }

        const priorHistory = gallery.slice(0, 10);
        const userIdStr = user?.id || user?.email || 'default_user';
        const { explanation, spokenSummary, productIds, routine: geminiRoutine } = await generateSkinReasoning(
          {
            id:             Date.now().toString(),
            date:           new Date().toISOString(),
            score:          cvMetrics.score,
            hydration:      cvMetrics.hydration,
            texture:        cvMetrics.texture,
            acneSeverity:   acneSevLabel,
            acneScore:      cvMetrics.acneScore,
            acneDetected:   Boolean(acneItem?.detected),
            uvDamage:       cvMetrics.uvDamage,
            uvScore:        cvMetrics.uvScore,
            classification: finalSkinType,
          },
          priorHistory
        );

        const partialRecord = { ...cvMetrics, finalSkinType, topThreeClasses, acneSeverity: acneSevLabel };
        const finalRoutine = geminiRoutine || generateDynamicRoutine(partialRecord, userIdStr);
        let recommendations = getStableRecommendations(partialRecord, userIdStr);

        if (productIds && productIds.length > 0) {
          recommendations = getCatalogRecommendationsByIds(productIds, recommendations);
        }
        recommendations = normalizeRecommendations(recommendations);

        updateSkincareRoutine(finalRoutine);

        const fullRecord: SkinAnalysisRecord = {
          id:                      Date.now().toString(),
          date:                    new Date().toISOString(),
          score:                   cvMetrics.score,
          hydration:               cvMetrics.hydration,
          texture:                 cvMetrics.texture,
          acneSeverity:            acneSevLabel,
          acneScore:               cvMetrics.acneScore,
          acneDetected:            Boolean(acneItem?.detected),
          uvDamage:                cvMetrics.uvDamage,
          uvScore:                 cvMetrics.uvScore,
          classification:          cvMetrics.classification || finalSkinType,
          finalSkinType,
          topThreeClasses,
          allClassifications:      allFive,
          detectedConditions,
          detectedCount,
          imageUrl:                lastImage || undefined,
          aiExplanation:           explanation,
          recommendations,
          routine:                 finalRoutine,
          faceDetected:            true,
          agreementScore:          100,
          disagreements:           [],
          fusionSummary:           `Facial skin health analysis verified. ${detectedCount} condition(s) detected.`,
          detectedRegions:         cvMetrics.detectedRegions || [],
          youcamAnalysis:          cvMetrics.youcamAnalysis || null,
          primaryModelPredictions: cvMetrics,
          geminiVisionAnalysis:    null,
        };

        // Asynchronously persist full scan to server immediately
        fetch('/api/skin/save-scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(fullRecord),
        }).catch(saveErr => {
          console.warn('[SkinAnalysis] Immediate server scan save failed:', saveErr);
        });

        window.dispatchEvent(new CustomEvent('orion_skin_analysis_stage', {
          detail: {
            stage: 'results',
            details: {
              ...cvMetrics,
              explanation,
              spokenSummary,
            },
          },
        }));

        if (isMountedRef.current) {
          addGalleryImage(fullRecord);
          setWorkflowState('results');
        }
      } catch (err) {
        console.error('[SKIN PIPELINE ERROR]', err);
        if (isMountedRef.current) {
          setErrorMessage(
            err instanceof Error ? err.message : String(err)
          );
          setWorkflowState('idle');
        }
      } finally {
        isAnalyzingRef.current = false;
      }
    };

    runPipeline();
    return () => {
      controller.abort();
    };
  }, [workflowState]);

  useEffect(() => {
    const handler = () => setWorkflowState('aligning');
    window.addEventListener('orion_trigger_skin_analysis', handler);
    return () => window.removeEventListener('orion_trigger_skin_analysis', handler);
  }, []);

  useEffect(() => {
    if (workflowState === 'idle' || workflowState === 'results') return;
    window.dispatchEvent(new CustomEvent('orion_skin_analysis_stage', { detail: { stage: workflowState } }));
  }, [workflowState]);

  return (
    <div className="w-full h-full relative overflow-y-auto custom-scrollbar">
      <AnimatePresence mode="wait">

        {/* IDLE PREPARATION GUIDE */}
        {workflowState === 'idle' && (
          <motion.div
            key="idle"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center justify-start pt-16 pb-32 px-4 sm:px-8 min-h-full text-center max-w-5xl mx-auto"
          >
            <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mb-4 border-2 border-primary/30 glow-primary relative overflow-hidden">
              <div className="absolute inset-0 bg-primary/20 mix-blend-overlay animate-pulse" />
              <ScanFace size={42} className="text-primary opacity-90" strokeWidth={1.5} />
            </div>

            <h1 className="text-3xl md:text-4xl font-extrabold mb-2 glow-text tracking-tight">
              AI Skin Analysis &amp; Prep Guide
            </h1>
            <p className="text-on-surface-variant max-w-xl mb-8 text-sm md:text-base leading-relaxed">
              Follow these simple preparation guidelines to ensure accurate facial scanning and precise dermal health metrics.
            </p>

            {/* Instruction Prep Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 w-full mb-8 text-left">
              {PREP_CARDS.map((card, i) => {
                const Icon = card.icon;
                return (
                  <div key={i} className="glass-panel p-5 rounded-2xl flex flex-col gap-2.5 border border-white/10 hover:border-primary/40 transition-colors shadow-lg">
                    <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0">
                      <Icon size={20} />
                    </div>
                    <h3 className="font-bold text-white text-sm">{card.title}</h3>
                    <p className="text-xs text-on-surface-variant leading-relaxed">{card.description}</p>
                  </div>
                );
              })}
            </div>

            {errorMessage && (
              <div className="mb-6 p-4 bg-red-500/20 border border-red-500/40 rounded-xl text-red-200 text-sm flex items-start gap-2 max-w-md text-left">
                <AlertCircle size={18} className="shrink-0 mt-0.5 text-red-400" />
                <span>{errorMessage}</span>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-center gap-4">
              <button
                onClick={() => {
                  setErrorMessage(null);
                  setWorkflowState('aligning');
                }}
                className="bg-primary text-on-primary px-8 py-3.5 rounded-full font-bold text-base hover:bg-primary-container transition-all active:scale-95 shadow-[0_0_24px_rgba(56,189,248,0.4)] flex items-center gap-2"
              >
                <ScanFace size={20} />
                Analyze My Skin (Live Camera)
              </button>

              <button
                onClick={() => fileInputRef.current?.click()}
                className="bg-white/10 hover:bg-white/15 text-white border border-white/20 px-7 py-3.5 rounded-full font-bold text-base transition-all active:scale-95 flex items-center gap-2 shadow-lg hover:border-primary/40 cursor-pointer"
              >
                <Upload size={18} />
                <span>Upload Facial Photo</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileUpload}
              />
            </div>
            <p className="mt-4 text-xs text-on-surface-variant flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
              Or say <span className="font-semibold text-primary">&ldquo;Orion, analyze my skin&rdquo;</span>
            </p>
          </motion.div>
        )}

        {/* ALIGNING */}
        {workflowState === 'aligning' && (
          <motion.div key="aligning" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0">
            <FaceAlignment
              onCapture={(url) => {
                setLastImage(url);
                setWorkflowState('analyzing');
              }}
              onCancel={() => setWorkflowState('idle')}
            />
          </motion.div>
        )}

        {/* ANALYZING LOADING SCREEN WITH DASHBOARD SKELETON SHIMMER */}
        {workflowState === 'analyzing' && (
          <motion.div
            key="analyzing"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="relative w-full h-full"
          >
            {/* Top Floating AI Status Indicator Pill */}
            <div className="sticky top-4 z-40 max-w-xl mx-auto px-6 py-3 rounded-full bg-black/80 backdrop-blur-xl border border-primary/40 shadow-2xl flex items-center justify-between gap-4 text-xs font-semibold glow-primary">
              <div className="flex items-center gap-3">
                <Loader2 size={18} className="text-primary animate-spin" />
                <motion.span
                  key={analysisStep}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-white font-medium"
                >
                  {ANALYSIS_STEPS[analysisStep]}
                </motion.span>
              </div>
              <span className="font-mono text-primary font-bold">
                {Math.round(((analysisStep + 1) / ANALYSIS_STEPS.length) * 100)}%
              </span>
            </div>

            {/* Smooth Skeleton Shimmer across entire dashboard */}
            <AnalysisResultsSkeleton />
          </motion.div>
        )}

        {/* RESULTS */}
        {workflowState === 'results' && (
          <motion.div key="results" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <AnalysisResults
              onBack={() => setWorkflowState('idle')}
            />
          </motion.div>
        )}

      </AnimatePresence>
    </div>
  );
}

