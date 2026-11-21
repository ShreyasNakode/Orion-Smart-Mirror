import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ViewState } from './types';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './views/Dashboard';
import { SkinAnalysis } from './views/SkinAnalysis';
import { HomeControl } from './views/HomeControl';
import { Health } from './views/Health';
import { Settings } from './views/Settings';
import { AnimatePresence, motion } from 'motion/react';
import { Mic, Menu, ChevronLeft } from 'lucide-react';
import { useAppContext } from './context/AppContext';
import { BrowserWindow } from './components/BrowserWindow';
import { PowerButton } from './components/PowerButton';
import { DASHBOARD_LABEL_BY_ID, resolveDashboardView } from './lib/dashboardRoutes';

export default function App() {
  const [isPoweredOn, setIsPoweredOn] = useState<boolean>(true);
  const [currentView, setCurrentView] = useState<ViewState>('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(false);
  const currentViewRef = useRef<ViewState>('dashboard');
  const { 
     isOrionListening,
     toggleOrionListening,
     orionBrowserImage,
     orionBrowserLogs,
     browserActivity,
     isBrowserVisible,
     setBrowserVisible,
     sendBrowserPrompt
  } = useAppContext();

  const navigateToView = useCallback((viewOrAlias: string, source = 'manual') => {
    const resolvedView = resolveDashboardView(viewOrAlias);
    if (!resolvedView) return;

    currentViewRef.current = resolvedView;
    setCurrentView(prev => (prev === resolvedView ? prev : resolvedView));
    window.dispatchEvent(new CustomEvent('orion_navigation_state', {
      detail: {
        view: resolvedView,
        label: DASHBOARD_LABEL_BY_ID[resolvedView] || resolvedView,
        source,
        timestamp: Date.now(),
      },
    }));
  }, []);

  const handlePowerToggle = useCallback(() => {
    setIsPoweredOn(prev => {
      const nextState = !prev;
      if (nextState) {
        // Smoothly transition to Home Dashboard; keep dashboard menu closed
        setCurrentView('dashboard');
        setIsSidebarOpen(false);
      } else {
        // Smoothly fade back to black; ensure drawer stays closed
        setIsSidebarOpen(false);
      }
      return nextState;
    });
  }, []);

  // Listen for low-latency navigation commands from voice actions.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      const view = detail.view || detail.dashboard || detail.target || detail.route;
      if (view) {
        setIsPoweredOn(true);
        navigateToView(view, detail.source || 'voice');
      }
    };
    window.addEventListener('orion_navigate', handler as EventListener);
    return () => window.removeEventListener('orion_navigate', handler as EventListener);
  }, [navigateToView]);


  return (
    <div className="h-screen w-screen bg-black overflow-hidden selection:bg-white/30 text-white font-medium relative">
      {/* Active Mirror Interface: Fades smoothly in/out; screen stays jet black when powered off */}
      <AnimatePresence>
        {isPoweredOn && (
          <motion.div
            key="mirror-active-workspace"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.55, ease: 'easeInOut' }}
            className="absolute inset-0 flex h-full w-full overflow-hidden"
          >
            {/* Top-Left Toggle Button */}
            <button
              onClick={() => setIsSidebarOpen(prev => !prev)}
              className="fixed top-5 left-5 z-50 p-3.5 rounded-2xl bg-black/80 backdrop-blur-xl border border-white/30 text-white hover:bg-white/20 hover:border-white/60 active:scale-95 shadow-[0_0_20px_rgba(0,0,0,0.8)] transition-all duration-300 flex items-center justify-center group"
              aria-label="Toggle navigation drawer"
              title={isSidebarOpen ? "Collapse dashboard menu" : "Open dashboard menu"}
            >
              {isSidebarOpen ? (
                <ChevronLeft size={24} className="text-white group-hover:scale-110 transition-transform" />
              ) : (
                <Menu size={24} className="text-white group-hover:scale-110 transition-transform" />
              )}
            </button>

            {/* Collapsible Left Navigation Drawer with 350ms ease-in-out transition */}
            <AnimatePresence>
              {isSidebarOpen && (
                <>
                  {/* Backdrop for click-outside collapse */}
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.35, ease: 'easeInOut' }}
                    onClick={() => setIsSidebarOpen(false)}
                    className="fixed inset-0 bg-black/40 backdrop-blur-xs z-30 pointer-events-auto"
                  />
                  {/* Sliding Drawer Container */}
                  <motion.aside
                    initial={{ x: '-100%' }}
                    animate={{ x: 0 }}
                    exit={{ x: '-100%' }}
                    transition={{ duration: 0.35, ease: 'easeInOut' }}
                    className="fixed top-0 left-0 bottom-0 z-40 h-full pt-16 flex"
                  >
                    <Sidebar 
                      currentView={currentView} 
                      onNavigate={(view) => navigateToView(view, 'sidebar')} 
                      onSelect={() => setIsSidebarOpen(false)}
                    />
                  </motion.aside>
                </>
              )}
            </AnimatePresence>
            
            <main className="flex-1 relative h-full w-full overflow-y-auto">
               <AnimatePresence mode="wait">
                  {currentView === 'dashboard' && (
                    <motion.div key="dash" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="h-full">
                       <Dashboard />
                    </motion.div>
                  )}
                  
                  {currentView === 'skin_analysis' && (
                    <motion.div key="skin" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="h-full">
                       <SkinAnalysis />
                    </motion.div>
                  )}

                  {currentView === 'home_control' && (
                    <motion.div key="home" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="h-full">
                       <HomeControl />
                    </motion.div>
                  )}

                  {currentView === 'settings' && (
                    <motion.div key="settings" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="h-full">
                       <Settings />
                    </motion.div>
                  )}

                  {currentView === 'health' && (
                    <motion.div key="health" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="h-full">
                       <Health />
                    </motion.div>
                  )}
               </AnimatePresence>
            </main>

            <BrowserWindow 
              imageSrc={orionBrowserImage}
              logs={orionBrowserLogs}
              isVisible={isBrowserVisible}
              onClose={() => setBrowserVisible(false)}
              onSendPrompt={sendBrowserPrompt}
              activity={browserActivity}
            />
            
            {/* Global Voice Assistant Button & Overlay */}
            <div className="fixed bottom-12 left-0 right-0 flex justify-center pointer-events-none z-50">
               <div className="pointer-events-auto relative">
                  <AnimatePresence>
                     {isOrionListening && (
                        <motion.div 
                          initial={{ opacity: 0, y: 20, scale: 0.9 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: 20, scale: 0.9 }}
                          className="absolute bottom-20 left-1/2 -translate-x-1/2 w-[250px] bg-black/90 border border-white/40 p-4 rounded-2xl shadow-2xl backdrop-blur-xl text-white"
                        >
                           <h4 className="text-white font-bold mb-2 flex items-center justify-center gap-2">
                              <Mic size={16} className="animate-pulse text-white" />
                              Orion Listening...
                           </h4>
                           
                           <div className="flex items-center gap-3 justify-center py-2">
                              <div className="w-2 h-2 rounded-full bg-white animate-ping" style={{ animationDelay: '0ms' }} />
                              <div className="w-2 h-2 rounded-full bg-white animate-ping" style={{ animationDelay: '150ms' }} />
                              <div className="w-2 h-2 rounded-full bg-white animate-ping" style={{ animationDelay: '300ms' }} />
                           </div>
                        </motion.div>
                     )}
                  </AnimatePresence>

                  <button 
                     onClick={() => {
                        toggleOrionListening();
                     }}
                     className={`relative w-16 h-16 flex items-center justify-center rounded-full border border-white/30 shadow-[0_0_20px_rgba(0,0,0,0.8)] transition-all group ${isOrionListening ? 'bg-white border-white' : 'bg-black/80 hover:bg-black/90 hover:border-white/60'}`}
                  >
                     <div className={`absolute inset-0 rounded-full border-2 scale-100 transition-transform duration-300 ${isOrionListening ? 'border-white animate-ping opacity-30' : 'border-white/30 group-hover:border-white/60 group-hover:scale-110'}`}></div>
                     <div className={`absolute inset-0 rounded-full blur-md transition-colors ${isOrionListening ? 'bg-white/50' : 'bg-white/20 group-hover:bg-white/40'}`}></div>
                     <Mic size={24} className={`relative z-10 transition-colors ${isOrionListening ? 'text-black' : 'text-white'}`} />
                  </button>
                  {!isOrionListening && <p className="text-center font-bold text-white mt-3 text-sm glow-text absolute left-1/2 -translate-x-1/2 w-max bottom-[-24px] opacity-0 group-hover:opacity-100 transition-opacity">Orion</p>}
               </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Minimalist Power Button: Fixed at extreme right-center, vertically centered, always accessible */}
      <PowerButton
        isPoweredOn={isPoweredOn}
        onToggle={handlePowerToggle}
      />
    </div>
  );
}

