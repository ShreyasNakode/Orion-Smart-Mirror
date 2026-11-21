import React, { useState, useEffect, useRef } from 'react';
import { 
  Globe, ArrowLeft, ArrowRight, RotateCw, ExternalLink, 
  Lock, ShieldAlert, Maximize2, Minimize2, Keyboard as KeyboardIcon, 
  Home, Zap, MapPin, Radio, Settings, Sparkles
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { VirtualKeyboard } from './VirtualKeyboard';

declare global {
  interface Window {
    electron?: {
      shell?: {
        openExternal: (url: string) => void;
      };
    };
  }
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement> & {
        src?: string;
        partition?: string;
        allowpopups?: boolean | string;
        webpreferences?: string;
        autosize?: boolean | string;
        nodeintegration?: boolean | string;
        disablewebsecurity?: boolean | string;
      }, HTMLElement>;
    }
  }
}

const DEFAULT_HA_URL = 'http://homeassistant.local:8123/home/overview';
const STORAGE_KEY_HA_URL = 'orion_ha_url';

interface HomeAssistantWebViewProps {
  className?: string;
  isCompact?: boolean;
}

export function HomeAssistantWebView({ className, isCompact = false }: HomeAssistantWebViewProps) {
  const [url, setUrl] = useState<string>(() => {
    return localStorage.getItem(STORAGE_KEY_HA_URL) || DEFAULT_HA_URL;
  });
  const [inputUrl, setInputUrl] = useState<string>(url);
  const [currentNavUrl, setCurrentNavUrl] = useState<string>(url);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [canGoBack, setCanGoBack] = useState<boolean>(false);
  const [canGoForward, setCanGoForward] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [showKeyboard, setShowKeyboard] = useState<boolean>(false);
  const [isElectronEnv, setIsElectronEnv] = useState<boolean>(false);

  const webviewRef = useRef<any>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const isElectron = typeof window !== 'undefined' && /Electron/i.test(navigator.userAgent);
    setIsElectronEnv(isElectron);
  }, []);

  // Sync saved URL to local storage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_HA_URL, url);
    setInputUrl(url);
    setCurrentNavUrl(url);
  }, [url]);

  // Bind webview event listeners when running under Electron
  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview || !isElectronEnv) return;

    const handleStartLoading = () => setIsLoading(true);
    const handleStopLoading = () => {
      setIsLoading(false);
      updateNavigationState();
    };
    const handleNavigate = (e: any) => {
      if (e.url) {
        setCurrentNavUrl(e.url);
        setInputUrl(e.url);
      }
      updateNavigationState();
    };

    const updateNavigationState = () => {
      try {
        if (webview && typeof webview.canGoBack === 'function') {
          setCanGoBack(webview.canGoBack());
        }
        if (webview && typeof webview.canGoForward === 'function') {
          setCanGoForward(webview.canGoForward());
        }
      } catch (_) {}
    };

    webview.addEventListener('did-start-loading', handleStartLoading);
    webview.addEventListener('did-stop-loading', handleStopLoading);
    webview.addEventListener('did-navigate', handleNavigate);
    webview.addEventListener('did-navigate-in-page', handleNavigate);
    webview.addEventListener('dom-ready', updateNavigationState);

    return () => {
      webview.removeEventListener('did-start-loading', handleStartLoading);
      webview.removeEventListener('did-stop-loading', handleStopLoading);
      webview.removeEventListener('did-navigate', handleNavigate);
      webview.removeEventListener('did-navigate-in-page', handleNavigate);
      webview.removeEventListener('dom-ready', updateNavigationState);
    };
  }, [isElectronEnv, url]);

  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    let formattedUrl = inputUrl.trim();
    if (!formattedUrl) formattedUrl = DEFAULT_HA_URL;
    if (!/^https?:\/\//i.test(formattedUrl)) {
      formattedUrl = `http://${formattedUrl}`;
    }
    setUrl(formattedUrl);
  };

  const handleResetUrl = () => {
    setUrl(DEFAULT_HA_URL);
  };

  const handleGoBack = () => {
    if (isElectronEnv && webviewRef.current?.canGoBack?.()) {
      webviewRef.current.goBack();
    }
  };

  const handleGoForward = () => {
    if (isElectronEnv && webviewRef.current?.canGoForward?.()) {
      webviewRef.current.goForward();
    }
  };

  const handleReload = () => {
    setIsLoading(true);
    if (isElectronEnv && webviewRef.current) {
      webviewRef.current.reload();
    } else if (iframeRef.current) {
      iframeRef.current.src = url;
    }
    setTimeout(() => setIsLoading(false), 1000);
  };

  const handleQuickNavigate = (path: string) => {
    try {
      const baseUrl = new URL(url).origin;
      const targetUrl = `${baseUrl}${path}`;
      setUrl(targetUrl);
    } catch {
      setUrl(`http://homeassistant.local:8123${path}`);
    }
  };

  const handleOpenExternal = () => {
    if (window.electron?.shell?.openExternal) {
      window.electron.shell.openExternal(currentNavUrl);
    } else {
      window.open(currentNavUrl, '_blank', 'noopener,noreferrer');
    }
  };

  const isHttps = currentNavUrl.startsWith('https://');

  return (
    <div className={cn(
      "flex flex-col rounded-3xl border border-white/10 bg-surface-container/90 backdrop-blur-2xl shadow-2xl overflow-hidden transition-all duration-300",
      isFullscreen 
        ? "fixed inset-4 z-50 h-[calc(100vh-32px)] w-[calc(100vw-32px)]" 
        : isCompact ? "h-[500px] w-full" : "h-[750px] w-full",
      className
    )}>
      {/* Top Header Control Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 bg-surface-container-high/80 border-b border-white/10 select-none">
        
        {/* Left Controls: Navigation Buttons & Quick Shortcuts */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleGoBack}
            disabled={!canGoBack}
            className="p-2 rounded-xl bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:pointer-events-none transition-colors text-on-surface"
            title="Go Back"
          >
            <ArrowLeft size={16} />
          </button>
          
          <button
            onClick={handleGoForward}
            disabled={!canGoForward}
            className="p-2 rounded-xl bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:pointer-events-none transition-colors text-on-surface"
            title="Go Forward"
          >
            <ArrowRight size={16} />
          </button>

          <button
            onClick={handleReload}
            className={cn(
              "p-2 rounded-xl bg-white/5 hover:bg-white/10 transition-colors text-on-surface",
              isLoading && "animate-spin text-primary"
            )}
            title="Reload Page"
          >
            <RotateCw size={16} />
          </button>

          {/* Quick HA Section Pills */}
          <div className="hidden lg:flex items-center gap-1.5 ml-2 pl-2 border-l border-white/10">
            <button
              onClick={() => handleQuickNavigate('/home/overview')}
              className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-primary/20 hover:text-primary transition-colors text-xs font-semibold flex items-center gap-1 text-on-surface-variant"
              title="Overview Dashboard"
            >
              <Home size={13} />
              <span>Overview</span>
            </button>
            <button
              onClick={() => handleQuickNavigate('/energy')}
              className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-amber-400/20 hover:text-amber-400 transition-colors text-xs font-semibold flex items-center gap-1 text-on-surface-variant"
              title="Energy Dashboard"
            >
              <Zap size={13} />
              <span>Energy</span>
            </button>
            <button
              onClick={() => handleQuickNavigate('/map')}
              className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-emerald-400/20 hover:text-emerald-400 transition-colors text-xs font-semibold flex items-center gap-1 text-on-surface-variant"
              title="Map"
            >
              <MapPin size={13} />
              <span>Map</span>
            </button>
            <button
              onClick={() => handleQuickNavigate('/media-browser')}
              className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-cyan-400/20 hover:text-cyan-400 transition-colors text-xs font-semibold flex items-center gap-1 text-on-surface-variant"
              title="Media Browser"
            >
              <Radio size={13} />
              <span>Media</span>
            </button>
          </div>
        </div>

        {/* Center: Interactive URL Bar & HTTPS Security Badge */}
        <form onSubmit={handleUrlSubmit} className="flex-1 max-w-lg min-w-[240px]">
          <div className="relative flex items-center bg-black/40 border border-white/10 focus-within:border-primary/60 rounded-xl px-3 py-1.5 transition-all">
            <div className="flex items-center gap-1.5 mr-2 shrink-0">
              {isHttps ? (
                <span title="Secure HTTPS Connection"><Lock size={14} className="text-emerald-400" /></span>
              ) : (
                <span title="Local HTTP Connection"><ShieldAlert size={14} className="text-amber-400" /></span>
              )}
            </div>

            <input
              type="text"
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
              placeholder="http://homeassistant.local:8123/home/overview"
              className="w-full bg-transparent text-xs text-on-surface font-mono outline-none truncate"
            />

            {inputUrl !== DEFAULT_HA_URL && (
              <button
                type="button"
                onClick={handleResetUrl}
                className="text-[10px] text-on-surface-variant hover:text-primary px-1.5 py-0.5 rounded bg-white/5 hover:bg-white/10 shrink-0 ml-1 font-semibold transition-colors"
                title="Reset to default Home Assistant URL"
              >
                Reset
              </button>
            )}
          </div>
        </form>

        {/* Right Tools: Touch Keyboard, External Link, Fullscreen Toggle */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setShowKeyboard(!showKeyboard)}
            className={cn(
              "p-2 rounded-xl transition-colors text-on-surface-variant hover:text-on-surface",
              showKeyboard ? "bg-primary text-on-primary font-bold" : "bg-white/5 hover:bg-white/10"
            )}
            title="Toggle On-Screen Virtual Keyboard"
          >
            <KeyboardIcon size={16} />
          </button>

          <button
            onClick={handleOpenExternal}
            className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-on-surface-variant hover:text-on-surface transition-colors"
            title="Open in External Browser Window"
          >
            <ExternalLink size={16} />
          </button>

          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-on-surface-variant hover:text-on-surface transition-colors"
            title={isFullscreen ? "Exit Fullscreen View" : "Maximize Web View Fullscreen"}
          >
            {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
        </div>
      </div>

      {/* Progress Bar for Loading State */}
      {isLoading && (
        <div className="h-0.5 w-full bg-primary/20 overflow-hidden">
          <div className="h-full bg-gradient-to-r from-primary via-cyan-300 to-secondary animate-pulse w-full" />
        </div>
      )}

      {/* Web Viewport Frame */}
      <div className="relative flex-1 w-full bg-black/80 overflow-hidden">
        {isElectronEnv ? (
          <webview
            ref={webviewRef}
            src={url}
            partition="persist:homeassistant"
            {...({ allowpopups: "true" } as any)}
            webpreferences="allowrunninginsecurecontent=yes, javascript=yes"
            style={{ width: '100%', height: '100%', border: 'none', background: '#0f172a' }}
          />
        ) : (
          <iframe
            ref={iframeRef}
            src={url}
            title="Home Assistant Embedded Dashboard"
            className="w-full h-full border-none bg-slate-900"
            allow="fullscreen; autoplay; camera; microphone; clipboard-read; clipboard-write"
            sandbox="allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts allow-top-navigation-by-user-activation"
          />
        )}
      </div>

      {/* Virtual Touchscreen Keyboard Drawer */}
      <AnimatePresence>
        {showKeyboard && (
          <div className="relative z-50">
            <VirtualKeyboard
              onKeyPress={(key) => {
                // Key press helper for touch input
              }}
              onClose={() => setShowKeyboard(false)}
            />
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
