import React, { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import localforage from 'localforage';
import { createConnection, subscribeEntities, createLongLivedTokenAuth, callService } from 'home-assistant-js-websocket';
import { SmartDevice, SmartDeviceCapability, SkinAnalysisRecord, BrowserActivity, SkincareRoutine } from '../types';
import { generateDynamicRoutine } from '../lib/skinRecommendations';
import { AppUser, signInWithGoogleLocal, setGoogleTokens, clearGoogleTokens, getValidAccessToken, fetchGoogleUserProfile } from '../lib/googleAuth';
import {
  OrionCalendarEvent,
  clearGoogleCalendarSyncState,
  getEventTypeColor,
  loadCachedGoogleCalendarEvents,
  parseSyncedEventId,
  syncGoogleCalendars,
} from '../lib/googleCalendarSync';
import { io, Socket } from 'socket.io-client';
import { detectDashboardNavigationIntent, navigateToDashboard } from '../lib/dashboardRoutes';

type Event = OrionCalendarEvent;

interface Task {
  id: string | number;
  label: string;
  done: boolean;
}

interface VoiceCommandResult {
  text: string;
  needsBrowser?: boolean;
  browserPrompt?: string;
}

interface AppContextType {
  theme: 'dark' | 'light';
  setTheme: (t: 'dark' | 'light') => void;
  accentColor: string;
  setAccentColor: (c: string) => void;
  tasks: Task[];
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>;
  events: Event[];
  setEvents: React.Dispatch<React.SetStateAction<Event[]>>;
  devices: SmartDevice[];
  setDevices: React.Dispatch<React.SetStateAction<SmartDevice[]>>;
  gallery: SkinAnalysisRecord[];
  addGalleryImage: (img: SkinAnalysisRecord) => void;
  deleteGalleryImages: (ids: string[]) => void;
  clearGallery: () => void;
  skincareRoutine: SkincareRoutine;
  updateSkincareRoutine: (routine: SkincareRoutine) => void;
  processVoiceCommand: (cmd: string) => Promise<VoiceCommandResult>;
  timeWidget: 'digital' | 'analog';
  setTimeWidget: (t: 'digital' | 'analog') => void;
  user: AppUser | null;
  authLoading: boolean;
  calendarSyncStatus: 'idle' | 'syncing' | 'synced' | 'error';
  customProfileImage: string | null;
  setCustomProfileImage: (img: string | null) => void;
  login: () => Promise<void>;
  logoutUser: () => Promise<void>;
  addCalendarEvent: (day: number, month: number, year: number, title: string, type: string) => Promise<void>;
  deleteCalendarEvent: (id: string) => Promise<void>;
  editCalendarEvent: (id: string, updates: Partial<Omit<Event, 'id'>>) => Promise<void>;
  addRemoteTask: (title: string) => Promise<void>;
  toggleRemoteTask: (id: string | number, done: boolean) => Promise<void>;
  deleteRemoteTask: (id: string | number) => Promise<void>;
  editRemoteTask: (id: string | number, title: string) => Promise<void>;
  callHAService: (domain: string, service: string, serviceData?: any) => Promise<void>;
  
  // Orion Backend State
  isOrionConnected: boolean;
  isOrionListening: boolean;
  toggleOrionListening: () => void;
  orionBrowserImage: string | null;
  orionBrowserLogs: string[];
  browserActivity: BrowserActivity;
  sendBrowserPrompt: (prompt: string) => void;
  sendManualBrowserAction: (actionData: any) => void;
  isBrowserVisible: boolean;
  setBrowserVisible: (v: boolean) => void;
}

export const AppContext = createContext<AppContextType | null>(null);

const themes = {
  dark: {
    '--color-background': '#000000',
    '--color-surface': '#000000',
    '--color-surface-container': '#0c0c0c',
    '--color-surface-container-high': '#141414',
    '--color-surface-container-highest': '#1f1f1f',
    '--color-on-background': '#ffffff',
    '--color-on-surface-variant': '#cbd5e1',
  },
  light: {
    '--color-background': '#000000',
    '--color-surface': '#050505',
    '--color-surface-container': '#101010',
    '--color-surface-container-high': '#1a1a1a',
    '--color-surface-container-highest': '#242424',
    '--color-on-background': '#ffffff',
    '--color-on-surface-variant': '#cbd5e1',
  }
};

const accents: Record<string, any> = {
  blue: {
    '--color-primary': '#38bdf8',
    '--color-primary-container': '#0284c7',
    '--color-secondary': '#818cf8',
    '--color-accent-glow': 'rgba(56, 189, 248, 0.45)',
  },
  purple: {
    '--color-primary': '#c084fc',
    '--color-primary-container': '#9333ea',
    '--color-secondary': '#e879f9',
    '--color-accent-glow': 'rgba(192, 132, 252, 0.45)',
  },
  orange: {
    '--color-primary': '#fb923c',
    '--color-primary-container': '#ea580c',
    '--color-secondary': '#facc15',
    '--color-accent-glow': 'rgba(251, 146, 60, 0.45)',
  },
  green: {
    '--color-primary': '#4ade80',
    '--color-primary-container': '#16a34a',
    '--color-secondary': '#2dd4bf',
    '--color-accent-glow': 'rgba(74, 222, 128, 0.45)',
  },
  pink: {
    '--color-primary': '#f472b6',
    '--color-primary-container': '#db2777',
    '--color-secondary': '#fb7185',
    '--color-accent-glow': 'rgba(244, 114, 182, 0.45)',
  },
};

export const AppProvider = ({ children }: { children: ReactNode }) => {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [accentColor, setAccentColor] = useState('blue');
  const [timeWidget, setTimeWidget] = useState<'digital' | 'analog'>('digital');
  const [user, setUser] = useState<AppUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [calendarSyncStatus, setCalendarSyncStatus] = useState<'idle' | 'syncing' | 'synced' | 'error'>('idle');
  const [customProfileImage, setCustomProfileImage] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([
    { id: 1, label: 'Morning Skincare Routine', done: true },
    { id: 2, label: 'Meeting at 2 PM', done: false },
    { id: 3, label: 'Gym at 5 PM', done: false },
    { id: 4, label: 'Buy Groceries', done: false },
  ]);
  const [events, setEvents] = useState<Event[]>([]);
  const [devices, setDevices] = useState<SmartDevice[]>([]);
  const [gallery, setGallery] = useState<SkinAnalysisRecord[]>([]);
  const [skincareRoutine, setSkincareRoutine] = useState<SkincareRoutine>(generateDynamicRoutine({}));

  // Orion Backend State
  const [isOrionConnected, setIsOrionConnected] = useState(false);
  const [isOrionListening, setIsOrionListening] = useState(false);
  const [orionBrowserImage, setOrionBrowserImage] = useState<string | null>(null);
  const [orionBrowserLogs, setOrionBrowserLogs] = useState<string[]>([]);
  const [browserActivity, setBrowserActivity] = useState<BrowserActivity>({
     status: 'idle',
     step: 0,
     totalSteps: 20
  });
  const [isBrowserVisible, setIsBrowserVisible] = useState(false);
  const orionSocketRef = useRef<Socket | null>(null);
  const eventsRef = useRef<Event[]>(events);
  const tasksRef = useRef<Task[]>(tasks);
  const syncSignatureRef = useRef('');
  const syncTimerRef = useRef<number | null>(null);
  const voiceNavigationBufferRef = useRef('');
  const voiceNavigationTimerRef = useRef<number | null>(null);
  const lastVoiceNavigationRef = useRef<{ view: string; at: number } | null>(null);
  
  // Audio Pipeline Refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const audioWorkletNodeRef = useRef<AudioWorkletNode | null>(null);
  const playbackContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);

  const haConnectionRef = useRef<any>(null);
  const browserRecognitionRef = useRef<any>(null);

  const idsEqual = (a: string | number | undefined | null, b: string | number | undefined | null) => {
    if (a === undefined || a === null || b === undefined || b === null) return false;
    return String(a) === String(b);
  };

  const normalizeText = (value: unknown) => String(value ?? '').trim().toLowerCase();

  const getGoogleUserKey = (profile: AppUser | null = user) => {
    return profile?.id || profile?.email || 'default_user';
  };

  const toNumber = (value: unknown, fallback: number) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  };

  const resolveCalendarEvent = (data: any) => {
    const title = normalizeText(data.title);
    let candidates = eventsRef.current;

    if (data.id !== undefined && data.id !== null) {
      const byId = candidates.find(event => idsEqual(event.id, data.id));
      if (byId) return byId;
    }

    if (title) {
      candidates = candidates.filter(event => {
        const eventTitle = normalizeText(event.title);
        return eventTitle === title || eventTitle.includes(title) || title.includes(eventTitle);
      });
    }

    if (data.year !== undefined && data.year !== null) {
      candidates = candidates.filter(event => event.year === Number(data.year));
    }
    if (data.month !== undefined && data.month !== null) {
      candidates = candidates.filter(event => event.month === Number(data.month));
    }
    if (data.day !== undefined && data.day !== null && candidates.length > 1) {
      candidates = candidates.filter(event => event.day === Number(data.day));
    }

    return candidates[0] || null;
  };

  const resolveTask = (data: any) => {
    const title = normalizeText(data.title);
    if (data.id !== undefined && data.id !== null) {
      const byId = tasksRef.current.find(task => idsEqual(task.id, data.id));
      if (byId) return byId;
    }

    if (!title) return null;
    return tasksRef.current.find(task => {
      const label = normalizeText(task.label);
      return label === title || label.includes(title) || title.includes(label);
    }) || null;
  };

  const stopMicrophoneCapture = () => {
    if (audioWorkletNodeRef.current) {
      audioWorkletNodeRef.current.port.onmessage = null;
      audioWorkletNodeRef.current.disconnect();
      audioWorkletNodeRef.current = null;
    }
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => undefined);
      audioContextRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
  };

  const callHAService = async (domain: string, service: string, serviceData?: any) => {
    if (haConnectionRef.current) {
      try {
        await callService(haConnectionRef.current, domain, service, serviceData);
      } catch (e) {
        console.error("HA Service Call failed:", e);
      }
    } else {
      console.warn("HA not connected. Operating in mock mode.");
    }
  };
  
  const stopFrontendPlayback = () => {
     console.log("stopFrontendPlayback called. Stopping", activeSourcesRef.current.length, "sources.");
     activeSourcesRef.current.forEach(source => {
        try {
           source.stop();
        } catch(e) {
           // Might already be stopped
        }
     });
     activeSourcesRef.current = [];
     if (playbackContextRef.current) {
        nextStartTimeRef.current = playbackContextRef.current.currentTime;
     }
  };

  const dashboardSyncSignature = (nextEvents: Event[], nextTasks: Task[]) => JSON.stringify({
     events: nextEvents.map(event => ({
        id: event.id,
        day: event.day,
        month: event.month,
        year: event.year,
        title: event.title,
        type: event.type || ''
     })),
     tasks: nextTasks.map(task => ({
        id: task.id,
        label: task.label,
        done: task.done
     }))
  });

  const emitDashboardSync = (nextEvents = eventsRef.current, nextTasks = tasksRef.current, immediate = false) => {
     const socket = orionSocketRef.current;
     if (!socket?.connected) return;

     const send = () => {
        syncTimerRef.current = null;
        const currentEvents = eventsRef.current;
        const currentTasks = tasksRef.current;
        const signature = dashboardSyncSignature(currentEvents, currentTasks);
        if (signature === syncSignatureRef.current) return;
        socket.emit('sync_data', { events: currentEvents, tasks: currentTasks });
        syncSignatureRef.current = signature;
     };

     const signature = dashboardSyncSignature(nextEvents, nextTasks);
     if (signature === syncSignatureRef.current) return;

     if (immediate) {
        if (syncTimerRef.current !== null) {
           window.clearTimeout(syncTimerRef.current);
           syncTimerRef.current = null;
        }
        send();
        return;
     }

     if (syncTimerRef.current === null) {
        syncTimerRef.current = window.setTimeout(send, 200);
     }
  };

  useEffect(() => {
    // Connect to Orion Python Backend
    const socketHost = window.location.hostname || '127.0.0.1';
    const socket = io(`http://${socketHost}:${(import.meta as any).env?.VITE_ORION_PYTHON_PORT || 8001}`, {
       transports: ['websocket'],
       upgrade: false,
       reconnection: true,
       reconnectionAttempts: Infinity,
       reconnectionDelay: 500,
       reconnectionDelayMax: 3000,
    });
    
    socket.on('connect', () => {
       console.log('Connected to Orion Backend via Socket.IO');
       setIsOrionConnected(true);
       syncSignatureRef.current = '';
       emitDashboardSync(eventsRef.current, tasksRef.current, true);
    });

    socket.on('disconnect', () => {
       console.log('Disconnected from Orion Backend');
       setIsOrionConnected(false);
       setIsOrionListening(false);
       stopFrontendPlayback();
       stopMicrophoneCapture();
    });

    socket.on('browser_frame', (data: { image?: string | null, log?: string, state?: BrowserActivity }) => {
       if (data.image) {
          setOrionBrowserImage(data.image);
       }
       if (data.log) {
          setOrionBrowserLogs(prev => [...prev, data.log]);
       }
       if (data.state) {
          setBrowserActivity(data.state);
          if (data.state.status === 'starting' || data.state.status === 'running') {
             setIsBrowserVisible(true);
          } else if (data.state.status === 'success' || data.state.status === 'failed') {
             setTimeout(() => {
                setIsBrowserVisible(false);
             }, 5000);
          }
       }
    });

    socket.on('browser_log', (data: { msg: string }) => {
       setOrionBrowserLogs(prev => [...prev, data.msg]);
    });

    socket.on('browser_command', (data: any) => {
       setIsBrowserVisible(true);
       window.setTimeout(() => {
          window.dispatchEvent(new CustomEvent('orion_browser_command', { detail: data }));
       }, 0);
    });

    socket.on('browser_command_cancel', (data: any) => {
       window.dispatchEvent(new CustomEvent('orion_browser_command_cancel', { detail: data || {} }));
    });

    const browserCommandResultHandler = (event: globalThis.Event) => {
       const customEvent = event as CustomEvent;
       if (socket.connected) {
          socket.emit('browser_command_result', customEvent.detail || {});
       }
    };
    window.addEventListener('orion_browser_command_result', browserCommandResultHandler as EventListener);

    socket.on('ha_command', (data: { domain: string, service: string, data: any }) => {
       console.log('Orion Backend triggered Home Assistant command:', data);
       callHAService(data.domain, data.service, data.data);
    });

    const dispatchDetectedNavigation = (text: string, source: string) => {
       const intent = detectDashboardNavigationIntent(text);
       if (!intent) return false;

       const now = performance.now();
       const last = lastVoiceNavigationRef.current;
       if (last?.view === intent.view && now - last.at < 1200) return true;

       lastVoiceNavigationRef.current = { view: intent.view, at: now };
       voiceNavigationBufferRef.current = '';
       navigateToDashboard(intent.view, source, {
          confidence: intent.confidence,
          matchedAlias: intent.matchedAlias,
       });
       return true;
    };

    socket.on('transcription', (data: { sender: 'User' | 'Orion'; text: string }) => {
       if (data.sender === 'User') {
          // If user starts speaking, stop AI playback immediately. The transcript UI is intentionally hidden.
          stopFrontendPlayback();

          const nextBuffer = `${voiceNavigationBufferRef.current} ${data.text || ''}`.replace(/\s+/g, ' ').trim();
          voiceNavigationBufferRef.current = nextBuffer.slice(-180);
          dispatchDetectedNavigation(voiceNavigationBufferRef.current, 'frontend_transcript');

          if (voiceNavigationTimerRef.current !== null) {
             window.clearTimeout(voiceNavigationTimerRef.current);
          }
          voiceNavigationTimerRef.current = window.setTimeout(() => {
             voiceNavigationBufferRef.current = '';
             voiceNavigationTimerRef.current = null;
          }, 1800);
       }
    });

    socket.on('stop_playback', () => {
       console.log("Received stop_playback from server.");
       stopFrontendPlayback();
    });

    socket.on('frontend_action', async (data: any) => {
       console.log("Received frontend_action from server:", data);
       if (data.tool === 'navigate_dashboard') {
          navigateToDashboard(data.view || data.dashboard || data.target, data.source || 'backend_voice', {
             confidence: data.confidence,
             matchedAlias: data.matched_alias || data.matchedAlias,
          });
       } else if (data.tool === 'analyze_skin') {
          navigateToDashboard('skin_analysis', 'tool_action');
          setTimeout(() => {
             window.dispatchEvent(new CustomEvent('orion_trigger_skin_analysis'));
          }, 100);
       } else if (data.tool === 'manage_calendar') {
          const today = new Date();
          const day = toNumber(data.day, today.getDate());
          const month = toNumber(data.month, today.getMonth());
          const year = toNumber(data.year, today.getFullYear());

          if (data.action === 'add') {
             await addCalendarEvent(day, month, year, data.title || 'New Event', data.type || 'meeting');
             navigateToDashboard('dashboard', 'tool_action');
          } else {
             const event = resolveCalendarEvent(data);
             if (!event) {
                console.warn('Calendar event could not be resolved for voice action:', data);
                return;
             }

             if (data.action === 'delete' || data.action === 'remove') {
                await deleteCalendarEvent(event.id);
             } else if (data.action === 'edit' || data.action === 'move') {
                await editCalendarEvent(event.id, {
                   title: data.newTitle || (data.action === 'edit' ? data.title : undefined),
                   type: data.newType || undefined,
                   day: data.newDay ?? (data.action === 'move' ? data.day : undefined),
                   month: data.newMonth ?? (data.action === 'move' ? data.month : undefined),
                   year: data.newYear ?? (data.action === 'move' ? data.year : undefined),
                });
             }
             navigateToDashboard('dashboard', 'tool_action');
          }
       } else if (data.tool === 'manage_music') {
          window.dispatchEvent(new CustomEvent('spotify_voice_action', { detail: data }));
       } else if (data.tool === 'manage_tasks') {
          if (data.action === 'add' || data.action === 'remind') {
             await addRemoteTask(data.action === 'remind' ? `Reminder: ${data.title || 'New reminder'}` : data.title || 'New Task');
             navigateToDashboard('dashboard', 'tool_action');
             return;
          }

          const task = resolveTask(data);
          if (!task) {
             console.warn('Task could not be resolved for voice action:', data);
             return;
          }

          if (data.action === 'toggle' || data.action === 'complete' || data.action === 'reopen') {
             const nextDone = typeof data.done === 'boolean' ? data.done : data.action === 'complete' ? true : data.action === 'reopen' ? false : !task.done;
             await toggleRemoteTask(task.id, nextDone);
          } else if (data.action === 'remove' || data.action === 'delete') {
             await deleteRemoteTask(task.id);
          } else if (data.action === 'edit') {
             await editRemoteTask(task.id, data.newTitle || data.title || task.label);
          }
          navigateToDashboard('dashboard', 'tool_action');
       } else if (data.tool === 'manage_alarm') {
          window.dispatchEvent(new CustomEvent('orion_alarm_action', { detail: data }));
          navigateToDashboard('dashboard', 'tool_action');
       } else if (data.tool === 'manage_timer') {
          window.dispatchEvent(new CustomEvent('orion_timer_action', { detail: data }));
          navigateToDashboard('dashboard', 'tool_action');
       } else if (data.tool === 'manage_stopwatch') {
          window.dispatchEvent(new CustomEvent('orion_stopwatch_action', { detail: data }));
          navigateToDashboard('dashboard', 'tool_action');
       }
    });

    socket.on('audio_data', (data: { data: ArrayBuffer | number[] }) => {
       if (!playbackContextRef.current) {
          playbackContextRef.current = new AudioContext({ sampleRate: 24000, latencyHint: 'interactive' });
          nextStartTimeRef.current = playbackContextRef.current.currentTime;
       }
       const ctx = playbackContextRef.current;
       
       if (ctx.state === 'suspended') {
          ctx.resume();
       }

       let pcm16: Int16Array;
       if (data.data instanceof ArrayBuffer) {
           pcm16 = new Int16Array(data.data);
       } else {
           // Fallback if data is array of numbers
           const bytes = new Uint8Array(data.data as number[]);
           pcm16 = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
       }

       const buffer = ctx.createBuffer(1, pcm16.length, 24000);
       const channelData = buffer.getChannelData(0);
       for(let i = 0; i < pcm16.length; i++) {
           channelData[i] = pcm16[i] / 32768.0;
       }
       
       const source = ctx.createBufferSource();
       source.buffer = buffer;
       source.connect(ctx.destination);
       
       activeSourcesRef.current.push(source);
       source.onended = () => {
          activeSourcesRef.current = activeSourcesRef.current.filter(s => s !== source);
       };

       const startTime = Math.max(ctx.currentTime, nextStartTimeRef.current);
       source.start(startTime);
       nextStartTimeRef.current = startTime + buffer.duration;
    });

    orionSocketRef.current = socket;

    return () => {
       if (syncTimerRef.current !== null) {
          window.clearTimeout(syncTimerRef.current);
          syncTimerRef.current = null;
       }
       if (voiceNavigationTimerRef.current !== null) {
          window.clearTimeout(voiceNavigationTimerRef.current);
          voiceNavigationTimerRef.current = null;
       }
       window.removeEventListener('orion_browser_command_result', browserCommandResultHandler as EventListener);
       socket.off('browser_command');
       socket.off('browser_command_cancel');
       socket.disconnect();
    };
  }, []);

  const toggleOrionListening = async () => {
     console.log("toggleOrionListening triggered. Connected:", isOrionConnected, "Listening:", isOrionListening);
     if (!orionSocketRef.current) {
        alert("Orion Backend socket is not initialized.");
        return;
     }
     if (!isOrionConnected) {
        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SpeechRecognition) {
           console.warn("Speech recognition not supported in this browser and Python backend is offline.");
           alert("Please ensure the Orion backend is running on port 8001 or use Chrome/Edge for voice assistance.");
           return;
        }

        if (isOrionListening) {
           if (browserRecognitionRef.current) {
              try { browserRecognitionRef.current.stop(); } catch(e) {}
              browserRecognitionRef.current = null;
           }
           setIsOrionListening(false);
           return;
        }

        try {
           const recognition = new SpeechRecognition();
           recognition.continuous = false;
           recognition.interimResults = false;
           recognition.lang = 'en-US';

           recognition.onstart = () => {
              setIsOrionListening(true);
           };

           recognition.onend = () => {
              setIsOrionListening(false);
              browserRecognitionRef.current = null;
           };

           recognition.onerror = (e: any) => {
              console.error("Browser speech recognition error:", e);
              setIsOrionListening(false);
              browserRecognitionRef.current = null;
           };

           recognition.onresult = async (e: any) => {
              setIsOrionListening(false);
              const transcript = e.results?.[0]?.[0]?.transcript || '';
              if (!transcript.trim()) return;

              console.log("[ORION VOICE ASSISTANT]: Spoken transcript:", transcript);

              // 1. Check navigation intent
              const navIntent = detectDashboardNavigationIntent(transcript);
              if (navIntent) {
                 navigateToDashboard(navIntent.view, 'browser_mic');
                 return;
              }

              // 2. Call /api/skin/assistant
              try {
                 const res = await fetch('/api/skin/assistant', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ query: transcript, latestScan: gallery[0] || null })
                 });
                 if (res.ok) {
                    const data = await res.json();
                    if (data.action) {
                       if (data.action.type === 'navigate') {
                          navigateToDashboard(data.action.view, 'voice_command');
                       } else if (data.action.type === 'refresh_qr') {
                          window.dispatchEvent(new CustomEvent('orion_refresh_skin_report_qr'));
                       } else if (data.action.type === 'spotify') {
                          window.dispatchEvent(new CustomEvent('spotify_voice_action', { detail: data.action }));
                       }
                    }
                    if (data.answer && 'speechSynthesis' in window) {
                       window.speechSynthesis.cancel();
                       const utter = new SpeechSynthesisUtterance(data.answer);
                       utter.rate = 1.05;
                       window.speechSynthesis.speak(utter);
                    }
                 }
              } catch (err) {
                 console.error("Voice assistant query failed:", err);
              }
           };

           browserRecognitionRef.current = recognition;
           recognition.start();
        } catch (err) {
           console.error("Failed to start browser speech recognition:", err);
           setIsOrionListening(false);
        }
        return;
     }

     if (orionSocketRef.current && isOrionConnected) {
        const nextState = !isOrionListening;
        
        if (nextState) {
           stopFrontendPlayback();
           try {
              if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                  throw new Error("navigator.mediaDevices.getUserMedia is not supported. This usually happens if you are not using HTTPS or localhost.");
              }
              const stream = await navigator.mediaDevices.getUserMedia({
                 audio: {
                    echoCancellation: { ideal: true },
                    noiseSuppression: { ideal: true },
                    autoGainControl: { ideal: true },
                    channelCount: { ideal: 1 },
                    sampleRate: { ideal: 16000 },
                    sampleSize: { ideal: 16 },
                    latency: { ideal: 0.02 },
                 } as MediaTrackConstraints
              });
              mediaStreamRef.current = stream;
              const audioCtx = new AudioContext({ sampleRate: 16000, latencyHint: 'interactive' });
              audioContextRef.current = audioCtx;
              const source = audioCtx.createMediaStreamSource(stream);
              const silentGain = audioCtx.createGain();
              silentGain.gain.value = 0;
              silentGain.connect(audioCtx.destination);

              let workletReady = false;
              if (audioCtx.audioWorklet) {
                 try {
                    const workletCode = `
                       class OrionPcmProcessor extends AudioWorkletProcessor {
                          constructor() {
                             super();
                             this.frameSize = 320;
                             this.buffer = new Float32Array(this.frameSize);
                             this.offset = 0;
                          }

                          flush() {
                             const pcm16 = new Int16Array(this.frameSize);
                             for (let i = 0; i < this.frameSize; i++) {
                                const sample = Math.max(-1, Math.min(1, this.buffer[i]));
                                pcm16[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
                             }
                             this.port.postMessage(pcm16.buffer, [pcm16.buffer]);
                             this.offset = 0;
                          }

                          process(inputs, outputs) {
                             const input = inputs[0] && inputs[0][0];
                             const output = outputs[0] && outputs[0][0];
                             if (input && input.length) {
                                if (output) output.set(input);
                                for (let i = 0; i < input.length; i++) {
                                   this.buffer[this.offset++] = input[i];
                                   if (this.offset >= this.frameSize) this.flush();
                                }
                             }
                             return true;
                          }
                       }
                       registerProcessor('orion-pcm-processor', OrionPcmProcessor);
                    `;
                    const workletUrl = URL.createObjectURL(new Blob([workletCode], { type: 'application/javascript' }));
                    await audioCtx.audioWorklet.addModule(workletUrl);
                    URL.revokeObjectURL(workletUrl);

                    const workletNode = new AudioWorkletNode(audioCtx, 'orion-pcm-processor', {
                       numberOfInputs: 1,
                       numberOfOutputs: 1,
                       outputChannelCount: [1],
                    });
                    workletNode.port.onmessage = (event) => {
                       if (orionSocketRef.current?.connected) {
                          orionSocketRef.current.emit('audio_chunk', event.data);
                       }
                    };
                    audioWorkletNodeRef.current = workletNode;
                    source.connect(workletNode);
                    workletNode.connect(silentGain);
                    workletReady = true;
                 } catch (workletError) {
                    console.warn('AudioWorklet setup failed; falling back to ScriptProcessor.', workletError);
                 }
              }

              if (!workletReady) {
                 const processor = audioCtx.createScriptProcessor(512, 1, 1);
                 processorRef.current = processor;
                 processor.onaudioprocess = (e) => {
                    const inputData = e.inputBuffer.getChannelData(0);
                    const pcm16 = new Int16Array(inputData.length);
                    for (let i = 0; i < inputData.length; i++) {
                       const sample = Math.max(-1, Math.min(1, inputData[i]));
                       pcm16[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
                    }
                    if (orionSocketRef.current?.connected) {
                       orionSocketRef.current.emit('audio_chunk', pcm16.buffer);
                    }
                 };
                 source.connect(processor);
                 processor.connect(silentGain);
              }
              
              orionSocketRef.current.emit('start_audio');
           } catch (err: any) {
              console.error("Microphone access denied or error:", err);
              alert("Microphone Error: " + (err.message || String(err)));
              return; // Don't set state to listening if mic fails
           }
        } else {
           orionSocketRef.current.emit('stop_audio');
           stopMicrophoneCapture();
        }
        setIsOrionListening(nextState);
     }
  };

  const sendBrowserPrompt = (prompt: string) => {
     if (orionSocketRef.current && isOrionConnected) {
        orionSocketRef.current.emit('prompt_web_agent', { prompt });
     }
  };

  useEffect(() => {
    eventsRef.current = events;
    tasksRef.current = tasks;
    emitDashboardSync(events, tasks);
  }, [events, tasks]);

  useEffect(() => {
    const handler = (event: globalThis.Event) => {
      const customEvent = event as CustomEvent;
      orionSocketRef.current?.emit('skin_analysis_stage', customEvent.detail || {});
    };
    window.addEventListener('orion_skin_analysis_stage', handler as EventListener);
    return () => window.removeEventListener('orion_skin_analysis_stage', handler as EventListener);
  }, []);

  useEffect(() => {
    let unsubscribeEntitiesCallback: (() => void) | null = null;
    let unsubscribeLovelaceCallback: (() => void) | null = null;

    const extractEntitiesFromCard = (card: any, roomName: string, roomMap: Map<string, string>, nameMap: Map<string, string>, orderedList: string[]) => {
      if (!card) return;

      // Single entity card
      if (card.entity) {
        roomMap.set(card.entity, roomName);
        if (card.name) nameMap.set(card.entity, card.name);
        if (!orderedList.includes(card.entity)) orderedList.push(card.entity);
      }

      // Entities list card
      if (Array.isArray(card.entities)) {
        card.entities.forEach((ent: any) => {
          if (typeof ent === 'string') {
            roomMap.set(ent, roomName);
            if (!orderedList.includes(ent)) orderedList.push(ent);
          } else if (ent && typeof ent === 'object' && ent.entity) {
            roomMap.set(ent.entity, roomName);
            if (ent.name) nameMap.set(ent.entity, ent.name);
            if (!orderedList.includes(ent.entity)) orderedList.push(ent.entity);
          }
        });
      }

      // Nested grid/stack cards
      if (Array.isArray(card.cards)) {
        card.cards.forEach((childCard: any) => {
          extractEntitiesFromCard(childCard, roomName, roomMap, nameMap, orderedList);
        });
      }
    };

    const initHA = async () => {
      const haUrl = (import.meta as any).env.VITE_HA_URL;
      const haToken = (import.meta as any).env.VITE_HA_TOKEN;
      if (!haUrl || !haToken || haUrl.includes('YOUR_HA_IP')) {
        console.log("HA credentials not fully configured.");
        return;
      }

      try {
        const auth = createLongLivedTokenAuth(haUrl, haToken);
        const connection = await createConnection({ auth });
        haConnectionRef.current = connection;

        const syncHA = async () => {
          console.log("[HA SYNC] Loading Lovelace configuration...");
          let lovelaceConfig: any = null;
          try {
            lovelaceConfig = await connection.sendMessagePromise({ type: 'lovelace/config' });
          } catch (e) {
            console.warn("[HA SYNC] Lovelace config not available. Falling back to all entities.", e);
          }

          const roomMap = new Map<string, string>();
          const nameMap = new Map<string, string>();
          const orderedList: string[] = [];

          if (lovelaceConfig && Array.isArray(lovelaceConfig.views)) {
            lovelaceConfig.views.forEach((view: any, viewIdx: number) => {
              const roomName = view.title || view.name || `Room ${viewIdx + 1}`;
              if (Array.isArray(view.cards)) {
                view.cards.forEach((card: any) => {
                  extractEntitiesFromCard(card, roomName, roomMap, nameMap, orderedList);
                });
              }
            });
          }

          if (unsubscribeEntitiesCallback) {
            unsubscribeEntitiesCallback();
          }

          unsubscribeEntitiesCallback = subscribeEntities(connection, (entities: any) => {
            const mappedDevices: SmartDevice[] = [];
            
            const processEntity = (entity: any) => {
              const entityId = entity.entity_id;
              const domain = entityId.split('.')[0];
              
              if (!['light', 'fan', 'climate', 'switch', 'media_player', 'lock', 'cover', 'vacuum', 'sensor', 'binary_sensor'].includes(domain)) {
                return;
              }
              
              const room = roomMap.get(entityId) || 'Home';
              const customName = nameMap.get(entityId) || entity.attributes.friendly_name || entityId;
              
              let type: SmartDevice['type'] = 'switch';
              if (domain === 'light') type = 'light';
              else if (domain === 'fan') type = 'fan';
              else if (domain === 'climate') type = 'ac';
              else if (domain === 'media_player') type = 'tv';
              else if (domain === 'lock') type = 'lock';
              else if (domain === 'cover') type = 'cover';
              else if (domain === 'vacuum') type = 'vacuum';
              else if (domain === 'sensor' || domain === 'binary_sensor') type = 'sensor';

              let isOn = false;
              if (domain === 'lock') {
                isOn = entity.state === 'unlocked';
              } else if (domain === 'cover') {
                isOn = entity.state !== 'closed';
              } else if (domain === 'sensor' || domain === 'binary_sensor') {
                isOn = entity.state === 'on';
              } else {
                isOn = entity.state !== 'off' && entity.state !== 'unavailable' && entity.state !== 'unknown' && entity.state !== 'standby';
              }
              
              let value = 0;
              if (domain === 'light' && entity.attributes.brightness !== undefined) {
                value = Math.round((entity.attributes.brightness / 255) * 100);
              } else if (domain === 'fan' && entity.attributes.percentage !== undefined) {
                value = entity.attributes.percentage;
              } else if (domain === 'climate' && entity.attributes.temperature !== undefined) {
                value = entity.attributes.temperature;
              } else if (domain === 'cover' && entity.attributes.current_position !== undefined) {
                value = entity.attributes.current_position;
              }

              const capabilities: SmartDeviceCapability[] = [{ type: 'power' }];
              if (domain === 'light') {
                if (entity.attributes.supported_color_modes?.some((m: string) => ['hs', 'rgb', 'xy', 'rgbw', 'rgbww'].includes(m))) {
                  capabilities.push({ type: 'color' });
                }
                if (entity.attributes.supported_color_modes?.includes('color_temp')) {
                  capabilities.push({ type: 'color_temperature' });
                }
                capabilities.push({ type: 'brightness', min: 0, max: 100 });
              } else if (domain === 'fan') {
                capabilities.push({ type: 'fan_speed', min: 0, max: 100 });
              } else if (domain === 'climate') {
                capabilities.push({ type: 'temperature', min: entity.attributes.min_temp || 60, max: entity.attributes.max_temp || 85 });
                capabilities.push({ type: 'hvac_mode', options: entity.attributes.hvac_modes || ['off', 'heat', 'cool', 'auto'] });
              } else if (domain === 'media_player') {
                capabilities.push({ type: 'media' });
              } else if (domain === 'lock') {
                capabilities.push({ type: 'lock' });
              } else if (domain === 'cover') {
                capabilities.push({ type: 'cover_position', min: 0, max: 100 });
              }

              mappedDevices.push({
                id: entityId,
                name: customName,
                type,
                room,
                isOn,
                value,
                attributes: entity.attributes,
                state: entity.state,
                capabilities
              });
            };

            if (orderedList.length > 0) {
              orderedList.forEach(entityId => {
                const entity = entities[entityId];
                if (entity) {
                  processEntity(entity);
                }
              });
            } else {
              Object.values(entities).forEach((entity: any) => {
                processEntity(entity);
              });
            }

            setDevices(mappedDevices);
          });
        };

        await syncHA();

        connection.subscribeEvents((event) => {
          console.log("[HA SYNC] Lovelace config updated. Re-syncing...");
          syncHA();
        }, 'lovelace_updated').then(unsub => {
          unsubscribeLovelaceCallback = unsub;
        });

      } catch (e) {
        console.error("Home Assistant connection failed:", e);
      }
    };

    initHA();

    return () => {
      if (unsubscribeEntitiesCallback) (unsubscribeEntitiesCallback as () => void)();
      if (unsubscribeLovelaceCallback) (unsubscribeLovelaceCallback as () => void)();
    };
  }, []);

  const loadGoogleTasks = async (token: string) => {
    try {
      const res = await fetch(`https://www.googleapis.com/tasks/v1/lists/@default/tasks`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.items) {
        const remoteTasks: Task[] = data.items.map((item: any) => ({
          id: item.id,
          label: item.title || '',
          done: item.status === 'completed'
        }));
        setTasks(remoteTasks);
      } else {
        setTasks([]);
      }
    } catch(e) {
      console.error(e);
    }
  };

  const loadGoogleCalendarEvents = async (
    token: string,
    options: { userKey?: string; forceFull?: boolean } = {}
  ) => {
    const userKey = options.userKey || getGoogleUserKey();
    if (!userKey || userKey === 'default_user') return;

    try {
      setCalendarSyncStatus('syncing');
      const cachedEvents = await loadCachedGoogleCalendarEvents(userKey);
      if (cachedEvents.length > 0) {
        setEvents(cachedEvents);
      }

      const syncedEvents = await syncGoogleCalendars({
        token,
        userKey,
        forceFull: options.forceFull,
      });
      setEvents(syncedEvents);
      setCalendarSyncStatus('synced');
    } catch(e) {
      console.error('Google Calendar incremental sync failed:', e);
      setCalendarSyncStatus('error');
    }
  };
  const getUserStorageKey = (prefix: string) => {
    const userId = user?.id || user?.email || 'default_user';
    return `${prefix}_${userId}`;
  };

  useEffect(() => {
    const galleryKey = getUserStorageKey('orion_gallery');
    const routineKey = getUserStorageKey('orion_routine');

    localforage.getItem<SkinAnalysisRecord[]>(galleryKey).then((data) => {
      setGallery(data || []);
    });

    localforage.getItem<SkincareRoutine>(routineKey).then((data) => {
      setSkincareRoutine(data || generateDynamicRoutine({}));
    });
  }, [user]);

  useEffect(() => {
    localforage.removeItem('orion_profile_image');

    localforage.getItem<{accessToken: string, refreshToken: string}>('orion_google_tokens').then(async (tokens) => {
      try {
        if (tokens && tokens.refreshToken) {
          setGoogleTokens(tokens.accessToken, tokens.refreshToken);
          const validToken = await getValidAccessToken();
          if (validToken) {
             const profile = await fetchGoogleUserProfile(validToken);
             if (profile) {
               const userKey = getGoogleUserKey(profile);
               setUser(profile);
               setCustomProfileImage(profile.photoURL || null);

               const cachedEvents = await loadCachedGoogleCalendarEvents(userKey);
               if (cachedEvents.length > 0) setEvents(cachedEvents);

               loadGoogleCalendarEvents(validToken, { userKey });
               loadGoogleTasks(validToken);
             } else {
               await localforage.removeItem('orion_google_tokens');
             }
          } else {
             await localforage.removeItem('orion_google_tokens');
          }
        }
      } finally {
        setAuthLoading(false);
      }
    });
  }, []);

  useEffect(() => {
    if (!user) return;

    const userKey = getGoogleUserKey(user);
    if (userKey === 'default_user') return;

    let interval: number | undefined;
    let refreshTimer: number | undefined;
    let refreshInFlight = false;

    const refreshGoogleWorkspace = async () => {
      if (refreshInFlight) return;
      refreshInFlight = true;
      try {
        const token = await getValidAccessToken();
        if (token) {
          await Promise.all([
            loadGoogleCalendarEvents(token, { userKey }),
            loadGoogleTasks(token),
          ]);
        }
      } catch (e) {
        console.error('Google workspace refresh error:', e);
      } finally {
        refreshInFlight = false;
      }
    };

    const scheduleRefresh = (delayMs = 200) => {
      if (refreshTimer) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(refreshGoogleWorkspace, delayMs);
    };

    const refreshOnVisible = () => {
      if (document.visibilityState === 'visible') scheduleRefresh(0);
    };

    window.addEventListener('focus', refreshOnVisible);
    window.addEventListener('online', refreshOnVisible);
    document.addEventListener('visibilitychange', refreshOnVisible);
    scheduleRefresh(0);
    interval = window.setInterval(refreshGoogleWorkspace, 15000);

    return () => {
      if (refreshTimer) window.clearTimeout(refreshTimer);
      if (interval) window.clearInterval(interval);
      window.removeEventListener('focus', refreshOnVisible);
      window.removeEventListener('online', refreshOnVisible);
      document.removeEventListener('visibilitychange', refreshOnVisible);
    };
  }, [user]);

  useEffect(() => {
    const root = document.documentElement;
    const themeParams = themes[theme];
    const accentParams = accents[accentColor] || accents.blue;
    
    Object.entries(themeParams).forEach(([key, value]) => {
      root.style.setProperty(key, value as string);
    });
    Object.entries(accentParams).forEach(([key, value]) => {
      root.style.setProperty(key, value as string);
    });
  }, [theme, accentColor]);

  const addGalleryImage = (record: SkinAnalysisRecord) => {
    const key = getUserStorageKey('orion_gallery');
    setGallery(prev => {
      const next = [record, ...prev];
      localforage.setItem(key, next);
      return next;
    });
  };

  const deleteGalleryImages = (ids: string[]) => {
    const key = getUserStorageKey('orion_gallery');
    setGallery(prev => {
      const next = prev.filter(r => !ids.includes(r.id));
      localforage.setItem(key, next);
      return next;
    });
  };

  const clearGallery = () => {
    const key = getUserStorageKey('orion_gallery');
    setGallery([]);
    localforage.removeItem(key);
  };

  const updateSkincareRoutine = (newRoutine: SkincareRoutine) => {
    const key = getUserStorageKey('orion_routine');
    setSkincareRoutine(newRoutine);
    localforage.setItem(key, newRoutine);
  };

  const processVoiceCommand = async (cmd: string): Promise<{ text: string; needsBrowser?: boolean; browserPrompt?: string }> => {
    const lowerCmd = cmd.toLowerCase();
    
    // Global Skin Health & Dermatological Voice Intent
    if (lowerCmd.includes('skin') || lowerCmd.includes('acne') || lowerCmd.includes('hydration') || lowerCmd.includes('skincare') || lowerCmd.includes('routine')) {
      if (lowerCmd.includes('analyze') || lowerCmd.includes('scan') || lowerCmd.includes('check')) {
        navigateToDashboard('skin_analysis', 'voice');
        window.dispatchEvent(new CustomEvent('orion_trigger_skin_analysis'));
        return { text: "Starting your facial skin analysis. Please position your face within the frame." };
      }

      try {
        const latestScan = gallery.length > 0 ? gallery[0] : null;
        const res = await fetch('/api/skin/assistant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question: cmd, latestScan, history: gallery.slice(0, 5) })
        });
        if (res.ok) {
          const data = await res.json();
          return { text: data.answer || `Your skin score is currently ${latestScan?.score ?? 85}%. Maintain your daily routine.` };
        }
      } catch (e) {
        console.warn("Voice skin assistant error:", e);
      }
    }
    
    // Programmatic actions
    let actionConfirmed = false;
    
    if (lowerCmd.includes('add task') || lowerCmd.includes('to-do')) {
      const match = lowerCmd.match(/(?:add task|to-do list for today)(?: to)? (.+)/);
      const label = match ? match[1] : 'New Task via Voice';
      await addRemoteTask(label);
      actionConfirmed = true;
    }

    if (lowerCmd.includes('meeting') || lowerCmd.includes('event')) {
      const today = new Date();
      await addCalendarEvent(today.getDate(), today.getMonth(), today.getFullYear(), 'Meeting (Voice added)', 'meeting');
      actionConfirmed = true;
    }

    if (lowerCmd.startsWith('play ')) {
      const query = lowerCmd.substring(5);
      window.dispatchEvent(new CustomEvent('spotify_voice_action', { detail: { action: 'play', query, mediaType: 'auto' } }));
      return { text: `Playing ${query} on Spotify...` };
    }

    if (lowerCmd.includes('pause music') || lowerCmd === 'pause') {
      window.dispatchEvent(new CustomEvent('spotify_voice_action', { detail: { action: 'pause' } }));
      return { text: 'Paused.' };
    }

    if (lowerCmd.includes('resume music') || lowerCmd === 'resume') {
      window.dispatchEvent(new CustomEvent('spotify_voice_action', { detail: { action: 'resume' } }));
      return { text: 'Resuming.' };
    }

    if (lowerCmd.includes('next song') || lowerCmd === 'next') {
      window.dispatchEvent(new CustomEvent('spotify_voice_action', { detail: { action: 'next' } }));
      return { text: 'Next track.' };
    }

    if (lowerCmd.includes('previous song') || lowerCmd.includes('previous track')) {
      window.dispatchEvent(new CustomEvent('spotify_voice_action', { detail: { action: 'previous' } }));
      return { text: 'Previous track.' };
    }

    // Device control examples (lights, AC)
    if (lowerCmd.includes('turn on') && lowerCmd.includes('light')) {
      if (haConnectionRef.current) {
        devices.forEach(d => { if (d.type === 'light') callHAService('light', 'turn_on', { entity_id: d.id }); });
      } else {
        setDevices(prev => prev.map(d => d.type === 'light' ? { ...d, isOn: true } : d));
      }
      actionConfirmed = true;
    }
    if (lowerCmd.includes('turn off') && lowerCmd.includes('light')) {
      if (haConnectionRef.current) {
        devices.forEach(d => { if (d.type === 'light') callHAService('light', 'turn_off', { entity_id: d.id }); });
      } else {
        setDevices(prev => prev.map(d => d.type === 'light' ? { ...d, isOn: false } : d));
      }
      actionConfirmed = true;
    }
    if (lowerCmd.includes('turn on') && lowerCmd.includes('ac')) {
      if (haConnectionRef.current) {
        devices.forEach(d => { if (d.type === 'ac') callHAService('climate', 'turn_on', { entity_id: d.id }); });
      } else {
        setDevices(prev => prev.map(d => d.type === 'ac' ? { ...d, isOn: true } : d));
      }
      actionConfirmed = true;
    }
    if (lowerCmd.includes('turn off') && lowerCmd.includes('ac')) {
      if (haConnectionRef.current) {
        devices.forEach(d => { if (d.type === 'ac') callHAService('climate', 'turn_off', { entity_id: d.id }); });
      } else {
        setDevices(prev => prev.map(d => d.type === 'ac' ? { ...d, isOn: false } : d));
      }
      actionConfirmed = true;
    }

    // Send request to Gemini backend
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: cmd,
          systemContext: `You are Orion, the AI assistant for the Orion Smart Mirror. Keep responses very short and conversational. ${actionConfirmed ? "Note: The user's programmatic request has already been executed on the frontend, so you should acknowledge it only." : "Interpret the user's intent and respond normally."}`
        })
      });
      const data = await response.json();
      // Assume backend may include fields needsBrowser and browserPrompt
      const result = {
        text: data.text || (actionConfirmed ? "I've processed your command." : "I'm having trouble reaching my AI core."),
        needsBrowser: data.needsBrowser,
        browserPrompt: data.browserPrompt
      };
      return result;
    } catch (e) {
      console.error(e);
    }

    // Fallback handling
    if (actionConfirmed) return { text: "I've processed your command." };
    if (lowerCmd.includes('news')) return { text: "I could not reach live news right now. Please try again in a moment." };
    return { text: "I'm having trouble reaching my AI core. Try again later." };
  };

  const handleSetCustomProfileImage = (img: string | null) => {
    setCustomProfileImage(img);
  };

  const login = async () => {
    try {
      setUser(null);
      setCustomProfileImage(null);
      setEvents([]);
      setTasks([]);
      await localforage.removeItem('orion_profile_image');

      const result = await signInWithGoogleLocal();
      if (result) {
        setGoogleTokens(result.accessToken, result.refreshToken, result.expiresIn || 3500);
        await localforage.setItem('orion_google_tokens', { accessToken: result.accessToken, refreshToken: result.refreshToken });
        const profile = await fetchGoogleUserProfile(result.accessToken);
        if (!profile) throw new Error('Google profile could not be loaded after sign-in.');

        const userKey = getGoogleUserKey(profile);
        setUser(profile);
        setCustomProfileImage(profile.photoURL || null);

        await Promise.all([
          loadGoogleCalendarEvents(result.accessToken, { userKey, forceFull: true }),
          loadGoogleTasks(result.accessToken),
        ]);
      }
    } catch (e) {
      console.error("Login Error:", e);
    }
  };

  const logoutUser = async () => {
    try {
      const userKey = getGoogleUserKey(user);
      clearGoogleTokens();
      await localforage.removeItem('orion_google_tokens');
      await localforage.removeItem('orion_profile_image');
      await localforage.removeItem('orion_user');
      if (userKey !== 'default_user') {
        await clearGoogleCalendarSyncState(userKey);
      }
      setUser(null);
      setCustomProfileImage(null);
      setEvents([]);
      setTasks([]);
      setGallery([]);
      setCalendarSyncStatus('idle');
    } catch (e) {
      console.error("Logout Error:", e);
    }
  };
  const addCalendarEvent = async (day: number, month: number, year: number, title: string, type: string) => {
    const optimisticId = `local-${Date.now()}`;
    const optimisticEvent: Event = { id: optimisticId, day, month, year, title, type };
    setEvents(prev => [...prev, optimisticEvent]);

    const token = await getValidAccessToken();
    if (token) {
      const pad = (n: number) => n.toString().padStart(2, '0');
      const dateStr = `${year}-${pad(month + 1)}-${pad(day)}`;
      const d = new Date(year, month, day);
      d.setDate(d.getDate() + 1);
      const endStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

      const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          summary: `[${type}] ${title}`,
          colorId: getEventTypeColor(type),
          start: { date: dateStr },
          end: { date: endStr }
        })
      });
      if (res.ok) {
         await loadGoogleCalendarEvents(token, { userKey: getGoogleUserKey() });
      } else {
         setEvents(prev => prev.filter(event => event.id !== optimisticId));
         console.warn('Google Calendar add failed; removed local optimistic event.');
      }
    }
  };

  const deleteCalendarEvent = async (id: string) => {
    const current = eventsRef.current.find(event => event.id === id);
    if (current?.readOnly) {
      console.warn('Cannot delete read-only Google Calendar event:', current);
      return;
    }

    setEvents(prev => prev.filter(e => e.id !== id));
    const token = await getValidAccessToken();
    if (token && !id.startsWith('local-')) {
      const { calendarId, eventId } = parseSyncedEventId(id);
      const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok || res.status === 410) {
        await loadGoogleCalendarEvents(token, { userKey: getGoogleUserKey() });
      } else {
        await loadGoogleCalendarEvents(token, { userKey: getGoogleUserKey(), forceFull: true });
      }
    }
  };

  const editCalendarEvent = async (id: string, updates: Partial<Omit<Event, 'id'>>) => {
    const current = eventsRef.current.find(event => event.id === id);
    if (!current) return;
    if (current.readOnly) {
      console.warn('Cannot edit read-only Google Calendar event:', current);
      return;
    }

    const nextEvent: Event = {
      ...current,
      ...Object.fromEntries(Object.entries(updates).filter(([, value]) => value !== undefined))
    } as Event;
    nextEvent.day = Number(nextEvent.day);
    nextEvent.month = Number(nextEvent.month);
    nextEvent.year = Number(nextEvent.year);

    setEvents(prev => prev.map(event => event.id === id ? nextEvent : event));

    const token = await getValidAccessToken();
    if (token && !id.startsWith('local-')) {
      const pad = (n: number) => n.toString().padStart(2, '0');
      const dateStr = `${nextEvent.year}-${pad(nextEvent.month + 1)}-${pad(nextEvent.day)}`;
      const d = new Date(nextEvent.year, nextEvent.month, nextEvent.day);
      d.setDate(d.getDate() + 1);
      const endStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      const dateChanged = updates.day !== undefined || updates.month !== undefined || updates.year !== undefined;

      const patchBody: Record<string, any> = {
        summary: `[${nextEvent.type || 'meeting'}] ${nextEvent.title}`,
        colorId: getEventTypeColor(nextEvent.type || 'meeting'),
      };

      if (dateChanged) {
        if (current.allDay === false && current.start) {
          const previousStart = new Date(current.start);
          const previousEnd = current.end ? new Date(current.end) : new Date(previousStart.getTime() + 60 * 60 * 1000);
          const durationMs = Math.max(15 * 60 * 1000, previousEnd.getTime() - previousStart.getTime());
          const nextStart = new Date(nextEvent.year, nextEvent.month, nextEvent.day, previousStart.getHours(), previousStart.getMinutes(), previousStart.getSeconds());
          const nextEnd = new Date(nextStart.getTime() + durationMs);
          patchBody.start = { dateTime: nextStart.toISOString() };
          patchBody.end = { dateTime: nextEnd.toISOString() };
        } else {
          patchBody.start = { date: dateStr };
          patchBody.end = { date: endStr };
        }
      }

      const { calendarId, eventId } = parseSyncedEventId(id);
      const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(patchBody)
      });
      if (res.ok) {
        await loadGoogleCalendarEvents(token, { userKey: getGoogleUserKey() });
      } else {
        await loadGoogleCalendarEvents(token, { userKey: getGoogleUserKey(), forceFull: true });
      }
    }
  };
  const addRemoteTask = async (title: string) => {
    const optimisticId = `local-${Date.now()}`;
    setTasks(prev => [...prev, { id: optimisticId, label: title, done: false }]);

    const token = await getValidAccessToken();
    if (token) {
      const res = await fetch(`https://www.googleapis.com/tasks/v1/lists/@default/tasks`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ title })
      });
      if (res.ok) {
        await loadGoogleTasks(token);
      } else {
        console.warn('Google Tasks add failed; keeping local optimistic task.');
      }
    }
  };

  const toggleRemoteTask = async (id: string | number, done: boolean) => {
    setTasks(prev => prev.map(t => idsEqual(t.id, id) ? { ...t, done } : t));
    const token = await getValidAccessToken();
    if (token && typeof id === 'string' && !id.startsWith('local-')) {
      const res = await fetch(`https://www.googleapis.com/tasks/v1/lists/@default/tasks/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ status: done ? 'completed' : 'needsAction' })
      });
      if (res.ok) {
        await loadGoogleTasks(token);
      }
    }
  };

  const deleteRemoteTask = async (id: string | number) => {
    setTasks(prev => prev.filter(t => !idsEqual(t.id, id)));
    const token = await getValidAccessToken();
    if (token && typeof id === 'string' && !id.startsWith('local-')) {
      const res = await fetch(`https://www.googleapis.com/tasks/v1/lists/@default/tasks/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        await loadGoogleTasks(token);
      }
    }
  };

  const editRemoteTask = async (id: string | number, title: string) => {
    setTasks(prev => prev.map(t => idsEqual(t.id, id) ? { ...t, label: title } : t));
    const token = await getValidAccessToken();
    if (token && typeof id === 'string' && !id.startsWith('local-')) {
      const res = await fetch(`https://www.googleapis.com/tasks/v1/lists/@default/tasks/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ title })
      });
      if (res.ok) {
        await loadGoogleTasks(token);
      }
    }
  };

  return (
    <AppContext.Provider value={{
      theme, setTheme, accentColor, setAccentColor,
      timeWidget, setTimeWidget,
      tasks, setTasks, events, setEvents, devices, setDevices,
      gallery, addGalleryImage, deleteGalleryImages, clearGallery,
      skincareRoutine, updateSkincareRoutine,
      processVoiceCommand,
      user, authLoading, calendarSyncStatus,
      customProfileImage, setCustomProfileImage: handleSetCustomProfileImage,
      login, logoutUser,
      addCalendarEvent, deleteCalendarEvent, editCalendarEvent,
      addRemoteTask, toggleRemoteTask, deleteRemoteTask, editRemoteTask,
      callHAService,
      isOrionConnected, isOrionListening, toggleOrionListening,
      orionBrowserImage, orionBrowserLogs, browserActivity, sendBrowserPrompt,
      sendManualBrowserAction: (actionData: any) => {
        if (orionSocketRef.current && isOrionConnected) {
          orionSocketRef.current.emit('manual_browser_action', actionData);
        }
      },
      isBrowserVisible, setBrowserVisible: setIsBrowserVisible,
    }}>
      {children}
    </AppContext.Provider>
  );
};

export const useAppContext = () => {
  const context = useContext(AppContext);
  if (!context) throw new Error("useAppContext must be used within AppProvider");
  return context;
};


