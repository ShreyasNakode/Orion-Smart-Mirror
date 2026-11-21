import React, { useState, useEffect, useRef } from 'react';
import { Globe, X, Activity, Maximize2, Minimize2, Terminal, CheckCircle, AlertTriangle, Send, Sparkles, Hand, Play, Pause, Keyboard as KeyboardIcon } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { BrowserActivity } from '../types';
import { useAppContext } from '../context/AppContext';
import { VirtualKeyboard } from './VirtualKeyboard';

interface BrowserWindowProps {
  imageSrc: string | null;
  logs: string[];
  isVisible: boolean;
  onClose: () => void;
  onSendPrompt: (prompt: string) => void;
  activity?: BrowserActivity;
}

export function BrowserWindow({ imageSrc, logs, isVisible, onClose, onSendPrompt, activity }: BrowserWindowProps) {
  const { sendManualBrowserAction } = useAppContext();
  const [isExpanded, setIsExpanded] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [showKeyboard, setShowKeyboard] = useState(false);
  const [customPrompt, setCustomPrompt] = useState('');
  const [touchPoint, setTouchPoint] = useState<{ x: number; y: number } | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (showLogs && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, showLogs]);

  if (!isVisible) return null;

  const currentUrl = activity?.liveUrl || activity?.website || 'https://www.google.com';
  const activeTitle = activity?.activeTab || 'Orion Live Browser Agent';
  const status = activity?.status || 'running';
  const isPaused = status === 'paused';
  const step = activity?.step || 1;
  const totalSteps = activity?.totalSteps || 20;

  // Normalized cursor coordinates (1440x900 default)
  const cursorX = activity?.cursor?.x !== undefined ? (activity.cursor.x / 1440) * 100 : 50;
  const cursorY = activity?.cursor?.y !== undefined ? (activity.cursor.y / 900) * 100 : 50;
  const isClicking = activity?.cursor?.clicking || false;

  const handleSendPrompt = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!customPrompt.trim()) return;
    onSendPrompt(customPrompt.trim());
    setCustomPrompt('');
  };

  const handleViewportClick = (e: React.MouseEvent<HTMLImageElement>) => {
    if (!imgRef.current) return;
    const rect = imgRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    const normX = Math.round((clickX / rect.width) * 999);
    const normY = Math.round((clickY / rect.height) * 999);

    setTouchPoint({ x: (clickX / rect.width) * 100, y: (clickY / rect.height) * 100 });
    setTimeout(() => setTouchPoint(null), 400);

    sendManualBrowserAction({ action: 'click', x: normX, y: normY });
  };

  const handleViewportWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    sendManualBrowserAction({ action: 'scroll', deltaY: e.deltaY });
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: -20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: -20 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className={`fixed z-50 transition-all duration-300 ${
          isExpanded
            ? 'top-4 left-4 right-4 bottom-4 w-[calc(100vw-32px)] h-[calc(100vh-32px)]'
            : 'top-6 right-4 sm:right-6 w-[min(680px,calc(100vw-32px))] max-h-[88vh]'
        } flex flex-col rounded-2xl border border-primary/30 bg-surface-container/95 backdrop-blur-2xl shadow-[0_0_50px_rgba(0,0,0,0.7)] overflow-hidden`}
      >
        {/* Top Header Bar */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-surface-container-high/80 border-b border-outline-variant/30 select-none">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="relative flex items-center justify-center">
              <span className={`w-2.5 h-2.5 rounded-full ${isPaused ? 'bg-amber-400 animate-ping' : 'bg-emerald-400 animate-pulse'}`} />
              <span className={`absolute w-2.5 h-2.5 rounded-full ${isPaused ? 'bg-amber-400' : 'bg-emerald-400'}`} />
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-xs font-semibold text-primary flex items-center gap-1.5 truncate">
                <Sparkles size={13} className="text-primary animate-pulse" />
                Orion Shared Live Agent
              </span>
              <span className="text-[11px] text-on-surface-variant truncate">{activeTitle}</span>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowKeyboard(!showKeyboard)}
              title="Toggle Touch Virtual Keyboard"
              className={`p-1.5 rounded-lg transition-colors ${showKeyboard ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-variant/40'}`}
            >
              <KeyboardIcon size={15} />
            </button>

            <button
              onClick={() => setShowLogs(!showLogs)}
              title="Toggle Terminal Logs"
              className={`p-1.5 rounded-lg transition-colors ${showLogs ? 'bg-primary/20 text-primary' : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-variant/40'}`}
            >
              <Terminal size={15} />
            </button>

            <button
              onClick={() => setIsExpanded(!isExpanded)}
              title={isExpanded ? 'Minimize Widget' : 'Expand Full Window'}
              className="p-1.5 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-variant/40 transition-colors"
            >
              {isExpanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </button>

            <button
              onClick={onClose}
              title="Close Browser View"
              className="p-1.5 rounded-lg text-on-surface-variant hover:text-error hover:bg-error/10 transition-colors"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Address Bar */}
        <div className="flex items-center gap-2 px-3 py-1.5 bg-black/40 border-b border-outline-variant/20 text-xs">
          <Globe size={13} className="text-primary shrink-0" />
          <input
            type="text"
            readOnly
            value={currentUrl}
            className="w-full bg-transparent text-on-surface-variant text-[11px] font-mono outline-none truncate select-all"
          />
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-mono shrink-0">
            Step {step}/{totalSteps}
          </span>
        </div>

        {/* Live Stream Interactive Viewport Area */}
        <div
          onWheel={handleViewportWheel}
          className={`relative bg-black flex-1 min-h-[340px] overflow-hidden group flex items-center justify-center cursor-crosshair ${isExpanded ? 'h-full' : 'h-[380px]'}`}
        >
          {imageSrc ? (
            <img
              ref={imgRef}
              onClick={handleViewportClick}
              src={imageSrc.startsWith('data:') ? imageSrc : `data:image/jpeg;base64,${imageSrc}`}
              alt="Orion Live Browser View"
              className="w-full h-full object-contain select-none cursor-pointer"
            />
          ) : (
            <div className="flex flex-col items-center justify-center p-6 text-center gap-3">
              <div className="w-10 h-10 rounded-full border-2 border-primary border-t-transparent animate-spin flex items-center justify-center" />
              <p className="text-xs text-on-surface-variant font-medium">Connecting to live browser stream...</p>
            </div>
          )}

          {/* User Touch Click Feedback Ripple */}
          {touchPoint && (
            <span
              className="absolute w-8 h-8 rounded-full border-2 border-emerald-400 bg-emerald-400/30 animate-ping pointer-events-none -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${touchPoint.x}%`, top: `${touchPoint.y}%` }}
            />
          )}

          {/* AI Cursor Pointer */}
          {imageSrc && (
            <div
              className="absolute pointer-events-none transition-all duration-75 ease-out -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${cursorX}%`, top: `${cursorY}%` }}
            >
              {isClicking && (
                <span className="absolute -inset-3 rounded-full border-2 border-primary animate-ping opacity-75" />
              )}
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className="drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]">
                <path
                  d="M3 3l7 18 3-7 7-3L3 3z"
                  fill="#00E5FF"
                  stroke="#ffffff"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          )}

          {/* Action Overlay Message */}
          {activity?.message && (
            <div className="absolute bottom-3 left-3 right-3 bg-black/75 backdrop-blur-md border border-primary/30 rounded-xl p-2.5 text-xs text-on-surface flex items-center gap-2 shadow-lg">
              <Activity size={14} className="text-primary animate-pulse shrink-0" />
              <span className="truncate font-medium text-[11px]">{activity.message}</span>
            </div>
          )}
        </div>

        {/* Virtual Keyboard Drawer */}
        <AnimatePresence>
          {showKeyboard && (
            <VirtualKeyboard
              onKeyPress={(key, isSpecial) => {
                if (isSpecial) {
                  sendManualBrowserAction({ action: 'key', key });
                } else {
                  sendManualBrowserAction({ action: 'type', text: key });
                }
              }}
              onClose={() => setShowKeyboard(false)}
            />
          )}
        </AnimatePresence>

        {/* Human-in-the-Loop Handoff / Confirmation Banner */}
        {isPaused && (
          <div className="p-3 bg-amber-500/10 border-t border-amber-500/30 flex flex-col gap-2">
            <div className="flex items-center gap-2 text-amber-400 text-xs font-semibold">
              <AlertTriangle size={15} />
              <span>User Intervention Active</span>
            </div>
            <p className="text-[11px] text-on-surface-variant">
              {activity?.message || 'Manual control active. Click "Resume Agent" when ready for AI to continue.'}
            </p>
            <div className="flex items-center gap-2 mt-1">
              <button
                onClick={() => onSendPrompt('continue')}
                className="flex-1 py-1.5 px-3 rounded-lg bg-emerald-500 text-black font-semibold text-xs hover:bg-emerald-400 transition-colors flex items-center justify-center gap-1"
              >
                <Play size={13} />
                <span>Resume AI Agent</span>
              </button>
              <button
                onClick={() => onSendPrompt('No, cancel this action.')}
                className="flex-1 py-1.5 px-3 rounded-lg bg-surface-variant text-on-surface text-xs hover:bg-surface-variant/80 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Terminal Logs Drawer */}
        {showLogs && (
          <div className="h-32 bg-black/90 border-t border-outline-variant/30 p-2.5 overflow-y-auto font-mono text-[10px] text-emerald-400 space-y-1">
            <div className="text-on-surface-variant font-sans font-bold text-[9px] uppercase tracking-wider mb-1 flex items-center justify-between">
              <span>Browser Agent Logs</span>
              <button onClick={() => setShowLogs(false)} className="hover:text-on-surface">Close</button>
            </div>
            {logs.length > 0 ? (
              logs.map((log, i) => (
                <div key={i} className="leading-tight break-all">
                  <span className="text-on-surface-variant select-none">&gt; </span>
                  {log}
                </div>
              ))
            ) : (
              <div className="text-on-surface-variant/60 italic">No logs captured yet...</div>
            )}
            <div ref={logsEndRef} />
          </div>
        )}

        {/* Quick Voice / Text Command Bar */}
        <form onSubmit={handleSendPrompt} className="p-2.5 bg-surface-container-high/90 border-t border-outline-variant/30 flex items-center gap-2">
          <input
            type="text"
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            placeholder="Type or speak a voice command (e.g. 'click buy now', 'continue', 'search shoes')..."
            className="flex-1 bg-surface-container border border-outline-variant/30 rounded-xl px-3 py-1.5 text-xs text-on-surface placeholder:text-on-surface-variant/50 outline-none focus:border-primary/50 transition-colors"
          />
          <button
            type="submit"
            className="p-1.5 rounded-xl bg-primary text-on-primary hover:bg-primary/90 transition-colors"
            title="Send Command"
          >
            <Send size={14} />
          </button>
        </form>
      </motion.div>
    </AnimatePresence>
  );
}
