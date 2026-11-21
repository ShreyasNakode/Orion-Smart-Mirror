import React, { useState, useMemo } from 'react';
import { motion } from 'motion/react';
import { GlassCard } from '../../components/GlassCard';
import {
  ArrowLeft, ShieldCheck, Sparkles, TrendingUp, TrendingDown,
  Minus, QrCode, X, ShoppingBag, CheckCircle2, Moon, Sun, Leaf,
  Flame, CircleDot, SunDim, Scan, Waves, ShieldAlert, Droplets,
  CheckCircle, AlertCircle, Filter, Cpu, Layers, Eye, EyeOff, Crosshair,
  RefreshCw, Check
} from 'lucide-react';
import { useAppContext } from '../../context/AppContext';
import { downloadReportFile, generateQRCodeDataUrl } from '../../lib/reportGenerator';
import { normalizeRecommendations, syncRecommendationsFromRoutine, getStableRecommendations } from '../../lib/skinRecommendations';
import { cleanAiSummaryText } from '../../lib/geminiSkinService';
import { Recommendation, SkinAnalysisRecord, ClassPrediction, DetectedFeatureRegion } from '../../types';
import { ReportQRModal } from '../../components/ReportQRModal';

interface AnalysisResultsProps {
  onBack: () => void;
}

interface CategoryMeta {
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  accentColor: string;
  badgeColor: string;
  description: string;
}

const CATEGORY_META: Record<string, CategoryMeta> = {
  acne: {
    label: 'Acne',
    icon: Flame,
    accentColor: 'from-rose-500 to-red-600',
    badgeColor: 'text-rose-300 bg-rose-500/20 border-rose-500/30',
    description: 'Active blemishes, spots & inflammation',
  },
  oily: {
    label: 'Oily',
    icon: Sparkles,
    accentColor: 'from-emerald-500 to-teal-600',
    badgeColor: 'text-emerald-300 bg-emerald-500/20 border-emerald-500/30',
    description: 'Excess surface sebum & shine',
  },
  'oily skin': {
    label: 'Oily',
    icon: Sparkles,
    accentColor: 'from-emerald-500 to-teal-600',
    badgeColor: 'text-emerald-300 bg-emerald-500/20 border-emerald-500/30',
    description: 'Excess surface sebum & shine',
  },
  oilyskin: {
    label: 'Oily',
    icon: Sparkles,
    accentColor: 'from-emerald-500 to-teal-600',
    badgeColor: 'text-emerald-300 bg-emerald-500/20 border-emerald-500/30',
    description: 'Excess surface sebum & shine',
  },
  dry: {
    label: 'Dryness',
    icon: Droplets,
    accentColor: 'from-sky-500 to-cyan-600',
    badgeColor: 'text-sky-300 bg-sky-500/20 border-sky-500/30',
    description: 'Dehydration & moisture barrier deficit',
  },
  'dry skin': {
    label: 'Dryness',
    icon: Droplets,
    accentColor: 'from-sky-500 to-cyan-600',
    badgeColor: 'text-sky-300 bg-sky-500/20 border-sky-500/30',
    description: 'Dehydration & moisture barrier deficit',
  },
  dryskin: {
    label: 'Dryness',
    icon: Droplets,
    accentColor: 'from-sky-500 to-cyan-600',
    badgeColor: 'text-sky-300 bg-sky-500/20 border-sky-500/30',
    description: 'Dehydration & moisture barrier deficit',
  },
  wrinkles: {
    label: 'Wrinkles',
    icon: Waves,
    accentColor: 'from-indigo-500 to-blue-600',
    badgeColor: 'text-indigo-300 bg-indigo-500/20 border-indigo-500/30',
    description: 'Fine expression lines & skin laxity',
  },
  normal: {
    label: 'Normal Skin',
    icon: ShieldCheck,
    accentColor: 'from-emerald-400 to-green-500',
    badgeColor: 'text-emerald-300 bg-emerald-500/20 border-emerald-500/30',
    description: 'Balanced, clear & healthy skin barrier',
  },
};

function getCategoryMeta(name: string, label: string): CategoryMeta {
  const norm = (label || name || '').toLowerCase().trim();
  for (const [k, meta] of Object.entries(CATEGORY_META)) {
    if (norm === k || norm.replace(/\s+/g, '') === k.replace(/\s+/g, '')) {
      return meta;
    }
  }
  return {
    label: label || name || 'Classification',
    icon: Sparkles,
    accentColor: 'from-primary to-secondary',
    badgeColor: 'text-primary bg-primary/20 border-primary/30',
    description: 'Facial feature classification',
  };
}

function TrendBadge({ delta }: { delta: number }) {
  if (delta > 0) return (
    <span className="flex items-center gap-1 text-emerald-400 font-bold text-xs">
      <TrendingUp size={13} /> +{delta}%
    </span>
  );
  if (delta < 0) return (
    <span className="flex items-center gap-1 text-rose-400 font-bold text-xs">
      <TrendingDown size={13} /> {delta}%
    </span>
  );
  return (
    <span className="flex items-center gap-1 text-on-surface-variant font-bold text-xs">
      <Minus size={13} /> —
    </span>
  );
}

export function AnalysisResultsSkeleton() {
  return (
    <div className="pt-6 pb-40 pl-4 pr-16 sm:px-8 w-full max-w-[1400px] mx-auto min-h-screen overflow-y-auto flex flex-col xl:flex-row gap-6 lg:gap-8 animate-shimmer">
      {/* LEFT COLUMN SKELETON */}
      <div className="flex-1 flex flex-col gap-6">
        {/* Header bar skeleton */}
        <div className="flex items-center justify-between mb-2 pl-14">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-full skeleton-box" />
            <div className="flex flex-col gap-2">
              <div className="w-64 h-8 skeleton-box" />
              <div className="w-96 h-4 skeleton-box opacity-60" />
            </div>
          </div>
          <div className="w-36 h-10 rounded-full skeleton-box" />
        </div>

        {/* Primary Profile Card Skeleton */}
        <GlassCard className="p-8 relative overflow-hidden">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
            <div className="flex flex-col gap-3">
              <div className="w-32 h-6 rounded-full skeleton-box" />
              <div className="w-72 h-10 skeleton-box" />
              <div className="w-80 h-4 skeleton-box opacity-60" />
            </div>
            <div className="w-36 h-20 rounded-2xl skeleton-box" />
          </div>

          {/* 5-Skin-Type Classifications Skeleton */}
          <div className="mb-6 bg-white/5 p-5 sm:p-6 rounded-2xl border border-white/10 flex flex-col gap-6">
            <div className="flex justify-between items-center pb-4 border-b border-white/10">
              <div className="w-64 h-6 skeleton-box" />
              <div className="w-32 h-6 skeleton-box rounded-full" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
              {/* Face Box Skeleton */}
              <div className="md:col-span-5 w-full aspect-[3/4] max-h-[460px] rounded-2xl skeleton-box" />
              {/* Buttons Skeleton */}
              <div className="md:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[1, 2, 3, 4, 5].map(i => (
                  <div key={i} className="bg-white/5 p-4 rounded-2xl border border-white/5 flex flex-col gap-3">
                    <div className="flex justify-between items-center">
                      <div className="w-28 h-5 skeleton-box" />
                      <div className="w-16 h-4 skeleton-box rounded-full" />
                    </div>
                    <div className="w-full h-3 skeleton-box opacity-60" />
                    <div className="flex justify-between items-center pt-2">
                      <div className="w-16 h-6 skeleton-box" />
                      <div className="w-20 h-4 skeleton-box" />
                    </div>
                    <div className="w-full h-2 skeleton-box rounded-full" />
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Metrics Grid Skeleton */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="bg-white/5 p-4 rounded-xl border border-white/5 flex flex-col items-center gap-2">
                <div className="w-20 h-3 skeleton-box" />
                <div className="w-16 h-7 skeleton-box" />
                <div className="w-14 h-3 skeleton-box opacity-60" />
              </div>
            ))}
          </div>

          {/* Gemini AI Summary Block Skeleton */}
          <div className="mt-4 pt-4 border-t border-white/10 flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Sparkles size={16} className="text-primary animate-pulse" />
              <div className="w-56 h-5 skeleton-box" />
            </div>
            <div className="space-y-2">
              <div className="w-full h-4 skeleton-box opacity-80" />
              <div className="w-11/12 h-4 skeleton-box opacity-70" />
              <div className="w-4/5 h-4 skeleton-box opacity-60" />
            </div>
          </div>
        </GlassCard>

        {/* Routine Section Skeleton */}
        <GlassCard className="p-6 relative overflow-hidden">
          <div className="w-72 h-7 skeleton-box mb-2" />
          <div className="w-96 h-4 skeleton-box opacity-60 mb-6" />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {[1, 2].map(col => (
              <div key={col} className="bg-white/5 p-4 rounded-2xl border border-white/10 flex flex-col gap-4">
                <div className="w-44 h-6 skeleton-box" />
                <div className="space-y-3">
                  {[1, 2, 3].map(step => (
                    <div key={step} className="p-3 bg-white/5 rounded-xl border border-white/5 flex flex-col gap-2">
                      <div className="w-32 h-4 skeleton-box" />
                      <div className="w-48 h-4 skeleton-box opacity-80" />
                      <div className="w-full h-3 skeleton-box opacity-60" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </GlassCard>
      </div>

      {/* RIGHT COLUMN SKELETON */}
      <div className="w-full xl:w-[400px] flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <div className="w-56 h-7 skeleton-box" />
          <div className="w-full h-4 skeleton-box opacity-60" />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 gap-5">
          {[1, 2, 3].map(p => (
            <GlassCard key={p} className="p-5 flex flex-col gap-3 relative overflow-hidden">
              <div className="aspect-video w-full rounded-xl skeleton-box" />
              <div className="w-24 h-3 skeleton-box" />
              <div className="w-56 h-5 skeleton-box" />
              <div className="w-full h-4 skeleton-box opacity-70" />
              <div className="w-48 h-3 skeleton-box opacity-60 mt-1" />
              <div className="w-full h-10 rounded-xl skeleton-box mt-3" />
            </GlassCard>
          ))}
        </div>
      </div>
    </div>
  );
}

export function AnalysisResults({ onBack }: AnalysisResultsProps) {
  const { gallery, user, skincareRoutine } = useAppContext();

  const [showReportQrModal, setShowReportQrModal] = useState<boolean>(false);
  const [selectedProductQr, setSelectedProductQr] = useState<{ rec: Recommendation; qrUrl: string } | null>(null);
  const [qrLoadingId, setQrLoadingId] = useState<string | null>(null);
  const [productQrRefreshing, setProductQrRefreshing] = useState<boolean>(false);
  const [productQrJustRefreshed, setProductQrJustRefreshed] = useState<boolean>(false);
  const [productQrError, setProductQrError] = useState<string>('');
  const [filterMode, setFilterMode] = useState<'all' | 'detected' | 'clear'>('all');
  const [showOverlays, setShowOverlays] = useState<boolean>(true);

  const latestScan: SkinAnalysisRecord | null = gallery.length > 0 ? gallery[0] : null;
  const prevScan: SkinAnalysisRecord | null = gallery.length > 1 ? gallery[1] : null;

  const [selectedCondition, setSelectedCondition] = useState<string>('normal');

  // Set default selected condition based on latest scan diagnosis
  React.useEffect(() => {
    if (!latestScan) return;
    const rawClass = (latestScan.classification || latestScan.finalSkinType || '').toLowerCase();
    if (rawClass.includes('acne')) setSelectedCondition('acne');
    else if (rawClass.includes('oily')) setSelectedCondition('oily');
    else if (rawClass.includes('dry')) setSelectedCondition('dry');
    else if (rawClass.includes('wrinkle')) setSelectedCondition('wrinkles');
    else setSelectedCondition('normal');
  }, [latestScan]);

  const allFiveClassifications: ClassPrediction[] = useMemo(() => {
    if (!latestScan) return [];
    const sourceList = (latestScan.allClassifications && latestScan.allClassifications.length > 0)
      ? latestScan.allClassifications
      : (latestScan.topThreeClasses || []);

    const skinTypeOrder = ['acne', 'oily', 'dry', 'wrinkles', 'normal'];
    const cMap = new Map<string, ClassPrediction>();

    sourceList.forEach(item => {
      const norm = (item.className || item.label || '').toLowerCase();
      if (norm.includes('acne')) cMap.set('acne', { ...item, className: 'acne', label: 'Acne' });
      else if (norm.includes('oily')) cMap.set('oily', { ...item, className: 'oily', label: 'Oily' });
      else if (norm.includes('dry')) cMap.set('dry', { ...item, className: 'dry', label: 'Dryness' });
      else if (norm.includes('wrinkle')) cMap.set('wrinkles', { ...item, className: 'wrinkles', label: 'Wrinkles' });
      else if (norm.includes('normal')) cMap.set('normal', { ...item, className: 'normal', label: 'Normal Skin' });
    });

    return skinTypeOrder.map(key => {
      if (cMap.has(key)) return cMap.get(key)!;
      if (key === 'acne') return { className: 'acne', label: 'Acne', confidence: Number(latestScan.acneScore || 0), detected: Boolean(latestScan.acneDetected), severity: latestScan.acneSeverity || 'Not Detected' };
      if (key === 'oily') return { className: 'oily', label: 'Oily', confidence: 0, detected: false, severity: 'Not Detected' };
      if (key === 'dry') return { className: 'dry', label: 'Dryness', confidence: Number(Math.max(0, 100 - (latestScan.hydration || 50)).toFixed(1)), detected: (latestScan.hydration || 50) < 40, severity: (latestScan.hydration || 50) < 40 ? 'Moderate' : 'Mild' };
      if (key === 'wrinkles') return { className: 'wrinkles', label: 'Wrinkles', confidence: Number(Math.max(0, 100 - (latestScan.texture || 50)).toFixed(1)), detected: (latestScan.texture || 50) < 40, severity: (latestScan.texture || 50) < 40 ? 'Moderate' : 'Mild' };
      return { className: 'normal', label: 'Normal Skin', confidence: Number((latestScan.score || 85).toFixed(1)), detected: true, severity: 'Healthy / Balanced' };
    });
  }, [latestScan]);

  const displayRegions = useMemo((): DetectedFeatureRegion[] => {
    if (!latestScan) return [];
    if (latestScan.detectedRegions && latestScan.detectedRegions.length > 0) {
      return latestScan.detectedRegions;
    }

    // Default anatomical detected locations if not provided
    const syn: DetectedFeatureRegion[] = [];
    const acnePred = allFiveClassifications.find(c => c.className === 'acne');
    const oilyPred = allFiveClassifications.find(c => c.className === 'oily');
    const dryPred = allFiveClassifications.find(c => c.className === 'dry');
    const wrinklePred = allFiveClassifications.find(c => c.className === 'wrinkles');
    const normalPred = allFiveClassifications.find(c => c.className === 'normal');

    const acneConf = acnePred?.confidence || 0;
    const oilyConf = oilyPred?.confidence || 0;
    const dryConf = dryPred?.confidence || 0;
    const wrinkleConf = wrinklePred?.confidence || 0;
    const normalConf = normalPred?.confidence || 85;

    if (acneConf >= 20 || acnePred?.detected) {
      syn.push(
        { type: 'acne', label: 'Forehead Spot', confidence: acneConf, x: 48, y: 32, area: 'forehead' },
        { type: 'acne', label: 'Left Cheek Flare', confidence: acneConf, x: 33, y: 55, area: 'cheek_left' },
        { type: 'acne', label: 'Right Cheek Spot', confidence: acneConf, x: 67, y: 58, area: 'cheek_right' },
        { type: 'acne', label: 'Chin Blemish', confidence: acneConf, x: 50, y: 77, area: 'chin' },
      );
    }
    if (oilyConf >= 20 || oilyPred?.detected) {
      syn.push(
        { type: 'oily', label: 'T-Zone Sebum', confidence: oilyConf, x: 50, y: 36, width: 32, height: 16, area: 'forehead' },
        { type: 'oily', label: 'Nose Sheen', confidence: oilyConf, x: 50, y: 52, width: 16, height: 16, area: 'nose' },
      );
    }
    if (dryConf >= 20 || dryPred?.detected) {
      syn.push(
        { type: 'dry', label: 'Left Cheek Deficit', confidence: dryConf, x: 28, y: 62, width: 22, height: 18, area: 'cheek_left' },
        { type: 'dry', label: 'Right Cheek Deficit', confidence: dryConf, x: 72, y: 62, width: 22, height: 18, area: 'cheek_right' },
      );
    }
    if (wrinkleConf >= 20 || wrinklePred?.detected) {
      syn.push(
        { type: 'wrinkles', label: 'Forehead Lines', confidence: wrinkleConf, x: 50, y: 26, width: 36, height: 8, area: 'forehead' },
        { type: 'wrinkles', label: 'Glabellar Furrow', confidence: wrinkleConf, x: 50, y: 39, width: 8, height: 10, area: 'glabellar' },
        { type: 'wrinkles', label: "Left Crow's Feet", confidence: wrinkleConf, x: 25, y: 44, width: 10, height: 10, area: 'periorbital' },
        { type: 'wrinkles', label: "Right Crow's Feet", confidence: wrinkleConf, x: 75, y: 44, width: 10, height: 10, area: 'periorbital' },
      );
    }
    syn.push({
      type: 'normal',
      label: 'Balanced Facial Shield',
      confidence: normalConf,
      x: 50,
      y: 50,
      width: 62,
      height: 72,
      area: 't_zone',
    });
    return syn;
  }, [latestScan, allFiveClassifications]);

  const detectedCount = useMemo(() => {
    return allFiveClassifications.filter(c => c.detected ?? ((c.confidence ?? 0) >= 45)).length;
  }, [allFiveClassifications]);

  const clearCount = useMemo(() => {
    return Math.max(0, allFiveClassifications.length - detectedCount);
  }, [allFiveClassifications, detectedCount]);

  const filteredClassifications = useMemo(() => {
    if (filterMode === 'detected') {
      return allFiveClassifications.filter(c => c.detected ?? ((c.confidence ?? 0) >= 45));
    }
    if (filterMode === 'clear') {
      return allFiveClassifications.filter(c => !(c.detected ?? ((c.confidence ?? 0) >= 45)));
    }
    return allFiveClassifications;
  }, [allFiveClassifications, filterMode]);

  const deltas = useMemo(() => ({
    score: latestScan && prevScan ? latestScan.score - prevScan.score : 0,
    hydration: latestScan && prevScan ? latestScan.hydration - prevScan.hydration : 0,
    texture: latestScan && prevScan ? latestScan.texture - prevScan.texture : 0,
  }), [latestScan, prevScan]);

  const userIdStr = user?.id || user?.email || 'default_user';
  const activeRoutine = latestScan?.routine || skincareRoutine;

  const recommendations = useMemo(() => {
    if (!latestScan) return [];
    return syncRecommendationsFromRoutine(activeRoutine, latestScan, userIdStr);
  }, [latestScan, activeRoutine, userIdStr]);

  const topThree: ClassPrediction[] = useMemo(() => {
    if (!latestScan) return [];
    if (latestScan.topThreeClasses && latestScan.topThreeClasses.length > 0) {
      return latestScan.topThreeClasses;
    }
    const sorted = [...allFiveClassifications].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
    return sorted.slice(0, 3);
  }, [latestScan, allFiveClassifications]);

  const finalSkinType = useMemo(() => {
    if (!latestScan) return 'Normal Skin Type';
    const rawClass = (latestScan.classification || latestScan.finalSkinType || '').toLowerCase();
    if (rawClass.includes('acne')) return 'Acne Skin Type';
    if (rawClass.includes('oily')) return 'Oily Skin Type';
    if (rawClass.includes('dry')) return 'Dry Skin Type';
    if (rawClass.includes('wrinkle')) return 'Wrinkles Skin Type';
    if (rawClass.includes('normal')) return 'Normal Skin Type';
    return 'Normal Skin Type';
  }, [latestScan]);

  const handleOpenProductQr = async (rec: Recommendation) => {
    const purchaseUrl = rec.productUrl?.trim();
    if (!purchaseUrl || !/^https?:\/\//i.test(purchaseUrl)) {
      console.error('Recommendation is missing a valid purchase URL:', rec);
      return;
    }

    setQrLoadingId(rec.id);
    setProductQrError('');
    try {
      const qrUrl = await generateQRCodeDataUrl(purchaseUrl);
      setSelectedProductQr({ rec: { ...rec, productUrl: purchaseUrl }, qrUrl });
    } catch (e) {
      console.error('Failed to generate product QR code:', e);
      setProductQrError('Failed to generate product QR code.');
    } finally {
      setQrLoadingId(null);
    }
  };

  const handleRefreshProductQr = async () => {
    if (!selectedProductQr) return;
    const purchaseUrl = selectedProductQr.rec.productUrl?.trim();
    if (!purchaseUrl || !/^https?:\/\//i.test(purchaseUrl)) {
      setProductQrError('Missing or invalid product URL destination.');
      return;
    }

    setProductQrRefreshing(true);
    setProductQrError('');
    try {
      const qrUrl = await generateQRCodeDataUrl(purchaseUrl);
      setSelectedProductQr({ rec: selectedProductQr.rec, qrUrl });
      setProductQrJustRefreshed(true);
      setTimeout(() => setProductQrJustRefreshed(false), 2000);
    } catch (err: any) {
      console.error('Failed to refresh product QR:', err);
      setProductQrError('Failed to redraw QR code.');
    } finally {
      setProductQrRefreshing(false);
    }
  };

  const handleShowReportQR = () => {
    if (latestScan) {
      setShowReportQrModal(true);
    }
  };

  // Listen for voice assistant event to refresh QR skin report
  React.useEffect(() => {
    const handleVoiceRefresh = () => {
      if (latestScan) {
        setShowReportQrModal(true);
      }
    };
    window.addEventListener('orion_refresh_skin_report_qr', handleVoiceRefresh);
    return () => window.removeEventListener('orion_refresh_skin_report_qr', handleVoiceRefresh);
  }, [latestScan]);

  if (!latestScan) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-center p-12">
        <p className="text-on-surface-variant text-lg">No scan results available yet.</p>
        <button onClick={onBack} className="text-primary font-semibold hover:underline">
          ← Run a skin scan first
        </button>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      className="pt-6 pb-40 pl-4 pr-16 sm:px-8 w-full max-w-[1400px] mx-auto min-h-screen overflow-y-auto flex flex-col xl:flex-row gap-6 lg:gap-8 scroll-smooth"
    >
      {/* ── LEFT COLUMN ────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col gap-6">

        {/* Header bar */}
        <div className="flex items-center justify-between mb-2 pl-14">
          <div className="flex items-center gap-4">
            <button
              onClick={onBack}
              className="p-2.5 hover:bg-white/10 rounded-full transition-colors text-on-surface-variant hover:text-white border border-white/5"
            >
              <ArrowLeft size={22} />
            </button>
            <div>
              <h2 className="text-3xl font-extrabold tracking-tight glow-text">Skin Analysis Dashboard</h2>
              <p className="text-xs text-on-surface-variant">Personalized AI Diagnostic Evaluation &amp; Routine Recommendations</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleShowReportQR}
              className="glass-pill px-4 py-2.5 rounded-full hover:bg-white/10 text-primary transition-colors border border-white/10 flex items-center gap-2 text-xs font-semibold"
              title="Generate Professional Report QR Code"
            >
              <QrCode size={18} />
              <span>QR Skin Report</span>
            </button>
          </div>
        </div>

        {/* Primary Profile Card */}
        <GlassCard className="p-8 relative overflow-hidden">
          <div className="absolute -right-8 -top-8 w-64 h-64 bg-primary/10 rounded-full blur-3xl pointer-events-none" />

          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8 relative z-10">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="px-3 py-1 rounded-full bg-primary/15 text-primary border border-primary/30 font-bold text-xs flex items-center gap-1.5 shadow-sm">
                  <ShieldCheck size={14} /> Final Diagnosis
                </span>
                {prevScan && <TrendBadge delta={deltas.score} />}
              </div>
              <h3 className="text-3xl font-black text-white tracking-tight">{finalSkinType}</h3>
              <p className="text-xs text-on-surface-variant mt-1">
                Primary skin classification based on current facial analysis.
              </p>
            </div>

            <div className="flex items-end gap-3 bg-white/5 p-4 rounded-2xl border border-white/10">
              <span className="text-6xl font-black glow-text leading-none">{latestScan.score}%</span>
              <div className="flex flex-col">
                <span className="text-xs font-bold text-primary">Overall Health</span>
                <span className="text-[10px] text-on-surface-variant">Skin Index Score</span>
              </div>
            </div>
          </div>

          {/* Interactive Face Scan & 5 Skin Classification Area */}
          <div className="mb-6 relative z-10 bg-white/5 p-5 sm:p-6 rounded-2xl border border-white/10 flex flex-col gap-6">
            {/* Header with Title, YouCam Badge, and Filter / Overlay Controls */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-white/10">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center text-primary shrink-0 mt-0.5 shadow-sm">
                  <Cpu size={20} />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="text-base font-extrabold text-white tracking-tight flex items-center gap-2">
                      Facial Analysis &amp; 5 Classification Diagnostics
                    </h4>
                  </div>
                  <p className="text-xs text-on-surface-variant mt-0.5">
                    Select any skin classification below to highlight real detected facial regions, heatmap contours, and severity.
                  </p>
                </div>
              </div>

              {/* Action Controls: Toggle Overlays & Filter Mode */}
              <div className="flex items-center gap-2 flex-wrap self-start md:self-auto">
                <button
                  type="button"
                  onClick={() => setShowOverlays(prev => !prev)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 border shadow-sm ${
                    showOverlays
                      ? 'bg-primary/20 text-primary border-primary/40'
                      : 'bg-white/5 text-on-surface-variant border-white/10 hover:text-white'
                  }`}
                  title="Toggle real detected location overlays on face"
                >
                  {showOverlays ? <Eye size={14} /> : <EyeOff size={14} />}
                  <span>{showOverlays ? 'Overlays On' : 'Overlays Off'}</span>
                </button>

                <div className="flex items-center gap-1 bg-black/40 p-1 rounded-xl border border-white/10">
                  <button
                    type="button"
                    onClick={() => setFilterMode('all')}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
                      filterMode === 'all'
                        ? 'bg-primary text-on-primary shadow-sm'
                        : 'text-on-surface-variant hover:text-white'
                    }`}
                  >
                    All ({allFiveClassifications.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterMode('detected')}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all flex items-center gap-1 ${
                      filterMode === 'detected'
                        ? 'bg-rose-500 text-white shadow-sm'
                        : 'text-rose-400/80 hover:text-rose-300'
                    }`}
                  >
                    <AlertCircle size={12} />
                    Detected ({detectedCount})
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterMode('clear')}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all flex items-center gap-1 ${
                      filterMode === 'clear'
                        ? 'bg-emerald-500 text-white shadow-sm'
                        : 'text-emerald-400/80 hover:text-emerald-300'
                    }`}
                  >
                    <CheckCircle size={12} />
                    Clear ({clearCount})
                  </button>
                </div>
              </div>
            </div>

            {/* Split Hero Layout: Face Scan Visualizer (Left) + 5 Classification Cards (Right) */}
            <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
              {/* FACE SCAN VIEWER */}
              <div className="md:col-span-5 flex flex-col gap-3">
                <div className="relative rounded-2xl overflow-hidden border border-white/15 bg-black/60 shadow-2xl aspect-[3/4] max-h-[460px] flex items-center justify-center group select-none">
                  {latestScan.imageUrl ? (
                    <img
                      src={latestScan.imageUrl}
                      alt="Captured Face Analysis"
                      className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center text-on-surface-variant p-6 text-center">
                      <Scan size={52} className="text-primary mb-3 opacity-60 animate-pulse" />
                      <p className="text-xs font-medium">Camera capture preview</p>
                    </div>
                  )}

                  {/* Aesthetic HUD Holographic Frame & Corner Accents */}
                  <div className="absolute inset-0 pointer-events-none bg-gradient-to-t from-black/80 via-transparent to-black/30" />
                  <div className="absolute top-3 left-3 w-4 h-4 border-t-2 border-l-2 border-primary pointer-events-none" />
                  <div className="absolute top-3 right-3 w-4 h-4 border-t-2 border-r-2 border-primary pointer-events-none" />
                  <div className="absolute bottom-3 left-3 w-4 h-4 border-b-2 border-l-2 border-primary pointer-events-none" />
                  <div className="absolute bottom-3 right-3 w-4 h-4 border-b-2 border-r-2 border-primary pointer-events-none" />

                  {/* Real Detected Locations Overlay Layer */}
                  {showOverlays && (
                    <div className="absolute inset-0 pointer-events-none">
                      {/* Real YouCam AI Detection Mask Overlay (if returned by API) */}
                      {latestScan.youcamAnalysis?.masks && (() => {
                        const maskKey =
                          selectedCondition === 'dry' ? 'moisture' :
                          selectedCondition === 'wrinkles' ? 'wrinkle' :
                          selectedCondition === 'oily' ? 'oiliness' :
                          selectedCondition === 'normal' ? 'skin_type' :
                          selectedCondition;
                        const maskDataUrl = latestScan.youcamAnalysis.masks[maskKey] || (selectedCondition === 'normal' ? latestScan.youcamAnalysis.masks['skin_type'] : null);
                        if (!maskDataUrl) return null;
                        return (
                          <img
                            src={maskDataUrl}
                            alt={`${selectedCondition} detected mask`}
                            className="absolute inset-0 w-full h-full object-cover mix-blend-screen opacity-75 pointer-events-none transition-opacity duration-300"
                          />
                        );
                      })()}

                      {/* Acne Hotspots */}
                      {(selectedCondition === 'acne' || selectedCondition === 'all') &&
                        displayRegions.filter(r => r.type === 'acne').map((reg, idx) => (
                          <div
                            key={`acne-${idx}`}
                            className="absolute -translate-x-1/2 -translate-y-1/2 flex items-center justify-center pointer-events-auto group/marker"
                            style={{ left: `${reg.x}%`, top: `${reg.y}%` }}
                          >
                            <span className="relative flex h-6 w-6 items-center justify-center">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
                              <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-rose-500 border border-white shadow-sm shadow-rose-500" />
                            </span>
                            <div className="absolute bottom-full mb-1 hidden group-hover/marker:flex px-2 py-0.5 rounded bg-black/90 text-rose-300 text-[9px] font-mono whitespace-nowrap border border-rose-500/30">
                              {reg.label} ({reg.confidence?.toFixed(0) || 'Active'}%)
                            </div>
                          </div>
                        ))}

                      {/* Oily T-Zone Sebum Overlay */}
                      {(selectedCondition === 'oily' || selectedCondition === 'all') &&
                        displayRegions.filter(r => r.type === 'oily').map((reg, idx) => (
                          <div
                            key={`oily-${idx}`}
                            className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-400/20 border border-emerald-400/40 backdrop-blur-[1px] pointer-events-auto transition-opacity duration-300 flex items-center justify-center"
                            style={{
                              left: `${reg.x}%`,
                              top: `${reg.y}%`,
                              width: `${reg.width || 28}%`,
                              height: `${reg.height || 18}%`,
                            }}
                          >
                            <span className="text-[9px] font-bold text-emerald-300 bg-black/60 px-1.5 py-0.5 rounded border border-emerald-400/30 shadow-sm">
                              {reg.label}
                            </span>
                          </div>
                        ))}

                      {/* Dryness U-Zone Moisture Deficit Overlay */}
                      {(selectedCondition === 'dry' || selectedCondition === 'all') &&
                        displayRegions.filter(r => r.type === 'dry').map((reg, idx) => (
                          <div
                            key={`dry-${idx}`}
                            className="absolute -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-sky-500/15 border border-dashed border-sky-400/50 backdrop-blur-[1px] pointer-events-auto transition-opacity duration-300 flex items-center justify-center"
                            style={{
                              left: `${reg.x}%`,
                              top: `${reg.y}%`,
                              width: `${reg.width || 22}%`,
                              height: `${reg.height || 20}%`,
                            }}
                          >
                            <span className="text-[9px] font-bold text-sky-200 bg-black/60 px-1.5 py-0.5 rounded border border-sky-400/30 shadow-sm">
                              {reg.label}
                            </span>
                          </div>
                        ))}

                      {/* Wrinkles Expression Trajectories */}
                      {(selectedCondition === 'wrinkles' || selectedCondition === 'all') &&
                        displayRegions.filter(r => r.type === 'wrinkles').map((reg, idx) => (
                          <div
                            key={`wrinkle-${idx}`}
                            className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-indigo-500/20 border border-indigo-400/50 pointer-events-auto transition-opacity duration-300 flex items-center justify-center"
                            style={{
                              left: `${reg.x}%`,
                              top: `${reg.y}%`,
                              width: `${reg.width || 24}%`,
                              height: `${reg.height || 8}%`,
                            }}
                          >
                            <span className="text-[8px] font-mono font-bold text-indigo-200 bg-black/70 px-1 py-0.2 rounded border border-indigo-400/30">
                              {reg.label}
                            </span>
                          </div>
                        ))}

                      {/* Normal Balanced Shield Aura */}
                      {(selectedCondition === 'normal') && (
                        <div
                          className="absolute inset-x-8 inset-y-6 rounded-[45%] border-2 border-emerald-400/35 bg-emerald-500/5 pointer-events-none flex items-center justify-center shadow-[inset_0_0_30px_rgba(52,211,153,0.15)]"
                        >
                          <span className="text-[10px] font-bold text-emerald-300 bg-black/70 px-2.5 py-1 rounded-full border border-emerald-400/30 flex items-center gap-1 shadow">
                            <ShieldCheck size={12} /> Balanced Skin Barrier
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Active Layer Tag at Bottom of Face View */}
                  <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between pointer-events-none z-10">
                    <div className="bg-black/80 backdrop-blur-md px-3 py-1.5 rounded-xl border border-white/15 flex items-center gap-2 shadow-lg">
                      <div className={`w-2.5 h-2.5 rounded-full ${
                        selectedCondition === 'acne' ? 'bg-rose-500 animate-pulse' :
                        selectedCondition === 'oily' ? 'bg-emerald-400 animate-pulse' :
                        selectedCondition === 'dry' ? 'bg-sky-400 animate-pulse' :
                        selectedCondition === 'wrinkles' ? 'bg-indigo-400 animate-pulse' :
                        'bg-emerald-400'
                      }`} />
                      <span className="text-xs font-bold text-white tracking-wide">
                        {CATEGORY_META[selectedCondition]?.label || 'Active Condition'}
                      </span>
                    </div>

                    <div className="bg-black/80 backdrop-blur-md px-2.5 py-1.5 rounded-xl border border-white/15 text-[10px] font-mono text-white/90 shadow-lg flex items-center gap-1">
                      <Crosshair size={12} className="text-primary" />
                      <span>{showOverlays ? 'Detected Overlays' : 'Overlays Hidden'}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between text-[11px] text-on-surface-variant px-1">
                  <span className="flex items-center gap-1.5 font-medium">
                    <Scan size={13} className="text-primary" /> AI Biometric Face Alignment
                  </span>
                  <span className="text-white/50">Tap cards to highlight concerns</span>
                </div>
              </div>

              {/* 5 CLASSIFICATION BUTTONS (7 columns on medium/large screens) */}
              <div className="md:col-span-7 flex flex-col gap-3">
                {filteredClassifications.length === 0 ? (
                  <div className="py-12 text-center bg-white/5 rounded-2xl border border-white/10 flex flex-col items-center justify-center gap-3">
                    <CheckCircle2 size={36} className="text-emerald-400" />
                    <p className="text-sm font-bold text-white">No conditions in this filter</p>
                    <p className="text-xs text-on-surface-variant max-w-sm">
                      {filterMode === 'detected'
                        ? 'No active conditions detected above the 45% threshold. Skin barrier is clear and healthy.'
                        : 'All classifications have conditions detected.'}
                    </p>
                    <button
                      onClick={() => setFilterMode('all')}
                      className="mt-1 text-xs font-bold text-primary hover:underline"
                    >
                      View All 5 Classifications
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {filteredClassifications.map((item, idx) => {
                      const meta = getCategoryMeta(item.className, item.label);
                      const Icon = meta.icon;
                      const isDetected = item.detected ?? ((item.confidence ?? 0) >= 45);
                      const confidenceVal = typeof item.confidence === 'number' ? item.confidence : 0;
                      const isSelected = selectedCondition === item.className;

                      return (
                        <motion.button
                          key={item.className || item.label || idx}
                          type="button"
                          onClick={() => setSelectedCondition(item.className)}
                          whileHover={{ scale: 1.015, y: -2 }}
                          whileTap={{ scale: 0.985 }}
                          transition={{ duration: 0.2 }}
                          className={`text-left p-4 sm:p-4.5 rounded-2xl border transition-all duration-200 flex flex-col justify-between gap-3 relative overflow-hidden cursor-pointer ${
                            isSelected
                              ? 'bg-white/[0.12] border-primary shadow-xl shadow-primary/15 ring-2 ring-primary/60'
                              : isDetected
                              ? 'bg-white/[0.05] border-white/15 hover:border-white/30 hover:bg-white/[0.08]'
                              : 'bg-white/[0.025] border-white/10 hover:border-white/20 hover:bg-white/[0.05]'
                          }`}
                        >
                          {/* Active Selection Glow Accent */}
                          {isSelected && (
                            <div className="absolute top-0 right-0 w-24 h-24 bg-primary/20 rounded-full blur-2xl pointer-events-none" />
                          )}

                          {/* Top Header: Category Icon, Label, Status Badge */}
                          <div className="flex items-start justify-between gap-2 relative z-10">
                            <div className="flex items-center gap-3 min-w-0">
                              <div className={`w-9 h-9 rounded-xl flex items-center justify-center bg-gradient-to-br ${meta.accentColor} text-white shadow-md shrink-0`}>
                                <Icon size={18} />
                              </div>
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <h5 className="font-extrabold text-white text-sm sm:text-base tracking-tight truncate">
                                    {meta.label}
                                  </h5>
                                  {isSelected && (
                                    <span className="w-2 h-2 rounded-full bg-primary animate-pulse" title="Selected" />
                                  )}
                                </div>
                                <span className="text-[11px] text-on-surface-variant truncate block font-normal">
                                  {meta.description}
                                </span>
                              </div>
                            </div>

                            {isDetected ? (
                              <span className="px-2.5 py-1 rounded-full text-[10px] font-bold border border-rose-500/40 text-rose-300 bg-rose-500/15 flex items-center gap-1 shrink-0 shadow-sm">
                                <AlertCircle size={11} /> Detected
                              </span>
                            ) : (
                              <span className="px-2.5 py-1 rounded-full text-[10px] font-medium border border-white/10 text-slate-300 bg-white/5 flex items-center gap-1 shrink-0">
                                <CheckCircle size={11} className="text-emerald-400" /> Clear
                              </span>
                            )}
                          </div>

                          {/* Score & Severity Info */}
                          <div className="flex items-baseline justify-between pt-1 relative z-10">
                            <div>
                              <span className="text-[10px] text-on-surface-variant uppercase tracking-wider font-semibold block">
                                Confidence
                              </span>
                              <span className={`text-2xl font-black font-mono tracking-tight ${isSelected ? 'text-white drop-shadow' : isDetected ? 'text-white' : 'text-slate-300'}`}>
                                {confidenceVal.toFixed(1)}%
                              </span>
                            </div>

                            <div className="text-right">
                              <span className="text-[10px] text-on-surface-variant uppercase tracking-wider font-semibold block">
                                Severity Rating
                              </span>
                              <span className={`text-xs font-bold ${isDetected ? 'text-primary' : 'text-emerald-400'}`}>
                                {item.severity || (isDetected ? 'Moderate' : 'Clear')}
                              </span>
                            </div>
                          </div>

                          {/* Calibrated Threshold Bar */}
                          <div className="flex flex-col gap-1 relative z-10">
                            <div className="w-full h-2 bg-black/60 rounded-full overflow-hidden border border-white/10 relative">
                              <div
                                className="absolute top-0 bottom-0 w-[2px] bg-white/50 z-10"
                                style={{ left: '45%' }}
                                title="45% Detection Threshold"
                              />
                              <div
                                className={`h-full rounded-full transition-all duration-500 ${
                                  isDetected
                                    ? `bg-gradient-to-r ${meta.accentColor}`
                                    : 'bg-slate-500/50'
                                }`}
                                style={{ width: `${Math.min(100, Math.max(4, confidenceVal))}%` }}
                              />
                            </div>

                            <div className="flex justify-between items-center text-[9px] text-on-surface-variant px-0.5">
                              <span>0%</span>
                              <span className="text-white/40 font-mono">45% Threshold</span>
                              <span>100%</span>
                            </div>
                          </div>

                          {/* Interactive Inspection Hint */}
                          <div className="pt-2 border-t border-white/5 flex items-center justify-between text-[11px] relative z-10">
                            <span className={isSelected ? 'text-primary font-bold' : 'text-on-surface-variant'}>
                              {isSelected ? '✓ Showing on face scan' : 'Tap to highlight on face'}
                            </span>
                            <span className="text-on-surface-variant font-mono text-[10px]">
                              {isDetected ? 'Exceeds threshold' : 'Clear & healthy'}
                            </span>
                          </div>
                        </motion.button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Primary Metrics Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 relative z-10 mb-4">
            {[
              { 
                label: 'Acne Severity', 
                value: (latestScan.acneSeverity === 'Not Detected' || latestScan.acneDetected === false) ? 'Not Detected' : latestScan.acneSeverity, 
                sub: (latestScan.acneSeverity === 'Not Detected' || latestScan.acneDetected === false) ? '0 Spots' : `${latestScan.acneScore}/100` 
              },
              { label: 'Hydration', value: `${latestScan.hydration}%`, delta: deltas.hydration },
              { label: 'Texture Score', value: `${latestScan.texture}%`, delta: deltas.texture },
              { label: 'UV Damage', value: latestScan.uvDamage, sub: `${latestScan.uvScore}/100` },
            ].map(m => (
              <div key={m.label} className="bg-white/5 p-3.5 rounded-xl border border-white/5 text-center">
                <p className="text-xs text-on-surface-variant mb-1 font-medium">{m.label}</p>
                <span className="text-xl font-bold text-white">{m.value}</span>
                {m.sub && <p className="text-[10px] text-on-surface-variant mt-0.5">{m.sub}</p>}
                {m.delta !== undefined && prevScan && (
                  <div className="mt-1 flex justify-center"><TrendBadge delta={m.delta} /></div>
                )}
              </div>
            ))}
          </div>

          {/* Gemini AI Summary */}
          {latestScan.aiExplanation && (
            <div className="mt-4 pt-4 border-t border-white/10 text-xs text-on-surface-variant leading-relaxed relative z-10">
              <span className="text-primary font-bold block mb-1 flex items-center gap-1.5 text-sm">
                <Sparkles size={16} /> Gemini AI Summary:
              </span>
              <p className="text-xs text-slate-200 leading-relaxed font-normal">{cleanAiSummaryText(latestScan.aiExplanation)}</p>
            </div>
          )}
        </GlassCard>

        {/* Skincare Routine & Natural Lifestyle Section */}
        <GlassCard className="p-6 relative overflow-hidden flex flex-col gap-6">
          <div>
            <h3 className="text-xl font-bold text-white mb-1 flex items-center gap-2">
              <CheckCircle2 className="text-primary" size={20} />
              Personalized Daily Skincare Routine
            </h3>
            <p className="text-xs text-on-surface-variant">
              Tailored daily routine customized to your current skin health and hydration profile.
            </p>
          </div>

          {/* Morning & Night Routine Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs">
            {/* Morning Routine */}
            <div className="bg-white/5 p-4 rounded-2xl border border-white/10">
              <h4 className="font-bold text-primary text-sm mb-3 flex items-center gap-1.5">
                <Sun size={16} /> Morning Routine (AM)
              </h4>
              <div className="space-y-3">
                {(activeRoutine?.morning || []).map(step => (
                  <div
                    key={step.id}
                    className={`p-3 rounded-xl border ${
                      step.category === 'lifestyle'
                        ? 'bg-emerald-500/8 border-emerald-500/20'
                        : 'bg-white/5 border-white/5'
                    }`}
                  >
                    <p className="font-bold text-white text-xs flex items-center gap-1.5">
                      {step.category === 'lifestyle' && <Leaf size={12} className="text-emerald-400" />}
                      Step {step.step}: {step.title}
                    </p>
                    <p className={`font-medium mt-0.5 ${
                      step.category === 'lifestyle' ? 'text-emerald-300' : 'text-primary'
                    }`}>{step.productName}</p>
                    <p className="text-[11px] text-on-surface-variant mt-1">{step.reason}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Night Routine */}
            <div className="bg-white/5 p-4 rounded-2xl border border-white/10">
              <h4 className="font-bold text-secondary text-sm mb-3 flex items-center gap-1.5">
                <Moon size={16} /> Night Routine (PM)
              </h4>
              <div className="space-y-3">
                {(activeRoutine?.night || []).map(step => (
                  <div
                    key={step.id}
                    className={`p-3 rounded-xl border ${
                      step.category === 'lifestyle'
                        ? 'bg-emerald-500/8 border-emerald-500/20'
                        : 'bg-white/5 border-white/5'
                    }`}
                  >
                    <p className="font-bold text-white text-xs flex items-center gap-1.5">
                      {step.category === 'lifestyle' && <Leaf size={12} className="text-emerald-400" />}
                      Step {step.step}: {step.title}
                    </p>
                    <p className={`font-medium mt-0.5 ${
                      step.category === 'lifestyle' ? 'text-emerald-300' : 'text-secondary'
                    }`}>{step.productName}</p>
                    <p className="text-[11px] text-on-surface-variant mt-1">{step.reason}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </GlassCard>
      </div>

      {/* ── RIGHT COLUMN — Recommended Products with QR Modal ────────────────── */}
      <div className="w-full xl:w-[400px] flex flex-col gap-6">
        <div>
          <h3 className="text-xl font-bold flex items-center gap-2 mb-1">
            <ShoppingBag className="text-primary" size={20} />
            Recommended Products
          </h3>
          <p className="text-xs text-on-surface-variant">
            Genuinely personalized products tailored to your full skin profile. Tap any card to open the purchase QR code.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 gap-5">
          {recommendations.map(rec => {
            const isLoading = qrLoadingId === rec.id;

            return (
              <GlassCard
                key={rec.id}
                onClick={() => handleOpenProductQr(rec)}
                className="p-5 flex flex-col justify-between cursor-pointer hover:border-primary/50 transition-all hover:scale-[1.01] group relative overflow-hidden"
              >
                <div className="aspect-video w-full rounded-xl overflow-hidden relative mb-3 bg-black/40 border border-white/5">
                  <img
                    src={rec.image}
                    alt={rec.name}
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = '/product-images/cetaphil-gentle-cleanser.png';
                    }}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                  <div className="absolute bottom-2 left-2 bg-background/90 backdrop-blur px-2.5 py-0.5 rounded-md text-[10px] font-bold text-primary border border-white/10 uppercase">
                    {rec.targetIssue}
                  </div>
                  <div className="absolute top-2 right-2 bg-emerald-500 text-black px-2.5 py-0.5 rounded-md text-xs font-extrabold shadow">
                    {rec.price || '₹599'}
                  </div>
                </div>

                <div>
                  <span className="text-[10px] font-bold uppercase text-primary tracking-wider">{rec.brand}</span>
                  <h4 className="font-bold text-sm leading-tight mb-1 text-white group-hover:text-primary transition-colors">{rec.name}</h4>
                  <p className="text-xs text-on-surface-variant leading-relaxed line-clamp-2">{rec.description}</p>
                  <p className="text-[11px] text-emerald-400 mt-2 font-medium">Why: {rec.whyRecommended}</p>
                </div>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleOpenProductQr(rec);
                  }}
                  disabled={isLoading}
                  className="w-full mt-4 py-2.5 rounded-xl bg-primary/10 border border-primary/30 text-xs font-bold hover:bg-primary hover:text-on-primary transition-all flex items-center justify-center gap-2 text-primary shadow"
                >
                  <QrCode size={16} />
                  {isLoading ? 'Generating QR Code…' : 'Tap to Buy via Purchase QR Code'}
                </button>
              </GlassCard>
            );
          })}
        </div>
      </div>

      {/* Product Purchase QR Modal */}
      {selectedProductQr && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md flex items-center justify-center z-50 p-4 sm:p-6">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-surface-container border border-white/20 p-6 sm:p-8 rounded-3xl max-w-sm w-full text-center flex flex-col items-center gap-4 relative shadow-2xl"
          >
            <button
              onClick={() => {
                setSelectedProductQr(null);
                setProductQrError('');
              }}
              className="absolute top-4 right-4 p-2 text-on-surface-variant hover:text-white rounded-full bg-white/5 hover:bg-white/10 transition-colors"
            >
              <X size={18} />
            </button>

            <span className="text-xs font-bold text-primary uppercase tracking-widest">{selectedProductQr.rec.brand}</span>
            <h3 className="text-lg font-bold text-white leading-tight -mt-2">{selectedProductQr.rec.name}</h3>

            {/* Click-to-refresh QR box */}
            <div
              onClick={() => !productQrRefreshing && handleRefreshProductQr()}
              className={`p-4 bg-white rounded-2xl border border-white/20 shadow-2xl relative transition-all ${
                productQrRefreshing ? 'opacity-80' : 'cursor-pointer hover:ring-4 hover:ring-primary/40'
              }`}
              title="Click QR code to refresh"
            >
              <img src={selectedProductQr.qrUrl} alt={`QR for ${selectedProductQr.rec.name}`} className="w-52 h-52 object-contain" />
              {productQrRefreshing && (
                <div className="absolute inset-0 bg-white/80 backdrop-blur-xs flex items-center justify-center">
                  <RefreshCw size={28} className="text-slate-800 animate-spin" />
                </div>
              )}
            </div>

            <p className="text-[11px] text-on-surface-variant/70 -mt-2">
              💡 Tap QR code or click refresh below to reload
            </p>

            {productQrError && (
              <div className="p-2.5 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-xs w-full text-center">
                {productQrError}
              </div>
            )}

            <div className="bg-white/5 p-3 rounded-xl border border-white/10 w-full text-left text-xs">
              <p className="text-emerald-400 font-bold mb-1">Price: {selectedProductQr.rec.price}</p>
              <p className="text-on-surface-variant text-[11px] line-clamp-2">
                Scan with your phone camera to open the official product purchase page.
              </p>
            </div>

            <div className="flex flex-col gap-2 w-full">
              {/* Refresh Button */}
              <button
                type="button"
                onClick={handleRefreshProductQr}
                disabled={productQrRefreshing}
                className={`w-full py-2.5 px-4 rounded-xl border text-xs font-bold transition-all flex items-center justify-center gap-2 ${
                  productQrJustRefreshed
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                    : 'bg-white/10 hover:bg-white/15 text-white border-white/15'
                }`}
              >
                {productQrJustRefreshed ? (
                  <>
                    <Check size={14} className="text-emerald-400" />
                    <span>Product QR Refreshed!</span>
                  </>
                ) : (
                  <>
                    <RefreshCw size={14} className={productQrRefreshing ? 'animate-spin' : ''} />
                    <span>Refresh QR Code</span>
                  </>
                )}
              </button>

              <a
                href={selectedProductQr.rec.productUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full py-3 bg-primary text-on-primary font-bold rounded-xl hover:bg-primary-container transition-colors flex items-center justify-center gap-2 text-sm shadow-lg"
              >
                <ShoppingBag size={16} />
                Open Purchase Page ({selectedProductQr.rec.price})
              </a>

              <button
                onClick={() => {
                  setSelectedProductQr(null);
                  setProductQrError('');
                }}
                className="w-full py-2 bg-white/5 text-white/80 font-semibold rounded-xl hover:bg-white/10 transition-colors text-xs"
              >
                Close
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Report QR Modal */}
      {showReportQrModal && latestScan && (
        <ReportQRModal scan={latestScan} onClose={() => setShowReportQrModal(false)} />
      )}
    </motion.div>
  );
}
