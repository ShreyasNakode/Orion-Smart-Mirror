import React, { useState, useEffect } from 'react';
import { Home, ScanFace, Activity, Settings, HomeIcon, User } from 'lucide-react';
import { ViewState } from '../types';
import { cn } from '../lib/utils';
import { motion } from 'motion/react';
import { useAppContext } from '../context/AppContext';
import { SpotifyPlayer } from './SpotifyPlayer';
import { DASHBOARD_ROUTES } from '../lib/dashboardRoutes';
import { getOrionGreeting } from '../lib/greeting';

interface SidebarProps {
  currentView: ViewState;
  onNavigate: (view: ViewState) => void;
  onSelect?: () => void;
}

export function Sidebar({ currentView, onNavigate, onSelect }: SidebarProps) {
  const { user, customProfileImage } = useAppContext();
  const [greeting, setGreeting] = useState('');

  useEffect(() => {
    const updateGreeting = () => setGreeting(getOrionGreeting(user, new Date()));
    updateGreeting();
    const interval = setInterval(updateGreeting, 30000);
    return () => clearInterval(interval);
  }, [user]);

  const iconByRoute: Record<string, React.ElementType> = {
    dashboard: Home,
    skin_analysis: ScanFace,
    home_control: HomeIcon,
    health: Activity,
    settings: Settings,
  };

  const navItems: { id: ViewState; label: string; icon: React.ElementType }[] = DASHBOARD_ROUTES
    .filter(route => iconByRoute[route.id])
    .map(route => ({ id: route.id, label: route.label, icon: iconByRoute[route.id] }));

  const profileImgSrc = user ? (customProfileImage || user.photoURL || null) : null;

  return (
    <div className="w-[320px] h-full p-6 flex flex-col gap-8 bg-black/95 backdrop-blur-2xl border-r border-white/20 relative z-20 shadow-[8px_0_32px_rgba(0,0,0,0.9)] text-white">
      <div className="min-h-[56px] flex items-center px-2">
        {user ? (
          <div className="flex items-center gap-4 min-w-0">
            <div className="w-12 h-12 rounded-full overflow-hidden border-2 border-white/50 glow-primary flex items-center justify-center bg-black shrink-0">
              {profileImgSrc ? (
                <img src={profileImgSrc} alt="Profile" className="w-full h-full object-cover" />
              ) : (
                <User size={24} className="text-white" />
              )}
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-bold tracking-tight glow-text leading-tight truncate text-white">Orion Smart Mirror</h2>
              <p className="text-sm text-white/90 font-semibold truncate">{greeting}</p>
            </div>
          </div>
        ) : (
          <p className="text-lg font-bold text-white glow-text leading-tight">{greeting}</p>
        )}
      </div>

      <nav className="flex flex-col gap-2.5 mt-4 flex-1">
        {navItems.map((item) => {
          const isActive = currentView === item.id;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => {
                onNavigate(item.id);
                if (onSelect) onSelect();
              }}
              className={cn(
                "relative flex items-center gap-4 px-4 py-3.5 rounded-xl text-left transition-all duration-300 group font-bold text-[15px]",
                isActive ? "text-white" : "text-white/70 hover:text-white hover:bg-white/10"
              )}
            >
              {isActive && (
                <motion.div 
                  layoutId="activeNavIndicator"
                  className="absolute inset-0 bg-white/15 border border-white/35 rounded-xl shadow-[0_0_12px_rgba(255,255,255,0.2)]"
                  initial={false}
                  transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                />
              )}
              <Icon size={22} className={cn("relative z-10 transition-colors", isActive ? "text-white drop-shadow-[0_0_10px_rgba(255,255,255,0.8)]" : "text-white/80 group-hover:text-white")} />
              <span className="relative z-10 font-bold text-[15px] tracking-wide">{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="mt-4">
        <SpotifyPlayer />
      </div>
    </div>
  );
}