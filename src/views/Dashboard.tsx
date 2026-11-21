import React, { useState, useEffect, useRef } from 'react';
import { GlassCard } from '../components/GlassCard';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, CheckSquare, Bell, Cloud, Droplet, Wind, Sun, Moon, CloudRain, CloudSnow, CloudLightning, X, Newspaper, Play, Square, AlarmClock, Clock, Plus, Sparkles, RotateCw } from 'lucide-react';
import { useAppContext } from '../context/AppContext';
import { fetchLiveWeatherData, WeatherData, getWeatherConditionInfo, DEFAULT_BANGALORE_COORDS } from '../lib/weather';
import { navigateToDashboard } from '../lib/dashboardRoutes';
import { getPreferredWebcamStream } from '../lib/camera';

const RINGTONE_OPTIONS = [
  { name: 'Classic Alarm', url: '/sounds/classic_alarm.wav' },
  { name: 'Digital Beep', url: '/sounds/digital_beep.wav' },
  { name: 'Gentle Chime', url: '/sounds/gentle_chime.wav' },
  { name: 'Sunrise Glow', url: '/sounds/sunrise_glow.wav' },
  { name: 'Modern Pulse', url: '/sounds/modern_pulse.wav' },
];

const MakeupCamera = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  
  useEffect(() => {
    let stream: MediaStream | null = null;
    let track: MediaStreamTrack | null = null;

    const initCamera = async () => {
      try {
        const { stream: preferredStream } = await getPreferredWebcamStream({
          width: { ideal: 1280 },
          height: { ideal: 720 },
        });
        stream = preferredStream;
        
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }

        if (stream.getVideoTracks().length > 0) {
          track = stream.getVideoTracks()[0];
          setTimeout(() => {
              if (track) {
                  const capabilities = track.getCapabilities() as any;
                  if (capabilities.zoom) {
                    const zoomValue = Math.min(Math.max(capabilities.zoom.min || 1, 3), capabilities.zoom.max || 3);
                    try {
                      track.applyConstraints({
                        advanced: [{ zoom: zoomValue }]
                      } as any);
                    } catch (e) {
                        console.log('Hardware zoom not supported or failed to apply');
                    }
                  }
              }
          }, 500);
        }

      } catch (err) {
        console.error("Failed to access camera", err);
      }
    };

    initCamera();

    return () => {
      if (stream) {
        stream.getTracks().forEach(t => t.stop());
      }
    };
  }, []);

  return (
    <div className="w-full h-full relative bg-black/50 overflow-hidden flex items-center justify-center">
       <video 
         ref={videoRef}
         autoPlay 
         playsInline 
         className="w-full h-full object-cover" 
         style={{ transform: 'scaleX(-1) scale(3)', transformOrigin: 'center center' }} 
       />
    </div>
  );
};

export function Dashboard() {
  const { tasks, setTasks, events, setEvents, gallery, clearGallery, deleteGalleryImages, timeWidget, addCalendarEvent, deleteCalendarEvent, addRemoteTask, toggleRemoteTask, deleteRemoteTask, skincareRoutine, updateSkincareRoutine } = useAppContext();
  const [time, setTime] = useState(new Date());

  // Real-time clock mechanism: updates every second in local timezone, aligned with 1000ms boundary to prevent drift, with proper cleanup
  useEffect(() => {
    let timerId: ReturnType<typeof setTimeout> | null = null;
    let isCancelled = false;

    const tick = () => {
      if (isCancelled) return;
      const now = new Date();
      setTime(now);
      const msUntilNextSecond = 1000 - (now.getTime() % 1000);
      timerId = setTimeout(tick, msUntilNextSecond);
    };

    tick();

    return () => {
      isCancelled = true;
      if (timerId !== null) {
        clearTimeout(timerId);
      }
    };
  }, []);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'routine' | 'gallery'>('dashboard');
  const [weatherIndex, setWeatherIndex] = useState(0);

  const [calendarMonth, setCalendarMonth] = useState(new Date().getMonth());
  const [calendarYear, setCalendarYear] = useState(new Date().getFullYear());
  const [selectedDate, setSelectedDate] = useState<{ day: number, month: number, year: number } | null>(null);
  const [showEventModal, setShowEventModal] = useState(false);
  const [eventModalType, setEventModalType] = useState('meeting');
  const [eventModalTitle, setEventModalTitle] = useState('');
  const [showWeatherModal, setShowWeatherModal] = useState(false);
  
  const [showMakeupMirror, setShowMakeupMirror] = useState(false);
  
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [showTaskAdd, setShowTaskAdd] = useState(false);
  const [showCelebration, setShowCelebration] = useState(false);
  const celebratedHashRef = useRef('');

  useEffect(() => {
    const allDone = tasks.length > 0 && tasks.every(t => t.done);
    const currentHash = tasks.map(t => t.id).sort().join(',');

    if (allDone) {
      if (celebratedHashRef.current !== currentHash) {
         setShowCelebration(true);
         celebratedHashRef.current = currentHash;
         const t = setTimeout(() => setShowCelebration(false), 2000);
         return () => clearTimeout(t);
      }
    } else {
      if (currentHash !== celebratedHashRef.current) {
         celebratedHashRef.current = '';
      }
    }
  }, [tasks]);

  const [showAlarmModal, setShowAlarmModal] = useState(false);
  const [alarmTab, setAlarmTab] = useState<'alarm' | 'timer' | 'stopwatch'>('alarm');
  
  // Alarm State
  const [alarmTime, setAlarmTime] = useState('');
  const [alarmHour, setAlarmHour] = useState(12);
  const [alarmMinute, setAlarmMinute] = useState(0);
  const [alarmAmPm, setAlarmAmPm] = useState<'AM' | 'PM'>('AM');
  const alarmWheelAccum = useRef({ h: 0, m: 0, ap: 0 });
  const [alarmRingtone, setAlarmRingtone] = useState('/sounds/classic_alarm.wav');
  const [isAlarmSet, setIsAlarmSet] = useState(false);
  const [isRinging, setIsRinging] = useState(false);

  // Timer State
  const [timerMinutes, setTimerMinutes] = useState(5);
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const timerWheelAccum = useRef({ m: 0, s: 0 });

  // Stopwatch State
  const [stopwatchTime, setStopwatchTime] = useState(0); // in deciseconds (tenths)
  const [isStopwatchRunning, setIsStopwatchRunning] = useState(false);

  useEffect(() => {
    let hour24 = alarmHour;
    if (alarmAmPm === 'PM' && hour24 !== 12) hour24 += 12;
    if (alarmAmPm === 'AM' && hour24 === 12) hour24 = 0;
    setAlarmTime(`${hour24.toString().padStart(2, '0')}:${alarmMinute.toString().padStart(2, '0')}`);
  }, [alarmHour, alarmMinute, alarmAmPm]);

  const handleWheelHour = (e: React.WheelEvent) => {
    alarmWheelAccum.current.h += e.deltaY;
    if (alarmWheelAccum.current.h > 50) {
      setAlarmHour(prev => prev === 1 ? 12 : prev - 1);
      alarmWheelAccum.current.h = 0;
    } else if (alarmWheelAccum.current.h < -50) {
      setAlarmHour(prev => prev === 12 ? 1 : prev + 1);
      alarmWheelAccum.current.h = 0;
    }
  };

  const handleWheelMinute = (e: React.WheelEvent) => {
    alarmWheelAccum.current.m += e.deltaY;
    if (alarmWheelAccum.current.m > 50) {
      setAlarmMinute(prev => prev === 0 ? 59 : prev - 1);
      alarmWheelAccum.current.m = 0;
    } else if (alarmWheelAccum.current.m < -50) {
      setAlarmMinute(prev => prev === 59 ? 0 : prev + 1);
      alarmWheelAccum.current.m = 0;
    }
  };

  const handleWheelAmPm = (e: React.WheelEvent) => {
    alarmWheelAccum.current.ap += e.deltaY;
    if (alarmWheelAccum.current.ap > 50 || alarmWheelAccum.current.ap < -50) {
      setAlarmAmPm(prev => prev === 'AM' ? 'PM' : 'AM');
      alarmWheelAccum.current.ap = 0;
    }
  };

  const handleWheelTimerMinute = (e: React.WheelEvent) => {
    if (isTimerRunning) return;
    timerWheelAccum.current.m += e.deltaY;
    if (timerWheelAccum.current.m > 50) {
      setTimerMinutes(prev => Math.max(0, prev - 1));
      timerWheelAccum.current.m = 0;
    } else if (timerWheelAccum.current.m < -50) {
      setTimerMinutes(prev => prev + 1);
      timerWheelAccum.current.m = 0;
    }
  };

  const handleWheelTimerSecond = (e: React.WheelEvent) => {
    if (isTimerRunning) return;
    timerWheelAccum.current.s += e.deltaY;
    if (timerWheelAccum.current.s > 50) {
      setTimerSeconds(prev => prev === 0 ? 59 : prev - 1);
      timerWheelAccum.current.s = 0;
    } else if (timerWheelAccum.current.s < -50) {
      setTimerSeconds(prev => prev === 59 ? 0 : prev + 1);
      timerWheelAccum.current.s = 0;
    }
  };

  // Weather State
  const [weatherData, setWeatherData] = useState<WeatherData | null>(null);

  // Live Weather Fetching with Auto Location & Bangalore Fallback
  useEffect(() => {
    let isMounted = true;
    const loadWeather = async () => {
      try {
        const data = await fetchLiveWeatherData();
        if (isMounted) {
          setWeatherData(data);
        }
      } catch (err) {
        console.error("Error loading weather data:", err);
      }
    };
    loadWeather();
    const interval = setInterval(loadWeather, 600000); // refresh every 10 minutes
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  const [notifications, setNotifications] = useState([
    { id: 1, app: 'Orion AI', text: 'Your daily skin analysis is ready to begin.', isPrimary: true, isNew: false },
    { id: 2, app: 'Home Assistant', text: 'Living room lights configured to evening mode.', isPrimary: false, isNew: false },
  ]);

  const [newsItems, setNewsItems] = useState<Array<{ id: string | number; title: string; category: string; time: string; image: string; isNew?: boolean }>>([
    { id: '1', title: 'Global Tech Summit Unveils New Innovations', category: 'Tech News', time: '2h ago', image: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=200&h=200&fit=crop', isNew: false },
    { id: '2', title: 'Breakthroughs in Renewable Energy Infrastructure', category: 'Environment', time: '4h ago', image: 'https://images.unsplash.com/photo-1590845947698-8924d7409b56?w=200&h=200&fit=crop', isNew: false },
    { id: '3', title: 'Commercial Space Flight Reaches Milestone', category: 'Science', time: '6h ago', image: 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=200&h=200&fit=crop', isNew: false },
    { id: '4', title: 'Next Generation AI Models Enhance Local Processing', category: 'AI & Tech', time: '8h ago', image: 'https://images.unsplash.com/photo-1504384308090-c894fdcc538d?w=200&h=200&fit=crop', isNew: false },
    { id: '5', title: 'Global Medical Research Advances Healthcare Frontiers', category: 'Health', time: '10h ago', image: 'https://images.unsplash.com/photo-1495020689067-958852a7765e?w=200&h=200&fit=crop', isNew: false }
  ]);
  const [isRefreshingNews, setIsRefreshingNews] = useState(false);
  const hasNewNews = newsItems.some(n => n.isNew);

  const fetchLatestNews = async () => {
    try {
      setIsRefreshingNews(true);
      const res = await fetch('/api/news');
      if (res.ok) {
        const data = await res.json();
        if (data.articles && Array.isArray(data.articles) && data.articles.length > 0) {
          setNewsItems(data.articles.slice(0, 5));
        }
      }
    } catch (err) {
      console.error("Error fetching live news headlines:", err);
    } finally {
      setIsRefreshingNews(false);
    }
  };

  // Live News Headlines Auto-Refresh on app open and periodic 5 min interval
  useEffect(() => {
    fetchLatestNews();
    const interval = setInterval(fetchLatestNews, 300000);
    return () => clearInterval(interval);
  }, []);

  // Voice Action listeners for Alarms, Timers, and Stopwatches
  useEffect(() => {
    const handleAlarmAction = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail) return;
      const action = (detail.action || 'set').toLowerCase();
      if (action === 'set' || action === 'enable') {
        if (detail.time) {
          const timeStr = String(detail.time).trim();
          let hour = 12;
          let minute = 0;
          let ampm: 'AM' | 'PM' = 'AM';
          const match24 = timeStr.match(/^(\d{1,2}):(\d{2})$/);
          const match12 = timeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
          if (match12) {
            hour = parseInt(match12[1], 10);
            minute = parseInt(match12[2], 10);
            if (match12[3]) ampm = match12[3].toUpperCase() as 'AM' | 'PM';
            else ampm = hour >= 12 ? 'PM' : 'AM';
            if (hour > 12) { hour -= 12; ampm = 'PM'; }
            if (hour === 0) { hour = 12; ampm = 'AM'; }
          }
          setAlarmHour(hour);
          setAlarmMinute(minute);
          setAlarmAmPm(ampm);
        }
        if (detail.ringtone) {
          setAlarmRingtone(detail.ringtone);
        }
        setIsAlarmSet(true);
        setAlarmTab('alarm');
        setShowAlarmModal(true);
      } else if (action === 'cancel' || action === 'stop' || action === 'disable') {
        setIsAlarmSet(false);
        setIsRinging(false);
        if ((window as any).currentAlarmAudio) {
          (window as any).currentAlarmAudio.pause();
        }
      }
    };

    const handleTimerAction = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail) return;
      const action = (detail.action || 'start').toLowerCase();
      if (action === 'start' || action === 'resume') {
        let mins = detail.minutes !== undefined && detail.minutes !== null ? Number(detail.minutes) : 0;
        let secs = detail.seconds !== undefined && detail.seconds !== null ? Number(detail.seconds) : 0;
        if (detail.durationSeconds) {
          mins = Math.floor(Number(detail.durationSeconds) / 60);
          secs = Number(detail.durationSeconds) % 60;
        }
        if (mins === 0 && secs === 0 && !isTimerRunning) {
          mins = 5;
        }
        if (mins > 0 || secs > 0) {
          setTimerMinutes(mins);
          setTimerSeconds(secs);
        }
        setIsTimerRunning(true);
        setAlarmTab('timer');
        setShowAlarmModal(true);
      } else if (action === 'pause') {
        setIsTimerRunning(false);
      } else if (action === 'stop' || action === 'reset') {
        setIsTimerRunning(false);
        setTimerMinutes(5);
        setTimerSeconds(0);
      }
    };

    const handleStopwatchAction = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail) return;
      const action = (detail.action || 'start').toLowerCase();
      if (action === 'start' || action === 'resume') {
        setIsStopwatchRunning(true);
        setAlarmTab('stopwatch');
        setShowAlarmModal(true);
      } else if (action === 'pause') {
        setIsStopwatchRunning(false);
      } else if (action === 'stop' || action === 'reset') {
        setIsStopwatchRunning(false);
        setStopwatchTime(0);
      }
    };

    window.addEventListener('orion_alarm_action', handleAlarmAction);
    window.addEventListener('orion_timer_action', handleTimerAction);
    window.addEventListener('orion_stopwatch_action', handleStopwatchAction);

    return () => {
      window.removeEventListener('orion_alarm_action', handleAlarmAction);
      window.removeEventListener('orion_timer_action', handleTimerAction);
      window.removeEventListener('orion_stopwatch_action', handleStopwatchAction);
    };
  }, [isTimerRunning]);

  // Simulate incoming notification update for the user
  useEffect(() => {
    const timer1 = setTimeout(() => {
      setNotifications(n => [{ id: Date.now(), app: 'Orion AI', text: 'Important update: New AI model available for local processing.', isPrimary: true, isNew: true }, ...n].slice(0, 4));
    }, 5000);

    return () => { clearTimeout(timer1); };
  }, []);

  // Alarm checking
  useEffect(() => {
    if (isAlarmSet && alarmTime) {
      const current = time.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
      if (current === alarmTime && !isRinging) {
        setIsRinging(true);
        // Play ringtone
        const audio = new Audio(alarmRingtone);
        audio.loop = true;
        audio.play().catch(e => console.error("Audio play failed", e));
        (window as any).currentAlarmAudio = audio;
      }
    }
  }, [time, alarmTime, isAlarmSet, isRinging, alarmRingtone]);

  const stopAlarm = () => {
    setIsRinging(false);
    setIsAlarmSet(false);
    if ((window as any).currentAlarmAudio) {
      (window as any).currentAlarmAudio.pause();
      (window as any).currentAlarmAudio.currentTime = 0;
    }
  };

  // Timer logic
  useEffect(() => {
    let interval: any;
    if (isTimerRunning) {
      interval = setInterval(() => {
        setTimerSeconds(s => {
          if (s > 0) return s - 1;
          if (timerMinutes > 0) {
            setTimerMinutes(m => m - 1);
            return 59;
          }
          // Timer ended
          setIsTimerRunning(false);
          const audio = new Audio(alarmRingtone);
          audio.play().catch(e => console.error(e));
          return 0;
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isTimerRunning, timerMinutes, alarmRingtone]);

  // Stopwatch logic
  useEffect(() => {
    let interval: any;
    if (isStopwatchRunning) {
      interval = setInterval(() => {
        setStopwatchTime(t => t + 1);
      }, 100);
    }
    return () => clearInterval(interval);
  }, [isStopwatchRunning]);

  const timeString = time.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  const dateString = time.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  const getCalendarDays = () => {
    const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
    const firstDay = new Date(calendarYear, calendarMonth, 1).getDay();
    return { daysInMonth, firstDay };
  };

  const currentMonthName = new Date(calendarYear, calendarMonth).toLocaleString('default', { month: 'long', year: 'numeric' });
  const currentDay = time.getDate();
  const currentActualMonth = time.getMonth();
  const currentActualYear = time.getFullYear();

  const handlePrevMonth = () => {
    if (calendarMonth === 0) {
      setCalendarMonth(11);
      setCalendarYear(y => y - 1);
    } else {
      setCalendarMonth(m => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (calendarMonth === 11) {
      setCalendarMonth(0);
      setCalendarYear(y => y + 1);
    } else {
      setCalendarMonth(m => m + 1);
    }
  };

  const handleDayClick = (day: number) => {
    setSelectedDate({ day, month: calendarMonth, year: calendarYear });
    setEventModalTitle('');
    setEventModalType('meeting');
    setShowEventModal(true);
  };

  const addEvent = async () => {
    if (selectedDate && eventModalTitle.trim()) {
      await addCalendarEvent(selectedDate.day, selectedDate.month, selectedDate.year, eventModalTitle, eventModalType);
      setShowEventModal(false);
      setSelectedDate(null);
    }
  };

  const { daysInMonth, firstDay } = getCalendarDays();

  const renderWeatherIcon = (code?: number) => {
    const info = code !== undefined ? getWeatherConditionInfo(code) : (weatherData ? getWeatherConditionInfo(weatherData.weatherCode) : { condition: 'Sunny', type: 'sun' });
    if (info.type === 'sun') return <motion.div key="sun" initial={{ scale: 0, rotate: -45 }} animate={{ scale: 1, rotate: 0 }} exit={{ scale: 0, rotate: 45 }} transition={{ type: "spring" }}><Sun size={24} className="text-tertiary" /></motion.div>;
    if (info.type === 'rain') return <motion.div key="rain" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ type: "spring" }}><CloudRain size={24} className="text-secondary" /></motion.div>;
    if (info.type === 'snow') return <motion.div key="snow" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ type: "spring" }}><CloudSnow size={24} className="text-primary" /></motion.div>;
    if (info.type === 'thunder') return <motion.div key="thunder" initial={{ scale: 0.8 }} animate={{ scale: 1 }} exit={{ scale: 0.8 }} transition={{ type: "spring" }}><CloudLightning size={24} className="text-amber-400" /></motion.div>;
    return <motion.div key="cloud" initial={{ y: -10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 10, opacity: 0 }} transition={{ type: "spring" }}><Cloud size={24} className="text-primary" /></motion.div>;
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="pt-6 pb-32 pl-4 pr-16 sm:px-8 max-w-5xl mx-auto h-full overflow-y-auto"
    >
      {/* Top Header Navigation */}
      <div className="flex justify-between items-center mb-10 border-b border-white/5 pb-2 pl-14 pr-2">
        <div className="flex gap-8 text-sm font-semibold tracking-wide">
          {(['dashboard', 'routine', 'gallery'] as const).map((tab) => (
             <button 
               key={tab} 
               onClick={() => setActiveTab(tab)}
               className={`pb-1 capitalize transition-colors relative ${activeTab === tab ? 'text-primary' : 'text-on-surface-variant hover:text-white'}`}
             >
               {tab}
               {activeTab === tab && (
                 <motion.div layoutId="dashboardTab" className="absolute -bottom-[9px] left-0 right-0 h-[2px] bg-primary glow-primary rounded-t-full" />
               )}
             </button>
          ))}
        </div>
        
        {/* Makeup Button */}
        <button 
          onClick={() => setShowMakeupMirror(true)}
          className="w-10 h-10 rounded-full bg-surface-container flex items-center justify-center hover:bg-white/10 transition-colors border border-white/5 active:scale-95 z-10"
          title="Makeup Mirror"
        >
          <Sparkles className="w-4 h-4 text-primary" />
        </button>
      </div>

      <AnimatePresence mode="wait">
        {activeTab === 'dashboard' && (
          <motion.div key="dashboard-tab" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}>
            {/* Main Time & Date */}
            <div className="flex flex-col items-center mb-16 relative">
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-primary/5 rounded-full blur-3xl pointer-events-none"></div>
                
                {timeWidget === 'analog' ? (
                  <div 
                    className="relative w-48 h-48 rounded-full border-[6px] border-surface-container bg-surface flex items-center justify-center shadow-2xl z-10 cursor-pointer hover:border-primary/50 transition-colors"
                    onClick={() => setShowAlarmModal(true)}
                  >
                    <div className="absolute inset-2 rounded-full border border-white/5 bg-gradient-to-br from-white/5 to-transparent"></div>
                    {/* Tick marks */}
                    {[...Array(12)].map((_, i) => (
                      <div 
                        key={i} 
                        className="absolute inset-0 flex items-start justify-center py-2 pointer-events-none"
                        style={{ transform: `rotate(${i * 30}deg)` }}
                      >
                        <div className="w-1 h-3 bg-on-surface-variant/50 rounded-full" />
                      </div>
                    ))}
                    {/* Hours */}
                    <div 
                      className="absolute w-1.5 h-12 bg-on-surface rounded-full origin-bottom shadow-lg"
                      style={{ bottom: '50%', transform: `translateX(-50%) rotate(${(time.getHours() % 12) * 30 + time.getMinutes() * 0.5}deg)`, left: '50%' }}
                    />
                    {/* Minutes */}
                    <div 
                      className="absolute w-1 h-16 bg-primary rounded-full origin-bottom shadow-lg"
                      style={{ bottom: '50%', transform: `translateX(-50%) rotate(${time.getMinutes() * 6}deg)`, left: '50%' }}
                    />
                    {/* Seconds */}
                    <div 
                      className="absolute w-[2px] h-20 bg-error rounded-full origin-bottom shadow-lg"
                      style={{ bottom: '50%', transform: `translateX(-50%) rotate(${time.getSeconds() * 6}deg)`, left: '50%' }}
                    />
                    {/* Center dot */}
                    <div className="w-3 h-3 bg-error rounded-full z-10 shadow-lg"></div>
                  </div>
                ) : (
                  <h1 
                    className="text-6xl sm:text-7xl md:text-8xl flex justify-center items-center font-extrabold tracking-tighter glow-text drop-shadow-2xl z-10 cursor-pointer hover:text-primary transition-colors whitespace-nowrap"
                    onClick={() => setShowAlarmModal(true)}
                  >
                    {timeString}
                  </h1>
                )}

                <p className="text-xl text-primary font-medium mt-6 z-10">{dateString}</p>
                <div 
                  className="flex items-center gap-3 mt-4 text-on-surface-variant bg-surface-container/30 px-5 py-2 rounded-full backdrop-blur z-10 border border-white/5 shadow-lg cursor-pointer hover:bg-white/10 transition-colors"
                  onClick={() => setShowWeatherModal(true)}
                  title={weatherData?.city || 'Click for forecast'}
                >
                  <div className="w-6 h-6 flex items-center justify-center relative">
                     <AnimatePresence mode="popLayout">{renderWeatherIcon()}</AnimatePresence>
                  </div>
                  <span className="font-medium text-white/90">
                     {weatherData ? `${weatherData.currentTempF}°F (${weatherData.currentTempC}°C) · ${weatherData.condition}` : 'Loading weather...'}
                  </span>
                </div>
            </div>

            <div className="flex flex-col gap-8 relative z-10 w-full mb-8">
              
              {/* Row 1: Calendar */}
              <div className="w-full">
                {/* Calendar Widget */}
                <GlassCard className="p-6">
                  <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3 select-none">
                      <h3 className="font-bold text-lg">{currentMonthName}</h3>
                    </div>
                    <div className="flex items-center gap-2 text-on-surface-variant">
                      <button onClick={handlePrevMonth} className="hover:text-white transition-colors p-1"><ChevronLeft size={20} /></button>
                      <button onClick={handleNextMonth} className="hover:text-white transition-colors p-1"><ChevronRight size={20} /></button>
                      <button onClick={() => { setCalendarMonth(currentActualMonth); setCalendarYear(currentActualYear); }} className="hover:text-white transition-colors p-1 ml-1" title="Today">
                        <CalendarIcon size={20} />
                      </button>
                    </div>
                  </div>
                  {/* Simple Grid Calendar Mockup */}
                  <div className="grid grid-cols-7 gap-y-4 text-center text-sm">
                    {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, index) => (
                      <div key={`${d}-${index}`} className="font-semibold text-on-surface-variant select-none">{d}</div>
                    ))}
                    {Array.from({ length: firstDay }).map((_, i) => (
                      <div key={`empty-${i}`} />
                    ))}
                    {Array.from({ length: daysInMonth }).map((_, i) => {
                      const day = i + 1;
                      const isToday = day === currentDay && calendarMonth === currentActualMonth && calendarYear === currentActualYear;
                      const hasEvent = events.some(e => e.day === day && e.month === calendarMonth && e.year === calendarYear);
                      return (
                        <div key={i} className="flex justify-center relative">
                          <span 
                            onClick={() => handleDayClick(day)}
                            className={`w-8 h-8 flex items-center justify-center rounded-full transition-colors cursor-pointer hover:bg-white/10 ${isToday ? 'bg-primary text-on-primary font-bold shadow-[0_0_12px_rgba(164,201,255,0.6)]' : 'text-on-surface/80'}`}>
                            {day}
                          </span>
                          {hasEvent && <div className="absolute bottom-0 right-1 w-1.5 h-1.5 bg-tertiary rounded-full shadow-[0_0_5px_rgba(255,184,116,0.8)]" />}
                        </div>
                      )
                    })}
                  </div>

                  {/* Monthly Events List */}
                  {events.filter(e => e.month === calendarMonth && e.year === calendarYear).length > 0 && (
                    <div className="mt-6 pt-6 border-t border-white/5 space-y-3">
                       <h4 className="font-semibold text-sm text-on-surface-variant mb-2">Events this month</h4>
                       {events.filter(e => e.month === calendarMonth && e.year === calendarYear)
                         .sort((a,b) => a.day - b.day)
                         .map((e) => (
                         <div key={e.id} className="flex items-center justify-between bg-surface-container rounded-lg p-3 text-sm border border-white/5 relative group overflow-hidden">
                           <div className="flex items-center gap-3">
                             <div className="w-10 h-10 bg-primary/10 rounded-lg flex flex-col items-center justify-center font-bold text-primary border border-primary/20">
                               <span className="text-xs uppercase leading-none opacity-80">{new Date(e.year, e.month, e.day).toLocaleString('default', { month: 'short' })}</span>
                               <span className="leading-tight">{e.day}</span>
                             </div>
                             <div>
                               <p className="font-semibold">{e.title}</p>
                               <span className="text-xs text-on-surface-variant capitalize px-2 border border-white/10 rounded-full mt-1 inline-block">{e.type || 'Event'}</span>
                             </div>
                           </div>
                           <button onClick={() => deleteCalendarEvent(e.id)} className="text-error/80 hover:text-error opacity-0 group-hover:opacity-100 transition-opacity p-2">
                             <X size={16} />
                           </button>
                         </div>
                       ))}
                    </div>
                  )}
                </GlassCard>
              </div>

              {/* Row 2: Top Stories & Notifications */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 w-full">
                {/* News Widget */}
                <GlassCard className="p-6 relative overflow-hidden h-full">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <h3 className="font-bold text-lg">Top Stories</h3>
                      <button 
                        onClick={fetchLatestNews} 
                        disabled={isRefreshingNews}
                        className="text-on-surface-variant hover:text-primary transition-colors p-1"
                        title="Refresh Top Stories"
                      >
                        <RotateCw size={16} className={isRefreshingNews ? "animate-spin text-primary" : ""} />
                      </button>
                    </div>
                    <motion.div
                        className="origin-bottom"
                        animate={hasNewNews ? { 
                            y: [0, -6, 0, -3, 0],
                            scaleY: [1, 1.1, 0.95, 1.05, 1],
                            rotateZ: [0, -10, 10, -5, 5, 0]
                        } : { y: 0, scaleY: 1, rotateZ: 0 }}
                        transition={{ repeat: Infinity, duration: 1.8, ease: "easeInOut", repeatDelay: 10 }}
                    >
                        <Newspaper size={20} className={`flex-shrink-0 transition-colors ${hasNewNews ? 'text-tertiary' : 'text-on-surface-variant'}`} />
                    </motion.div>
                  </div>
                  <div className="flex flex-col gap-4">
                    <AnimatePresence initial={false}>
                      {newsItems.map((news) => (
                        <motion.div 
                          key={news.id}
                          initial={{ opacity: 0, x: 20 }}
                          animate={{ opacity: 1, x: 0 }}
                          className={`flex gap-4 group cursor-pointer relative p-2 rounded-xl transition-colors ${news.isNew ? 'bg-tertiary/5 border border-tertiary/20' : 'hover:bg-white/5 border border-transparent'}`}
                          onClick={() => setNewsItems(newsItems.map(n => n.id === news.id ? { ...n, isNew: false } : n))}
                        >
                           <div className="w-16 h-16 rounded-lg bg-surface-container overflow-hidden flex-shrink-0 relative">
                              <img src={news.image} className="w-full h-full object-cover group-hover:scale-110 transition-transform" />
                              {news.isNew && <div className="absolute inset-0 border-2 border-tertiary rounded-lg animate-pulse" />}
                           </div>
                           <div className="flex-1 pr-2">
                              <h4 className={`font-bold text-sm leading-tight mb-1 transition-colors ${news.isNew ? 'text-tertiary' : 'group-hover:text-primary'}`}>
                                {news.title}
                              </h4>
                              <p className="text-xs text-on-surface-variant">{news.category} · {news.time}</p>
                           </div>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>
                </GlassCard>

                {/* Notifications */}
                <GlassCard className="p-6 relative overflow-hidden h-full">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-bold text-lg text-on-surface-variant">Recent Notifications</h3>
                    <motion.div
                        className="origin-top"
                        animate={notifications.some(n => n.isNew) ? { 
                            rotate: [0, 25, -20, 15, -10, 5, -2, 0],
                            scale: [1, 1.2, 1.2, 1.2, 1.2, 1.2, 1.2, 1]
                        } : { rotate: 0, scale: 1 }}
                        transition={{ repeat: Infinity, duration: 1.2, repeatDelay: 10, ease: "easeInOut" }}
                    >
                        <Bell size={16} className={`flex-shrink-0 transition-colors ${notifications.some(n => n.isNew) ? 'text-primary' : 'text-on-surface-variant'}`} />
                    </motion.div>
                  </div>
                  <div className="flex flex-col gap-3">
                    <AnimatePresence initial={false}>
                      {notifications.map((notif) => (
                        <motion.div 
                          key={notif.id}
                          initial={{ opacity: 0, x: 20, scale: 0.95 }}
                          animate={{ opacity: 1, x: 0, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.9, height: 0, margin: 0, padding: 0 }}
                          className={`relative overflow-hidden p-4 rounded-xl flex flex-col gap-1 border ${notif.isPrimary ? 'bg-primary/10 border-primary/20' : 'bg-white/5 border-white/5'}`}
                        >
                           <button onClick={() => setNotifications(notifications.map(n => n.id === notif.id ? { ...n, isNew: false } : n).filter(n => n.id !== notif.id))} className="absolute top-2 right-2 p-1 text-on-surface-variant hover:text-white transition-colors z-10">
                              <X size={14} />
                           </button>
                          <div className="flex items-center gap-2 pr-6">
                            <span className="font-bold text-sm w-full truncate">{notif.app}</span>
                          </div>
                          <p className={`text-sm ${notif.isPrimary ? 'text-primary' : 'text-on-surface-variant'}`}>
                            {notif.text}
                          </p>
                        </motion.div>
                      ))}
                      {notifications.length === 0 && (
                         <div className="text-center text-on-surface-variant py-4 text-sm">No new notifications</div>
                      )}
                    </AnimatePresence>
                  </div>
                </GlassCard>
              </div>

              {/* Row 3: Daily Tasks & Current Conditions */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 w-full">
                <div className="col-span-1 lg:col-span-2">
                  {/* Daily Tasks */}
                  <motion.div
                    animate={showCelebration ? { rotateY: 360 } : { rotateY: 0 }}
                    transition={{ duration: 1, type: "spring" }}
                    className="h-full"
                    style={{ perspective: 1000 }}
                  >
                    <GlassCard className="p-6 h-full relative overflow-hidden">
                      {showCelebration ? (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/80 backdrop-blur-sm z-10">
                           <motion.div initial={{scale: 0}} animate={{scale: 1, rotate: [0, -10, 10, -10, 10, 0]}} transition={{duration: 0.5}} className="text-6xl mb-4">🎉</motion.div>
                           <h2 className="text-2xl font-bold">All Tasks Complete!</h2>
                        </div>
                      ) : null}

                      <div className="flex items-center justify-between mb-4">
                        <h3 className="font-bold text-lg">Daily Tasks</h3>
                        <button onClick={() => setShowTaskAdd(!showTaskAdd)} className="text-on-surface-variant hover:text-primary transition-colors">
                          <Plus size={20} />
                        </button>
                      </div>

                      <AnimatePresence>
                        {showTaskAdd && (
                          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="mb-4 flex gap-2">
                            <input 
                              type="text" 
                              value={newTaskTitle}
                              onChange={(e) => setNewTaskTitle(e.target.value)}
                              placeholder="New task..."
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && newTaskTitle.trim()) {
                                  addRemoteTask(newTaskTitle);
                                  setNewTaskTitle('');
                                  setShowTaskAdd(false);
                                }
                              }}
                              className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary border-primary transition-colors"
                            />
                            <button 
                              onClick={() => {
                                if (newTaskTitle.trim()) {
                                  addRemoteTask(newTaskTitle);
                                  setNewTaskTitle('');
                                  setShowTaskAdd(false);
                                }
                              }}
                              className="bg-primary text-on-primary px-3 py-2 rounded-lg text-sm font-bold"
                            >
                              Add
                            </button>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      <div className="flex flex-col gap-3">
                        {tasks.map((task) => (
                          <div 
                            key={task.id} 
                            className="flex items-center justify-between gap-3 bg-white/5 hover:bg-white/10 transition-colors p-3 rounded-lg border border-white/5 group"
                          >
                            <div className="flex items-center gap-3 cursor-pointer flex-1" onClick={() => toggleRemoteTask(task.id, !task.done)}>
                              <div className={`w-5 h-5 rounded-md border flex items-center justify-center transition-colors ${task.done ? 'bg-primary border-primary' : 'border-on-surface-variant'}`}>
                                {task.done && <motion.div initial={{scale:0}} animate={{scale:1}}><CheckSquare size={14} className="text-on-primary fill-current" /></motion.div>}
                              </div>
                              <span className={`transition-all ${task.done ? 'text-on-surface-variant line-through' : 'text-on-surface'}`}>{task.label}</span>
                            </div>
                            <button onClick={() => deleteRemoteTask(task.id)} className="opacity-0 group-hover:opacity-100 transition-opacity text-error/80 hover:text-error p-1">
                               <X size={16} />
                            </button>
                          </div>
                        ))}
                        {tasks.length === 0 && (
                          <div className="text-center text-on-surface-variant py-4 text-sm">No tasks for today. Relax!</div>
                        )}
                      </div>
                    </GlassCard>
                  </motion.div>
                </div>
                
                <div className="col-span-1">
                  {/* Quick Weather Details */}
                  <GlassCard className="p-6 h-full">
                    <h3 className="font-bold text-lg mb-4">Current Conditions</h3>
                    <div className="grid grid-cols-2 lg:grid-cols-1 gap-4">
                      <div className="bg-white/5 hover:bg-white/10 transition-colors cursor-default p-4 rounded-xl flex items-center gap-4 border border-white/5">
                        <Droplet className="text-primary" size={24} />
                        <div>
                          <p className="text-xs text-on-surface-variant">Humidity</p>
                          <p className="text-lg font-bold">{weatherData ? `${weatherData.humidity}%` : '--%'}</p>
                        </div>
                      </div>
                      <div className="bg-white/5 hover:bg-white/10 transition-colors cursor-default p-4 rounded-xl flex items-center gap-4 border border-white/5">
                        <Wind className="text-primary" size={24} />
                        <div>
                          <p className="text-xs text-on-surface-variant">Wind Speed</p>
                          <p className="text-lg font-bold">{weatherData ? `${weatherData.windSpeedMph} mph` : '-- mph'}</p>
                        </div>
                      </div>
                    </div>
                  </GlassCard>
                </div>
              </div>

            </div>
          </motion.div>
        )}

        {/* Routine Tab */}
        {activeTab === 'routine' && (
          <motion.div key="routine-tab" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="flex flex-col gap-6">
             <div className="flex items-center justify-between">
               <div>
                 <h2 className="text-3xl font-extrabold tracking-tight glow-text flex items-center gap-3">
                   <Sun className="text-primary" size={32} />
                   Daily Skincare Routine
                 </h2>
                 <p className="text-on-surface-variant text-sm mt-1">
                   Dynamically updated by your AI Skin Analysis • Last updated {new Date(skincareRoutine.lastUpdated || Date.now()).toLocaleDateString()}
                 </p>
               </div>

               <button
                 onClick={() => {
                   navigateToDashboard('skin_analysis', 'manual');
                   window.dispatchEvent(new CustomEvent('orion_trigger_skin_analysis'));
                 }}
                 className="bg-primary text-on-primary px-5 py-2.5 rounded-full font-bold text-xs flex items-center gap-2 hover:bg-primary-container transition-all"
               >
                 <Sparkles size={16} /> Re-Analyze Skin
               </button>
             </div>

             <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-2">
               {/* Morning AM Routine Card */}
               <GlassCard className="p-6 relative overflow-hidden">
                 <div className="flex items-center justify-between mb-6 pb-4 border-b border-white/10">
                   <div className="flex items-center gap-3">
                     <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center border border-amber-500/30">
                       <Sun size={22} className="text-amber-400" />
                     </div>
                     <div>
                       <h3 className="font-extrabold text-lg text-white">Morning Routine</h3>
                       <p className="text-xs text-on-surface-variant">AM Defense & Hydration Protocol</p>
                     </div>
                   </div>
                   <span className="text-xs px-3 py-1 bg-amber-500/10 text-amber-300 font-semibold rounded-full border border-amber-500/20">3 Steps</span>
                 </div>

                 <div className="flex flex-col gap-4">
                   {skincareRoutine.morning.map((step) => (
                     <div
                       key={step.id}
                       onClick={() => {
                         const updated = {
                           ...skincareRoutine,
                           morning: skincareRoutine.morning.map(s => s.id === step.id ? { ...s, completed: !s.completed } : s)
                         };
                         updateSkincareRoutine(updated);
                       }}
                       className={`p-4 rounded-xl border transition-all cursor-pointer flex items-start gap-4 ${
                         step.completed ? 'bg-white/5 border-white/5 opacity-60' : 'bg-surface-container/60 border-white/10 hover:border-primary/40'
                       }`}
                     >
                       <div className={`w-6 h-6 rounded-md border flex items-center justify-center mt-0.5 shrink-0 ${
                         step.completed ? 'bg-primary border-primary text-on-primary' : 'border-on-surface-variant'
                       }`}>
                         {step.completed && <CheckSquare size={14} />}
                       </div>
                       <div className="flex-1">
                         <div className="flex items-center justify-between">
                           <h4 className={`font-bold text-sm ${step.completed ? 'line-through text-on-surface-variant' : 'text-white'}`}>{step.title}</h4>
                           {step.category !== 'lifestyle' && (
                             <span className="text-[10px] text-primary bg-primary/10 px-2 py-0.5 rounded-full font-mono">{step.productName}</span>
                           )}
                         </div>
                         {step.category === 'lifestyle' ? (
                           <p className="text-xs text-emerald-300 mt-1 font-medium">{step.productName}</p>
                         ) : null}
                         <p className="text-xs text-on-surface-variant mt-1 leading-relaxed">{step.reason}</p>
                       </div>
                     </div>
                   ))}
                 </div>
               </GlassCard>

               {/* Night PM Routine Card */}
               <GlassCard className="p-6 relative overflow-hidden">
                 <div className="flex items-center justify-between mb-6 pb-4 border-b border-white/10">
                   <div className="flex items-center gap-3">
                     <div className="w-10 h-10 rounded-full bg-indigo-500/20 flex items-center justify-center border border-indigo-500/30">
                       <Moon size={22} className="text-indigo-400" />
                     </div>
                     <div>
                       <h3 className="font-extrabold text-lg text-white">Night Routine</h3>
                       <p className="text-xs text-on-surface-variant">PM Repair & Barrier Recovery</p>
                     </div>
                   </div>
                   <span className="text-xs px-3 py-1 bg-indigo-500/10 text-indigo-300 font-semibold rounded-full border border-indigo-500/20">3 Steps</span>
                 </div>

                 <div className="flex flex-col gap-4">
                   {skincareRoutine.night.map((step) => (
                     <div
                       key={step.id}
                       onClick={() => {
                         const updated = {
                           ...skincareRoutine,
                           night: skincareRoutine.night.map(s => s.id === step.id ? { ...s, completed: !s.completed } : s)
                         };
                         updateSkincareRoutine(updated);
                       }}
                       className={`p-4 rounded-xl border transition-all cursor-pointer flex items-start gap-4 ${
                         step.completed ? 'bg-white/5 border-white/5 opacity-60' : 'bg-surface-container/60 border-white/10 hover:border-primary/40'
                       }`}
                     >
                       <div className={`w-6 h-6 rounded-md border flex items-center justify-center mt-0.5 shrink-0 ${
                         step.completed ? 'bg-primary border-primary text-on-primary' : 'border-on-surface-variant'
                       }`}>
                         {step.completed && <CheckSquare size={14} />}
                       </div>
                       <div className="flex-1">
                         <div className="flex items-center justify-between">
                           <h4 className={`font-bold text-sm ${step.completed ? 'line-through text-on-surface-variant' : 'text-white'}`}>{step.title}</h4>
                           {step.category !== 'lifestyle' && (
                             <span className="text-[10px] text-primary bg-primary/10 px-2 py-0.5 rounded-full font-mono">{step.productName}</span>
                           )}
                         </div>
                         {step.category === 'lifestyle' ? (
                           <p className="text-xs text-emerald-300 mt-1 font-medium">{step.productName}</p>
                         ) : null}
                         <p className="text-xs text-on-surface-variant mt-1 leading-relaxed">{step.reason}</p>
                       </div>
                     </div>
                   ))}
                 </div>
               </GlassCard>
             </div>
          </motion.div>
        )}

        {/* Gallery Tab */}
        {activeTab === 'gallery' && (
           <motion.div key="gallery-tab" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="flex flex-col gap-6">
             <div className="flex items-center justify-between">
               <h2 className="text-3xl font-bold">Analysis Gallery</h2>
               {gallery.length > 0 && (
                 <div className="flex gap-4">
                   <button 
                     onClick={() => {
                        clearGallery();
                     }}
                     className="text-error hover:text-error/80 px-4 py-2 rounded-xl border border-error/20 bg-error/10 hover:bg-error/20 transition-colors text-sm font-bold"
                   >
                     Clear All
                   </button>
                 </div>
               )}
             </div>
             {gallery.length === 0 ? (
                <GlassCard className="p-8 text-center text-on-surface-variant">
                   <p>Your previous scan captures and analysis records will appear here.</p>
                </GlassCard>
             ) : (
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                   {gallery.map(record => (
                      <GlassCard key={record.id} className="p-4 flex flex-col gap-3 group relative">
                         <div className="aspect-square bg-surface-container rounded-lg overflow-hidden relative border border-white/5">
                            {record.imageUrl ? (
                               <img src={record.imageUrl} alt="Skin Scan" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                            ) : (
                               <div className="w-full h-full flex items-center justify-center text-on-surface-variant text-xs">No Image</div>
                            )}
                            <div className="absolute top-2 right-2 bg-background/80 backdrop-blur px-2 py-1 rounded-md text-xs font-bold text-primary">Score: {record.score}</div>
                         </div>
                         <div>
                            <p className="text-sm font-bold">{new Date(record.date).toLocaleDateString()}</p>
                            <p className="text-xs text-on-surface-variant">{new Date(record.date).toLocaleTimeString()}</p>
                         </div>
                         <button 
                           onClick={() => {
                               deleteGalleryImages([record.id]);
                           }}
                           className="absolute top-2 left-2 p-2 bg-error/80 text-white rounded-lg opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur hover:bg-error"
                         >
                           <X size={14} />
                         </button>
                      </GlassCard>
                   ))}
                </div>
             )}
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* Event Add Modal */}
      {showEventModal && selectedDate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="w-full max-w-md bg-surface-container rounded-2xl border border-white/10 shadow-2xl overflow-hidden"
          >
            <div className="flex items-center justify-between p-6 border-b border-white/5">
              <h3 className="font-bold text-xl">Schedule Event</h3>
              <button 
                onClick={() => setShowEventModal(false)}
                className="p-2 text-on-surface-variant hover:text-white transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            
            <div className="p-6 flex flex-col gap-6">
              <div className="bg-white/5 px-4 py-3 rounded-lg flex items-center gap-3">
                <CalendarIcon size={18} className="text-primary" />
                <span className="font-medium text-sm">
                  {new Date(selectedDate.year, selectedDate.month, selectedDate.day).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                </span>
              </div>
              
              <div className="flex flex-col gap-2">
                <label className="text-sm font-semibold text-on-surface-variant">Event Type</label>
                <select 
                  className="w-full bg-surface border border-white/10 rounded-lg p-3 outline-none focus:border-primary/50 text-white appearance-none"
                  value={eventModalType}
                  onChange={(e) => setEventModalType(e.target.value)}
                >
                  <option value="birthday">Birthday</option>
                  <option value="meeting">Meeting</option>
                  <option value="anniversary">Anniversary</option>
                  <option value="reminder">Reminder</option>
                  <option value="deadline">Deadline</option>
                </select>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-sm font-semibold text-on-surface-variant">Event Title</label>
                <input 
                  type="text" 
                  value={eventModalTitle}
                  onChange={(e) => setEventModalTitle(e.target.value)}
                  placeholder="e.g. John's Birthday Party"
                  className="w-full bg-surface border border-white/10 rounded-lg p-3 outline-none focus:border-primary/50 text-white"
                />
              </div>

              <button 
                onClick={addEvent}
                disabled={!eventModalTitle.trim()}
                className="w-full bg-primary text-on-primary py-3 rounded-xl font-bold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary/90 transition-colors shadow-lg"
              >
                Add Event
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Weather Forecast Modal */}
      <AnimatePresence>
        {showWeatherModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }} 
              className="absolute inset-0 bg-black/60 backdrop-blur-md"
              onClick={() => setShowWeatherModal(false)}
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="w-full max-w-lg bg-surface-container rounded-3xl border border-white/10 shadow-2xl overflow-hidden relative z-10"
            >
              {/* Modal Header */}
              <div className="p-8 pb-6 border-b border-white/5 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-64 h-64 bg-primary/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/4 pointer-events-none"></div>
                <div className="flex items-start justify-between relative z-10">
                  <div>
                    <h2 className="text-3xl font-extrabold tracking-tight mb-2">Weather Forecast</h2>
                    <p className="text-primary font-medium flex items-center gap-2">
                      <Wind size={16} /> {weatherData?.city || 'Bangalore, India'}
                    </p>
                  </div>
                  <button 
                    onClick={() => setShowWeatherModal(false)}
                    className="p-2 bg-white/5 hover:bg-white/10 rounded-full text-on-surface-variant hover:text-white transition-colors"
                  >
                    <X size={20} />
                  </button>
                </div>
              </div>
              
              <div className="p-8 flex flex-col gap-8 bg-surface/50">
                
                {/* Today's Timeline */}
                <div>
                  <h4 className="text-sm font-bold text-on-surface-variant uppercase tracking-wider mb-4">Today's Timeline</h4>
                  <div className="flex justify-between items-end gap-2 overflow-x-auto pb-2">
                    {(weatherData?.timeline && weatherData.timeline.length > 0 ? weatherData.timeline : [
                      { time: '08:00 AM', status: 'Sunny', temp: '68°F', weatherCode: 0 },
                      { time: '11:00 AM', status: 'Cloudy', temp: '71°F', weatherCode: 2 },
                      { time: '02:00 PM', status: 'Rainy', temp: '69°F', weatherCode: 61 },
                      { time: '05:00 PM', status: 'Sunny', temp: '73°F', weatherCode: 0 },
                      { time: '08:00 PM', status: 'Clear', temp: '65°F', weatherCode: 0 },
                    ]).map((item, idx) => (
                      <div key={idx} className="flex flex-col items-center gap-3 flex-1 min-w-[60px]">
                        <span className="text-[11px] font-semibold text-on-surface-variant whitespace-nowrap">{item.time}</span>
                        <div className="w-12 h-12 rounded-full bg-surface border border-white/5 flex items-center justify-center shadow-lg hover:border-primary/30 transition-colors">
                          {renderWeatherIcon(item.weatherCode)}
                        </div>
                        <span className="font-bold text-sm">{item.temp}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Extended Forecast */}
                <div>
                   <h4 className="text-sm font-bold text-on-surface-variant uppercase tracking-wider mb-4">Seven-Day Forecast</h4>
                   <div className="flex flex-col gap-3 max-h-[260px] overflow-y-auto pr-1">
                      {(weatherData?.dailyForecast && weatherData.dailyForecast.length > 0 ? weatherData.dailyForecast : [
                        { day: 'Today', status: 'Sunny', tempRange: '65°F - 78°F', weatherCode: 0 },
                        { day: 'Tomorrow', status: 'Partly Cloudy', tempRange: '66°F - 76°F', weatherCode: 2 },
                        { day: 'Thursday', status: 'Cloudy', tempRange: '64°F - 72°F', weatherCode: 3 },
                        { day: 'Friday', status: 'Slight Rain', tempRange: '62°F - 70°F', weatherCode: 61 },
                        { day: 'Saturday', status: 'Clear', tempRange: '65°F - 79°F', weatherCode: 0 },
                        { day: 'Sunday', status: 'Sunny', tempRange: '67°F - 81°F', weatherCode: 0 },
                        { day: 'Monday', status: 'Partly Cloudy', tempRange: '66°F - 77°F', weatherCode: 1 }
                      ]).map((day, idx) => (
                        <div key={idx} className={`flex items-center justify-between p-4 rounded-2xl border transition-all ${day.day === 'Today' ? 'bg-primary/10 border-primary/20 shadow-md' : 'bg-surface border-white/5 hover:bg-white/5'}`}>
                          <div className="w-28 font-bold">{day.day}</div>
                          <div className="flex items-center gap-3 flex-1 px-4">
                            {renderWeatherIcon(day.weatherCode)}
                            <span className="text-sm font-medium text-on-surface-variant">{day.status}</span>
                          </div>
                          <div className="font-semibold text-right text-sm">{day.tempRange}</div>
                        </div>
                      ))}
                   </div>
                </div>

              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Alarm / Timer / Stopwatch Modal */}
      <AnimatePresence>
        {showAlarmModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }} 
              className="absolute inset-0 bg-black/60 backdrop-blur-md"
              onClick={() => setShowAlarmModal(false)}
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="w-full max-w-lg bg-surface-container rounded-3xl border border-white/10 shadow-2xl overflow-hidden relative z-10"
            >
              <div className="p-8 pb-6 border-b border-white/5 flex items-center justify-between">
                <h2 className="text-2xl font-extrabold tracking-tight">Time & Alarms</h2>
                <button 
                  onClick={() => setShowAlarmModal(false)}
                  className="p-2 bg-white/5 hover:bg-white/10 rounded-full transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="flex border-b border-white/5 overflow-x-auto">
                {['alarm', 'timer', 'stopwatch'].map(tab => (
                   <button 
                     key={tab}
                     onClick={() => setAlarmTab(tab as any)}
                     className={`flex-1 p-4 capitalize font-bold transition-colors ${alarmTab === tab ? 'text-primary border-b-2 border-primary bg-primary/5' : 'text-on-surface-variant hover:text-white'}`}
                   >
                     {tab}
                   </button>
                ))}
              </div>
              
              <div className="p-8 min-h-[300px]">
                {alarmTab === 'alarm' && (
                  <div className="flex flex-col gap-6">
                    <div>
                      <label className="block text-sm font-bold text-on-surface-variant mb-4 flex justify-center uppercase tracking-widest cursor-default">Set Alarm Time</label>
                      <div className="flex justify-center items-center gap-4 text-5xl font-extrabold font-mono text-primary select-none">
                        <div 
                          className="w-24 h-24 bg-surface rounded-2xl flex items-center justify-center cursor-ns-resize shadow-inner border border-white/5 relative overflow-hidden group" 
                          onWheel={handleWheelHour}
                        >
                          <div className="absolute inset-x-0 top-0 h-8 bg-gradient-to-b from-black/20 to-transparent pointer-events-none"></div>
                          <div className="absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-black/20 to-transparent pointer-events-none"></div>
                          <span className="group-hover:scale-110 transition-transform">{alarmHour.toString().padStart(2, '0')}</span>
                        </div>
                        <span className="text-on-surface-variant animate-pulse">:</span>
                        <div 
                          className="w-24 h-24 bg-surface rounded-2xl flex items-center justify-center cursor-ns-resize shadow-inner border border-white/5 relative overflow-hidden group"
                          onWheel={handleWheelMinute}
                        >
                          <div className="absolute inset-x-0 top-0 h-8 bg-gradient-to-b from-black/20 to-transparent pointer-events-none"></div>
                          <div className="absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-black/20 to-transparent pointer-events-none"></div>
                          <span className="group-hover:scale-110 transition-transform">{alarmMinute.toString().padStart(2, '0')}</span>
                        </div>
                        <div 
                          className="w-24 h-24 bg-surface rounded-2xl flex items-center justify-center cursor-pointer shadow-inner border border-white/5 text-4xl ml-2 relative overflow-hidden text-accent hover:bg-white/5 transition-colors group"
                          onClick={() => setAlarmAmPm(p => p === 'AM' ? 'PM' : 'AM')}
                          onWheel={handleWheelAmPm}
                        >
                           <div className="absolute inset-x-0 top-0 h-8 bg-gradient-to-b from-black/20 to-transparent pointer-events-none"></div>
                          <div className="absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-black/20 to-transparent pointer-events-none"></div>
                          <span className="group-hover:scale-110 transition-transform">{alarmAmPm}</span>
                        </div>
                      </div>
                      <p className="text-center text-xs text-on-surface-variant mt-4 uppercase tracking-widest font-bold">Scroll up/down to change</p>
                    </div>
                    <div>
                      <label className="block text-sm font-bold text-on-surface-variant mb-2">Ringtone</label>
                      <select 
                        value={alarmRingtone} 
                        onChange={e => setAlarmRingtone(e.target.value)}
                        className="w-full bg-surface border border-white/10 rounded-xl p-4 focus:outline-none focus:border-primary/50 appearance-none font-bold cursor-pointer"
                      >
                        {RINGTONE_OPTIONS.map(opt => (
                          <option key={opt.url} value={opt.url}>{opt.name}</option>
                        ))}
                      </select>
                    </div>
                    <button 
                      onClick={() => setIsAlarmSet(!isAlarmSet)}
                      className={`mt-4 py-4 rounded-xl font-extrabold text-lg transition-all ${isAlarmSet ? 'bg-error/20 text-error hover:bg-error/30' : 'bg-primary text-on-primary hover:scale-[1.02] shadow-[0_0_20px_rgba(164,201,255,0.3)]'}`}
                    >
                      {isAlarmSet ? 'Cancel Alarm' : 'Set Alarm'}
                    </button>
                    {isAlarmSet && (
                      <p className="text-center text-primary text-sm font-medium mt-2">Alarm active for {alarmTime}</p>
                    )}
                  </div>
                )}

                {alarmTab === 'timer' && (
                  <div className="flex flex-col items-center justify-center gap-8 py-4">
                     {!isTimerRunning ? (
                       <>
                         <div className="flex gap-4 items-center mt-2 mb-2 text-5xl font-extrabold font-mono text-primary select-none">
                           <div className="flex flex-col items-center">
                             <div 
                               className="w-24 h-24 bg-surface rounded-2xl flex items-center justify-center cursor-ns-resize shadow-inner border border-white/5 relative overflow-hidden group" 
                               onWheel={handleWheelTimerMinute}
                             >
                               <div className="absolute inset-x-0 top-0 h-8 bg-gradient-to-b from-black/20 to-transparent pointer-events-none"></div>
                               <div className="absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-black/20 to-transparent pointer-events-none"></div>
                               <span className="group-hover:scale-110 transition-transform">{String(timerMinutes).padStart(2, '0')}</span>
                             </div>
                             <span className="text-xs text-on-surface-variant mt-4 font-bold uppercase tracking-widest font-sans">Min</span>
                           </div>
                           <span className="text-on-surface-variant mb-10 animate-pulse">:</span>
                           <div className="flex flex-col items-center">
                             <div 
                               className="w-24 h-24 bg-surface rounded-2xl flex items-center justify-center cursor-ns-resize shadow-inner border border-white/5 relative overflow-hidden group" 
                               onWheel={handleWheelTimerSecond}
                             >
                               <div className="absolute inset-x-0 top-0 h-8 bg-gradient-to-b from-black/20 to-transparent pointer-events-none"></div>
                               <div className="absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-black/20 to-transparent pointer-events-none"></div>
                               <span className="group-hover:scale-110 transition-transform">{String(timerSeconds).padStart(2, '0')}</span>
                             </div>
                             <span className="text-xs text-on-surface-variant mt-4 font-bold uppercase tracking-widest font-sans">Sec</span>
                           </div>
                         </div>
                         <p className="text-center text-xs text-on-surface-variant mb-4 uppercase tracking-widest font-bold">Scroll up/down to change</p>
                       </>
                     ) : (
                       <div className="text-7xl font-extrabold tracking-tighter mb-4 font-mono text-primary drop-shadow-[0_0_15px_rgba(164,201,255,0.3)]">
                         {String(timerMinutes).padStart(2, '0')}:{String(timerSeconds).padStart(2, '0')}
                       </div>
                     )}
                     
                     <div className="flex gap-4">
                       <button 
                         onClick={() => setIsTimerRunning(!isTimerRunning)} 
                         className={`w-16 h-16 rounded-full flex items-center justify-center ${isTimerRunning ? 'bg-error/20 text-error' : 'bg-primary/20 text-primary'}`}
                       >
                         {isTimerRunning ? <Square fill="currentColor" /> : <Play fill="currentColor" className="ml-1" />}
                       </button>
                       <button 
                         onClick={() => { setIsTimerRunning(false); setTimerMinutes(5); setTimerSeconds(0); }}
                         className="w-16 h-16 rounded-full flex items-center justify-center bg-surface-container-high text-on-surface-variant hover:text-white transition-colors"
                       >
                         <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                       </button>
                     </div>
                  </div>
                )}

                {alarmTab === 'stopwatch' && (
                  <div className="flex flex-col items-center justify-center gap-8 py-8">
                     <div className="text-7xl font-extrabold tracking-tighter font-mono text-accent drop-shadow-[0_0_15px_rgba(194,193,255,0.3)] min-w-[280px] text-center">
                       {String(Math.floor(stopwatchTime / 600)).padStart(2, '0')}:
                       {String(Math.floor((stopwatchTime % 600) / 10)).padStart(2, '0')}.
                       <span className="text-5xl">{stopwatchTime % 10}</span>
                     </div>
                     <div className="flex gap-4">
                       <button 
                         onClick={() => setIsStopwatchRunning(!isStopwatchRunning)} 
                         className={`w-16 h-16 rounded-full flex items-center justify-center ${isStopwatchRunning ? 'bg-error/20 text-error' : 'bg-primary/20 text-primary'}`}
                       >
                         {isStopwatchRunning ? <Square fill="currentColor" /> : <Play fill="currentColor" className="ml-1" />}
                       </button>
                       <button 
                         onClick={() => { setIsStopwatchRunning(false); setStopwatchTime(0); }}
                         className="w-16 h-16 rounded-full flex items-center justify-center bg-surface-container-high text-on-surface-variant hover:text-white transition-colors"
                       >
                         <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                       </button>
                     </div>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isRinging && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center">
            <motion.div 
               initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
               className="absolute inset-0 bg-black/90 backdrop-blur-xl"
            />
            <motion.div 
               initial={{ scale: 0.8, opacity: 0 }}
               animate={{ scale: [1, 1.05, 1], opacity: 1 }}
               transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
               className="relative z-10 flex flex-col items-center text-center p-8"
            >
               <div className="w-32 h-32 rounded-full bg-primary/20 flex items-center justify-center mb-8 border-4 border-primary shadow-[0_0_50px_rgba(164,201,255,0.4)]">
                 <AlarmClock size={64} className="text-primary animate-[ping_2s_cubic-bezier(0,0,0.2,1)_infinite]" />
               </div>
               <h1 className="text-5xl font-extrabold mb-4 text-white">Alarm</h1>
               <p className="text-xl text-primary font-bold mb-12 select-none tracking-widest">{timeString}</p>
               <button 
                 onClick={stopAlarm}
                 className="px-12 py-4 bg-error text-white font-extrabold text-xl rounded-full shadow-[0_0_30px_rgba(255,84,73,0.5)] hover:scale-110 transition-transform"
               >
                 STOP ALARM
               </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showMakeupMirror && (
          <div className="fixed inset-0 pointer-events-none z-[110] flex items-center justify-center p-8">
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="pointer-events-auto relative w-80 sm:w-96 aspect-[3/4] bg-surface rounded-[2rem] border-[3px] animate-glow-pulse overflow-hidden flex flex-col"
            >
              <div className="absolute top-4 right-4 z-10 w-10 h-10 bg-black/40 backdrop-blur-md rounded-full flex justify-center items-center cursor-pointer hover:bg-black/60 transition-colors" onClick={() => setShowMakeupMirror(false)}>
                <X className="w-5 h-5 text-white" />
              </div>
              <MakeupCamera />
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
