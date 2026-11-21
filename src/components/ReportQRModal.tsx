import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, QrCode, RefreshCw, Check } from 'lucide-react';
import { generateQRCodeDataUrl, getMobileReportURL } from '../lib/reportGenerator';
import { SkinAnalysisRecord } from '../types';

interface ReportQRModalProps {
  scan: SkinAnalysisRecord;
  onClose: () => void;
}

export function ReportQRModal({ scan, onClose }: ReportQRModalProps) {
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [reloading, setReloading] = useState(false);
  const [justReloaded, setJustReloaded] = useState(false);
  const [error, setError] = useState<string>('');

  const generateQR = async (isManualClick = false) => {
    try {
      if (isManualClick) {
        setReloading(true);
      } else {
        setLoading(true);
      }
      setError('');

      // 1. Save scan to server map
      try {
        await fetch('/api/skin/save-scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(scan),
        });
      } catch (e) {
        console.warn('Scan save request failed (offline fallback active):', e);
      }

      // 2. Generate target URL for the skin report
      const scanId = scan.id ? String(scan.id) : 'latest';
      const url = await getMobileReportURL(scanId, scan);

      // 3. Generate QR code from target URL
      const qr = await generateQRCodeDataUrl(url);
      if (!qr) {
        throw new Error('Failed to render QR code image.');
      }
      setQrCodeDataUrl(qr);

      if (isManualClick) {
        setJustReloaded(true);
        setTimeout(() => setJustReloaded(false), 2000);
      }
    } catch (err: any) {
      console.error('Failed to generate report QR:', err);
      setError(err?.message || 'Failed to generate QR code. Please try again.');
    } finally {
      setLoading(false);
      setReloading(false);
    }
  };

  useEffect(() => {
    generateQR(false);
  }, [scan]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4">
      <motion.div
        initial={{ scale: 0.92, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.92, opacity: 0 }}
        className="bg-surface-container border border-white/20 p-6 sm:p-7 rounded-3xl max-w-md w-full text-center relative shadow-2xl flex flex-col items-center gap-5 my-auto"
      >
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 text-on-surface-variant hover:text-white rounded-full bg-white/5 hover:bg-white/10 transition-colors cursor-pointer"
          aria-label="Close"
        >
          <X size={18} />
        </button>

        {/* Modal Header */}
        <div className="flex items-center gap-2 text-primary mt-1">
          <QrCode size={26} />
          <h3 className="text-xl font-extrabold text-white">QR Skin Report</h3>
        </div>

        <p className="text-xs text-on-surface-variant max-w-xs -mt-2">
          Scan with your phone camera to view your full skin diagnostic report and personalized routine.
        </p>

        {/* Clickable QR Code Card */}
        <div
          onClick={() => !loading && !reloading && generateQR(true)}
          className={`bg-white p-4 rounded-2xl inline-block shadow-2xl relative min-w-[240px] min-h-[240px] flex items-center justify-center border border-white/20 transition-all select-none ${
            loading || reloading ? 'cursor-wait' : 'cursor-pointer hover:ring-4 hover:ring-primary/40 hover:scale-[1.02] active:scale-[0.98]'
          }`}
          title="Click to reload QR code"
        >
          {loading ? (
            <div className="w-56 h-56 flex items-center justify-center text-slate-700 text-xs font-semibold">
              <div className="flex flex-col items-center gap-2">
                <div className="w-8 h-8 border-3 border-slate-300 border-t-sky-500 rounded-full animate-spin" />
                <span>Generating QR Code...</span>
              </div>
            </div>
          ) : error || !qrCodeDataUrl ? (
            <div className="w-56 h-56 flex flex-col items-center justify-center gap-3 text-red-500 text-xs font-semibold text-center p-4">
              <span>{error || 'Could not load QR code'}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  generateQR(true);
                }}
                className="px-3 py-1.5 bg-slate-900 text-white rounded-lg flex items-center gap-1.5 hover:bg-slate-800 transition-colors text-[11px] cursor-pointer"
              >
                <RefreshCw size={12} /> Retry
              </button>
            </div>
          ) : (
            <div className="relative group">
              <img src={qrCodeDataUrl} alt="QR Skin Report" className="w-56 h-56 object-contain" />
              
              {/* Reloading Spinner Overlay */}
              {reloading && (
                <div className="absolute inset-0 bg-white/85 backdrop-blur-xs flex flex-col items-center justify-center gap-2 rounded-xl">
                  <RefreshCw size={32} className="text-primary animate-spin" />
                  <span className="text-[11px] font-bold text-slate-800">Reloading...</span>
                </div>
              )}

              {/* Reloaded Success Toast Overlay */}
              <AnimatePresence>
                {justReloaded && !reloading && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.85 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.85 }}
                    className="absolute inset-0 bg-white/90 backdrop-blur-xs flex flex-col items-center justify-center gap-2 rounded-xl"
                  >
                    <div className="w-10 h-10 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow-md">
                      <Check size={22} className="stroke-[3]" />
                    </div>
                    <span className="text-xs font-extrabold text-emerald-700">QR Code Reloaded!</span>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>

        {/* Done Button */}
        <button
          onClick={onClose}
          className="w-full py-3 bg-primary text-on-primary font-bold rounded-xl hover:bg-primary-container transition-colors text-sm shadow-md mt-1 cursor-pointer"
        >
          Done
        </button>
      </motion.div>
    </div>
  );
}

