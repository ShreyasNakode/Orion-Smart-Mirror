import React, { useState } from 'react';
import { motion } from 'motion/react';
import { GlassCard } from '../components/GlassCard';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip } from 'recharts';
import { 
  ScanFace, 
  TrendingUp, 
  ShieldCheck, 
  Sparkles, 
  Download, 
  QrCode, 
  Droplets,
  Activity,
  X,
  Calendar,
  Layers,
  FileText
} from 'lucide-react';
import { useAppContext } from '../context/AppContext';
import { downloadReportFile, generateQRCodeDataUrl, getMobileReportURL } from '../lib/reportGenerator';
import { SkinAnalysisRecord } from '../types';
import { navigateToDashboard } from '../lib/dashboardRoutes';
import { ReportQRModal } from '../components/ReportQRModal';

export function Health() {
  const { gallery } = useAppContext();
  const [trendRange, setTrendRange] = useState<'7d' | '30d' | '90d'>('30d');
  const [activeQrScan, setActiveQrScan] = useState<SkinAnalysisRecord | null>(null);

  const latestScan: SkinAnalysisRecord | null = gallery.length > 0 ? gallery[0] : null;
  const prevScan: SkinAnalysisRecord | null = gallery.length > 1 ? gallery[1] : null;

  // gallery is stored newest-first. Reverse to get chronological order (oldest to newest)
  const sortedGallery = [...gallery].reverse();
  const displayRangeCount = trendRange === '7d' ? 7 : trendRange === '30d' ? 30 : 90;
  const filteredGallery = sortedGallery.slice(-displayRangeCount);
  const hasHistory = sortedGallery.length >= 2;

  // Calculate actual progress between first and latest scan in the selected window
  const overallProgress = hasHistory
    ? (filteredGallery[filteredGallery.length - 1].score ?? 0) - (filteredGallery[0].score ?? 0)
    : 0;

  // Only real scan data is plotted on the chart
  const chartData = hasHistory
    ? filteredGallery.map((g, idx) => {
        const formattedDate = g.date
          ? new Date(g.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
          : '';
        const label = formattedDate ? `${formattedDate} (#${idx + 1})` : `Scan #${idx + 1}`;
        return {
          day: label,
          score: g.score ?? 0,
          hydration: g.hydration ?? 0,
          texture: g.texture ?? 0,
        };
      })
    : [];

  const handleShowReportQR = (scanToUse?: SkinAnalysisRecord | null) => {
    const target = scanToUse || latestScan;
    if (target) {
      setActiveQrScan(target);
    }
  };

  return (
    <div className="w-full min-h-screen pt-6 pb-40 pl-4 pr-16 sm:px-8 max-w-[1400px] mx-auto flex flex-col gap-8 overflow-y-auto">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pl-14">
        <div>
          <h1 className="text-4xl font-extrabold tracking-tight glow-text flex items-center gap-3">
            <Activity className="text-primary" size={36} />
            Health Module
          </h1>
          <p className="text-on-surface-variant text-sm mt-1">
            Centralized health monitoring &amp; historical skin health trends.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              navigateToDashboard('skin_analysis', 'manual');
              window.dispatchEvent(new CustomEvent('orion_trigger_skin_analysis'));
            }}
            className="bg-primary text-on-primary px-6 py-3 rounded-full font-bold text-xs flex items-center gap-2 hover:bg-primary-container transition-all active:scale-95 shadow-[0_0_20px_rgba(56,189,248,0.4)] cursor-pointer"
          >
            <ScanFace size={16} />
            New Skin Analysis
          </button>

          <button
            onClick={() => handleShowReportQR(latestScan)}
            disabled={!latestScan}
            className="glass-pill px-5 py-3 rounded-full font-semibold text-xs flex items-center gap-2 hover:bg-white/10 transition-colors text-primary border border-white/10 disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
            title={latestScan ? "Generate Professional Report QR Code" : "No scan record available to generate report"}
          >
            <QrCode size={18} />
            <span>Report QR Code</span>
          </button>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {/* Overall Skin Score */}
        <GlassCard className="p-6 relative overflow-hidden">
          <div className="flex justify-between items-start mb-4">
            <span className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">Overall Skin Score</span>
            <ShieldCheck size={20} className={latestScan ? "text-secondary" : "text-on-surface-variant/40"} />
          </div>
          {latestScan ? (
            <>
              <div className="flex items-baseline gap-2">
                <span className="text-5xl font-black glow-text">{latestScan.score}%</span>
                {prevScan ? (
                  <span className={`text-xs font-bold ${latestScan.score >= prevScan.score ? 'text-secondary' : 'text-amber-400'}`}>
                    {latestScan.score >= prevScan.score ? '+' : ''}{latestScan.score - prevScan.score}% vs previous
                  </span>
                ) : (
                  <span className="text-xs text-secondary font-bold">Baseline Scan</span>
                )}
              </div>
              <p className="text-xs text-on-surface-variant mt-2 font-medium">
                Final Type: <span className="text-white font-semibold">{latestScan.finalSkinType || latestScan.classification || 'Normal'}</span>
              </p>
            </>
          ) : (
            <>
              <div className="flex items-baseline gap-2">
                <span className="text-5xl font-black text-on-surface-variant/40">--</span>
                <span className="text-xs text-on-surface-variant/60 font-medium">No Data</span>
              </div>
              <p className="text-xs text-on-surface-variant/60 mt-2 font-medium">
                Final Type: <span className="text-on-surface-variant/80 font-normal">No Scans Recorded</span>
              </p>
            </>
          )}
        </GlassCard>

        {/* Acne Severity */}
        <GlassCard className="p-6 relative overflow-hidden">
          <div className="flex justify-between items-start mb-4">
            <span className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">Acne Severity</span>
            <Sparkles size={20} className={latestScan ? "text-primary" : "text-on-surface-variant/40"} />
          </div>
          {latestScan ? (
            <>
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-extrabold text-white">{latestScan.acneSeverity || 'Mild'}</span>
                <span className="text-xs text-on-surface-variant">({latestScan.acneScore ?? 0}/100)</span>
              </div>
              <p className="text-xs text-on-surface-variant mt-2 font-medium">
                {(latestScan.acneScore ?? 0) > 35 ? 'Active blemishes detected' : 'Blemish activity controlled'}
              </p>
            </>
          ) : (
            <>
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-extrabold text-on-surface-variant/40">--</span>
              </div>
              <p className="text-xs text-on-surface-variant/60 mt-2 font-medium">No scan record</p>
            </>
          )}
        </GlassCard>

        {/* Dermal Hydration */}
        <GlassCard className="p-6 relative overflow-hidden">
          <div className="flex justify-between items-start mb-4">
            <span className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">Dermal Hydration</span>
            <Droplets size={20} className={latestScan ? "text-primary" : "text-on-surface-variant/40"} />
          </div>
          {latestScan ? (
            <>
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-extrabold text-white">{latestScan.hydration}%</span>
                <span className={`text-xs font-bold ${latestScan.hydration >= 70 ? 'text-secondary' : latestScan.hydration >= 50 ? 'text-amber-400' : 'text-rose-400'}`}>
                  {latestScan.hydration >= 75 ? 'Optimal' : latestScan.hydration >= 50 ? 'Moderate' : 'Low'}
                </span>
              </div>
              <p className="text-xs text-on-surface-variant mt-2 font-medium">
                {latestScan.hydration >= 75 ? 'Epidermal moisture locked in' : 'Hydration support recommended'}
              </p>
            </>
          ) : (
            <>
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-extrabold text-on-surface-variant/40">--</span>
              </div>
              <p className="text-xs text-on-surface-variant/60 mt-2 font-medium">No scan record</p>
            </>
          )}
        </GlassCard>

        {/* Texture Smoothness */}
        <GlassCard className="p-6 relative overflow-hidden">
          <div className="flex justify-between items-start mb-4">
            <span className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">Texture Smoothness</span>
            <TrendingUp size={20} className={latestScan ? "text-secondary" : "text-on-surface-variant/40"} />
          </div>
          {latestScan ? (
            <>
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-extrabold text-white">{latestScan.texture}%</span>
                <span className={`text-xs font-bold ${latestScan.texture >= 75 ? 'text-secondary' : 'text-amber-400'}`}>
                  {latestScan.texture >= 75 ? 'Smooth' : 'Irregular'}
                </span>
              </div>
              <p className="text-xs text-on-surface-variant mt-2 font-medium">Smoothness index</p>
            </>
          ) : (
            <>
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-extrabold text-on-surface-variant/40">--</span>
              </div>
              <p className="text-xs text-on-surface-variant/60 mt-2 font-medium">No scan record</p>
            </>
          )}
        </GlassCard>
      </div>

      {/* Historical Progress Chart */}
      <GlassCard className="p-8 flex flex-col">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h3 className="text-xl font-bold">Historical Skin Health Progress</h3>
            <p className="text-xs text-on-surface-variant">Skin evaluation timeline across recent analysis records</p>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex bg-white/5 p-1 rounded-xl border border-white/10">
              {(['7d', '30d', '90d'] as const).map(range => (
                <button
                  key={range}
                  onClick={() => setTrendRange(range)}
                  className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    trendRange === range ? 'bg-primary text-on-primary shadow' : 'text-on-surface-variant hover:text-white'
                  }`}
                >
                  {range.toUpperCase()}
                </button>
              ))}
            </div>

            {hasHistory ? (
              <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold ${
                overallProgress >= 0 ? 'text-primary bg-primary/10' : 'text-amber-400 bg-amber-400/10'
              }`}>
                <TrendingUp size={14} /> {overallProgress >= 0 ? '+' : ''}{overallProgress}% Overall Progress
              </div>
            ) : sortedGallery.length === 1 ? (
              <div className="flex items-center gap-1.5 text-secondary bg-secondary/10 px-3 py-1.5 rounded-xl text-xs font-semibold">
                1 Record (Baseline)
              </div>
            ) : null}
          </div>
        </div>

        {sortedGallery.length === 0 ? (
          <div className="w-full h-[320px] flex flex-col items-center justify-center text-center p-6 bg-white/[0.02] border border-dashed border-white/10 rounded-2xl">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-3 text-primary">
              <Activity size={28} />
            </div>
            <h4 className="text-base font-bold text-white mb-1">No Historical Skin Data Available</h4>
            <p className="text-xs text-on-surface-variant max-w-sm mb-4">
              Skin health progression, hydration trends, and texture analytics will be plotted here after you perform your skin scans.
            </p>
            <button
              onClick={() => {
                navigateToDashboard('skin_analysis', 'manual');
                window.dispatchEvent(new CustomEvent('orion_trigger_skin_analysis'));
              }}
              className="bg-primary text-on-primary px-5 py-2.5 rounded-full font-bold text-xs flex items-center gap-2 hover:bg-primary-container transition-all active:scale-95 shadow-[0_0_15px_rgba(56,189,248,0.3)] cursor-pointer"
            >
              <ScanFace size={15} />
              Start First Skin Analysis
            </button>
          </div>
        ) : sortedGallery.length === 1 ? (
          <div className="w-full h-[320px] flex flex-col items-center justify-center text-center p-6 bg-white/[0.02] border border-dashed border-white/10 rounded-2xl">
            <div className="w-14 h-14 rounded-2xl bg-secondary/10 border border-secondary/20 flex items-center justify-center mb-3 text-secondary">
              <ShieldCheck size={28} />
            </div>
            <h4 className="text-base font-bold text-white mb-1">Initial Baseline Scan Recorded</h4>
            <p className="text-xs text-on-surface-variant max-w-md mb-4 leading-relaxed">
              Baseline recorded on <span className="text-white font-semibold">{new Date(sortedGallery[0].date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span> with an overall score of <span className="text-primary font-bold">{sortedGallery[0].score}%</span>. Complete a follow-up scan to plot progression curves and track your trends.
            </p>
            <button
              onClick={() => {
                navigateToDashboard('skin_analysis', 'manual');
                window.dispatchEvent(new CustomEvent('orion_trigger_skin_analysis'));
              }}
              className="glass-pill text-primary border border-primary/30 px-5 py-2.5 rounded-full font-bold text-xs flex items-center gap-2 hover:bg-primary hover:text-black transition-all active:scale-95 cursor-pointer"
            >
              <ScanFace size={15} />
              Perform Follow-up Scan
            </button>
          </div>
        ) : (
          <div className="w-full h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="scoreGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.4}/>
                    <stop offset="95%" stopColor="#38bdf8" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="hydrGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#818cf8" stopOpacity={0.4}/>
                    <stop offset="95%" stopColor="#818cf8" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <XAxis dataKey="day" stroke="#64748b" fontSize={12} tickLine={false} />
                <YAxis stroke="#64748b" fontSize={12} domain={[0, 100]} tickLine={false} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#131e30', borderColor: 'rgba(255,255,255,0.1)', borderRadius: '12px', color: '#fff' }}
                  itemStyle={{ color: '#38bdf8' }}
                />
                <Area type="monotone" dataKey="score" name="Skin Index" stroke="#38bdf8" strokeWidth={3} fillOpacity={1} fill="url(#scoreGrad)" />
                <Area type="monotone" dataKey="hydration" name="Hydration %" stroke="#818cf8" strokeWidth={2} fillOpacity={1} fill="url(#hydrGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </GlassCard>

      {/* Recent Scans List with QR Code Buttons */}
      <GlassCard className="p-8">
        <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
          <Calendar size={20} className="text-primary" />
          Recent Scans ({Math.min(3, gallery.length)} / {gallery.length} Records)
        </h3>

        {gallery.length === 0 ? (
          <div className="py-4 text-center">
            <p className="text-xs text-on-surface-variant">No scan history recorded yet. Complete a skin analysis to see your log here.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {gallery.slice(0, 3).map((scan, idx) => (
              <div key={scan.id || idx} className="p-4 bg-white/5 rounded-2xl border border-white/10 flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <span className="w-8 h-8 rounded-full bg-primary/10 text-primary font-bold text-xs flex items-center justify-center border border-primary/20">
                    #{gallery.length - idx}
                  </span>
                  <div>
                    <h4 className="font-bold text-white text-sm">{scan.finalSkinType || `${scan.classification} Skin Type`}</h4>
                    <p className="text-[11px] text-on-surface-variant">{new Date(scan.date).toLocaleString()}</p>
                  </div>
                </div>

                <div className="flex items-center gap-6 text-xs">
                  <div>
                    <span className="text-on-surface-variant block text-[10px]">Score</span>
                    <strong className="text-primary font-mono text-sm">{scan.score}%</strong>
                  </div>
                  <div>
                    <span className="text-on-surface-variant block text-[10px]">Hydration</span>
                    <strong className="text-white font-mono text-sm">{scan.hydration}%</strong>
                  </div>
                  <div>
                    <span className="text-on-surface-variant block text-[10px]">Texture</span>
                    <strong className="text-white font-mono text-sm">{scan.texture}%</strong>
                  </div>
                  <button
                    onClick={() => handleShowReportQR(scan)}
                    className="glass-pill px-3 py-2 rounded-xl transition-all text-primary border border-primary/30 flex items-center gap-1.5 text-xs font-semibold hover:bg-primary hover:text-black cursor-pointer"
                    title="Open Report QR Code"
                  >
                    <QrCode size={15} />
                    <span>QR Code</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </GlassCard>

      {/* QR Code Report Modal */}
      {activeQrScan && (
        <ReportQRModal scan={activeQrScan} onClose={() => setActiveQrScan(null)} />
      )}
    </div>
  );
}
