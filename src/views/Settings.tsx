import { useState } from 'react';
import { motion } from 'motion/react';
import { GlassCard } from '../components/GlassCard';
import { User, Moon, Sun, Monitor, Palette, Bell, Shield, LogOut, Clock, Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { useAppContext } from '../context/AppContext';

export function Settings() {
  const { theme, setTheme, accentColor, setAccentColor, timeWidget, setTimeWidget, user, authLoading, login, logoutUser } = useAppContext();
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const handleLogin = async () => {
    setIsLoggingIn(true);
    try {
      await login();
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    try {
      await logoutUser();
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="pt-6 pb-32 pl-4 pr-16 sm:px-8 w-full max-w-4xl mx-auto h-full overflow-y-auto"
    >
      <div className="mb-10 pl-14">
          <h1 className="text-4xl font-extrabold tracking-tight mb-2">Settings</h1>
          <p className="text-on-surface-variant font-medium">Manage your mirror preferences and account.</p>
      </div>

      <div className="flex flex-col gap-10">
        
        {/* Account Section */}
        <section className="flex flex-col gap-4">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <User className="text-primary" size={24} />
            Account
          </h2>
          
          <GlassCard className="p-6">
            {authLoading ? (
               <div className="flex justify-center p-8">
                 <Loader2 className="animate-spin text-primary" size={32} />
               </div>
            ) : user ? (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 rounded-full overflow-hidden border-2 border-primary/30 bg-surface-container flex items-center justify-center">
                    {user.photoURL ? (
                      <img src={user.photoURL} alt="Profile" className="w-full h-full object-cover" />
                    ) : (
                      <User size={32} className="text-on-surface-variant" />
                    )}
                  </div>
                  <div>
                    <h3 className="text-xl font-bold">{user.givenName || user.displayName || 'Signed in'}</h3>
                    <p className="text-on-surface-variant text-sm">{user.email}</p>
                  </div>
                </div>
                <button 
                  onClick={handleLogout}
                  className="bg-error/10 text-error hover:bg-error/20 px-6 py-2 rounded-xl transition-colors font-semibold flex items-center gap-2"
                >
                  <LogOut size={18} />
                  Log Out
                </button>
              </div>
            ) : (
                <div className="flex flex-col items-center justify-center p-4">
                  <div className="w-16 h-16 rounded-full bg-surface-container flex items-center justify-center mb-4">
                     <User size={32} className="text-on-surface-variant" />
                  </div>
                  <h3 className="text-xl font-bold mb-2">Sign in to Orion</h3>
                  <p className="text-on-surface-variant text-sm text-center max-w-sm mb-6">Sync your calendar, skin analysis history, routines, and smart home configurations across devices.</p>
                  <button 
                    onClick={handleLogin}
                    disabled={isLoggingIn}
                    style={{ backgroundColor: '#fff', color: '#3c4043', border: '1px solid #dadce0', borderRadius: '4px', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: '10px', fontWeight: 500, fontSize: '14px', cursor: 'pointer', fontFamily: 'Roboto, sans-serif' }}
                    className="hover:bg-gray-50 transition-colors disabled:opacity-50 mx-auto"
                  >
                    {isLoggingIn ? (
                      <Loader2 size={20} className="animate-spin text-gray-400" />
                    ) : (
                      <svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" xmlnsXlink="http://www.w3.org/1999/xlink" style={{ display: 'block', width: '20px', height: '20px' }}>
                        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
                        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
                        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
                        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
                        <path fill="none" d="M0 0h48v48H0z"></path>
                      </svg>
                    )}
                    Sign in with Google
                  </button>
               </div>
            )}
          </GlassCard>
        </section>

        {/* Display & Theme Section */}
        <section className="flex flex-col gap-4">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Monitor className="text-primary" size={24} />
            Display & Appearance
          </h2>
          
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <GlassCard className="p-6">
              <h3 className="font-bold mb-4 text-on-surface-variant">Theme Mode</h3>
              <div className="grid grid-cols-2 gap-4">
                {[
                  { id: 'light', icon: Sun, label: 'Light' },
                  { id: 'dark', icon: Moon, label: 'Dark' },
                ].map((mode) => (
                  <button
                    key={mode.id}
                    onClick={() => setTheme(mode.id as any)}
                    className={cn(
                      "flex flex-col items-center justify-center gap-2 p-3 rounded-xl border transition-all text-sm",
                      theme === mode.id 
                        ? "bg-primary/20 border-primary shadow-[0_0_10px_rgba(164,201,255,0.2)] text-primary" 
                        : "bg-surface-container border-white/5 text-on-surface-variant hover:bg-white/5"
                    )}
                  >
                    <mode.icon size={20} />
                    <span className="font-semibold">{mode.label}</span>
                  </button>
                ))}
              </div>
            </GlassCard>

            <GlassCard className="p-6">
              <h3 className="font-bold mb-4 text-on-surface-variant flex items-center gap-2">
                <Palette size={18} />
                Accent Color
              </h3>
              <div className="flex flex-wrap gap-4">
                {[
                  { id: 'blue', color: 'bg-[#a4c9ff]' },
                  { id: 'purple', color: 'bg-[#c2c1ff]' },
                  { id: 'orange', color: 'bg-[#ffb874]' },
                  { id: 'green', color: 'bg-[#98fca3]' },
                  { id: 'pink', color: 'bg-[#ffb3cf]' },
                ].map((colorObj) => (
                  <button
                    key={colorObj.id}
                    onClick={() => setAccentColor(colorObj.id)}
                    className={cn(
                      "w-12 h-12 rounded-full flex items-center justify-center transition-all",
                      colorObj.color,
                      accentColor === colorObj.id ? "ring-4 ring-background ring-offset-2 ring-offset-primary/50 scale-110" : "hover:scale-105 opacity-80"
                    )}
                  />
                ))}
              </div>
              <p className="mt-4 text-xs text-on-surface-variant">Changes the primary accent color across the interface.</p>
            </GlassCard>
          </div>
        </section>

        {/* Time Widget Section */}
        <section className="flex flex-col gap-4">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Clock className="text-primary" size={24} />
            Time Widget
          </h2>
          <GlassCard className="p-6">
            <h3 className="font-bold mb-4 text-on-surface-variant">Clock Style</h3>
            <div className="grid grid-cols-2 gap-4 max-w-md">
              {[
                { id: 'digital', label: 'Digital' },
                { id: 'analog', label: 'Analog' },
              ].map((style) => (
                <button
                  key={style.id}
                  onClick={() => setTimeWidget(style.id as 'digital' | 'analog')}
                  className={cn(
                    "flex flex-col items-center justify-center gap-2 p-3 rounded-xl border transition-all text-sm font-semibold",
                    timeWidget === style.id 
                      ? "bg-primary/20 border-primary shadow-[0_0_10px_rgba(164,201,255,0.2)] text-primary" 
                      : "bg-surface-container border-white/5 text-on-surface-variant hover:bg-white/5"
                  )}
                >
                  {style.label}
                </button>
              ))}
            </div>
            <p className="mt-4 text-xs text-on-surface-variant">Choose how the time is displayed on the dashboard.</p>
          </GlassCard>
        </section>

        {/* Notifications & Privacy */}
        <section className="flex flex-col gap-4">
           <h2 className="text-xl font-bold flex items-center gap-2">
            <Shield className="text-primary" size={24} />
            Privacy & Alerts
          </h2>
          <GlassCard className="p-6 divide-y divide-white/10">
             <div className="flex items-center justify-between py-4 first:pt-0">
                <div>
                   <h4 className="font-bold">Push Notifications</h4>
                   <p className="text-sm text-on-surface-variant">Receive alerts on your mirror display.</p>
                </div>
                <Toggle isChecked={true} />
             </div>
             <div className="flex items-center justify-between py-4">
                <div>
                   <h4 className="font-bold">Store Face Scans</h4>
                   <p className="text-sm text-on-surface-variant">Save images to track skin improvement history.</p>
                </div>
                <Toggle isChecked={true} />
             </div>
             <div className="flex items-center justify-between py-4 pb-0">
                <div>
                   <h4 className="font-bold text-error">Delete All Data</h4>
                   <p className="text-sm text-error/70">Permanently remove all scan history and routines.</p>
                </div>
                <button className="px-4 py-2 bg-error/10 text-error rounded-lg text-sm font-bold hover:bg-error/20 transition-all">Delete</button>
             </div>
          </GlassCard>
        </section>

      </div>
    </motion.div>
  );
}

function Toggle({ isChecked = false }: { isChecked?: boolean }) {
  const [checked, setChecked] = useState(isChecked);
  return (
    <div 
       className={cn(
         "w-12 h-6 rounded-full p-1 flex items-center transition-colors duration-300 cursor-pointer pointer-events-auto",
         checked ? "bg-primary" : "bg-surface-container-high"
       )}
       onClick={() => setChecked(!checked)}
    >
       <motion.div 
         className="bg-white w-4 h-4 rounded-full shadow-sm"
         animate={{ x: checked ? 24 : 0 }}
         transition={{ type: "spring", stiffness: 500, damping: 30 }}
       />
    </div>
  )
}
