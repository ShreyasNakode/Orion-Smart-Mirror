import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, SkipBack, SkipForward, Music, Disc, Loader2, ListMusic, ExternalLink } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface Track {
  id: string;
  name: string;
  artist: string;
  albumArt: string;
  uri: string;
  durationMs: number;
}

export function SpotifyPlayer() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [showPlaylist, setShowPlaylist] = useState(false);
  const [progressMs, setProgressMs] = useState(0); 
  const [isDragging, setIsDragging] = useState(false);
  const [spotifyToken, setSpotifyToken] = useState<string | null>(null);
  const [isLoadingTracks, setIsLoadingTracks] = useState(false);
  const sliderRef = useRef<HTMLDivElement>(null);

  const [deviceId, setDeviceId] = useState<string | null>(null);
  const playerRef = useRef<any>(null);
  const spotifyTokenRef = useRef<string | null>(null);
  const deviceIdRef = useRef<string | null>(null);
  const tracksRef = useRef<Track[]>([]);

  useEffect(() => { spotifyTokenRef.current = spotifyToken; }, [spotifyToken]);
  useEffect(() => { deviceIdRef.current = deviceId; }, [deviceId]);
  useEffect(() => { tracksRef.current = tracks; }, [tracks]);

  const refreshSpotifyToken = async () => {
    const refreshToken = localStorage.getItem('spotify_refresh_token');
    if (!refreshToken) {
      setSpotifyToken(null);
      spotifyTokenRef.current = null;
      localStorage.removeItem('spotify_token');
      return null;
    }

    try {
      const response = await fetch('/api/spotify/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken })
      });
      if (!response.ok) throw new Error('Spotify refresh failed');
      const data = await response.json();
      setSpotifyToken(data.accessToken);
      spotifyTokenRef.current = data.accessToken;
      localStorage.setItem('spotify_token', data.accessToken);
      localStorage.setItem('spotify_refresh_token', data.refreshToken || refreshToken);
      return data.accessToken as string;
    } catch (error) {
      console.error(error);
      setSpotifyToken(null);
      spotifyTokenRef.current = null;
      localStorage.removeItem('spotify_token');
      localStorage.removeItem('spotify_refresh_token');
      return null;
    }
  };

  const spotifyFetch = async (url: string, options: RequestInit = {}, allowRefresh = true): Promise<Response> => {
    const token = spotifyTokenRef.current;
    if (!token) throw new Error('Spotify is not connected');

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 5500);
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          ...((options.headers as Record<string, string>) || {}),
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.status === 401 && allowRefresh) {
        const refreshed = await refreshSpotifyToken();
        if (refreshed) return spotifyFetch(url, options, false);
      }
      return response;
    } finally {
      window.clearTimeout(timeout);
    }
  };

  const normalizeTrack = (track: any): Track => ({
    id: track.id,
    name: track.name,
    artist: track.artists?.map((a: any) => a.name).join(', ') || 'Unknown Artist',
    albumArt: track.album?.images?.[0]?.url || '',
    uri: track.uri,
    durationMs: track.duration_ms || 100000
  });

  const withDevice = (baseUrl: string, id: string | null) => {
    if (!id) return baseUrl;
    const separator = baseUrl.includes('?') ? '&' : '?';
    return `${baseUrl}${separator}device_id=${encodeURIComponent(id)}`;
  };

  const ensurePlaybackDevice = async () => {
    let id = deviceIdRef.current;
    let discoveredNow = false;

    if (!id) {
      const response = await spotifyFetch('https://api.spotify.com/v1/me/player/devices');
      if (response.ok) {
        const data = await response.json();
        const devices = data.devices || [];
        const preferred = devices.find((d: any) => d.name === 'Orion Smart Mirror') || devices.find((d: any) => d.is_active) || devices[0];
        if (preferred?.id) {
          id = preferred.id;
          discoveredNow = true;
          setDeviceId(id);
          deviceIdRef.current = id;
        }
      }
    }

    if (id && discoveredNow) {
      await spotifyFetch('https://api.spotify.com/v1/me/player', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_ids: [id], play: false })
      }).catch(() => undefined);
    }

    return id;
  };

  const chooseSpotifyResult = (data: any, query: string, mediaType = 'auto') => {
    const normalizedType = String(mediaType || 'auto').toLowerCase();
    const moodOrPlaylist = /\b(playlist|mix|chill|focus|study|workout|party|sleep|lofi|jazz|ambient|relax|road trip)\b/i.test(query);

    if (normalizedType === 'playlist' || (normalizedType === 'auto' && moodOrPlaylist)) {
      const playlist = data.playlists?.items?.find(Boolean);
      if (playlist) return { kind: 'playlist', uri: playlist.uri, name: playlist.name };
    }
    if (normalizedType === 'artist') {
      const artist = data.artists?.items?.find(Boolean);
      if (artist) return { kind: 'artist', uri: artist.uri, name: artist.name };
    }
    if (normalizedType === 'album') {
      const album = data.albums?.items?.find(Boolean);
      if (album) return { kind: 'album', uri: album.uri, name: album.name };
    }

    const track = data.tracks?.items?.find(Boolean);
    if (track) return { kind: 'track', uri: track.uri, name: track.name, track: normalizeTrack(track) };

    const playlist = data.playlists?.items?.find(Boolean);
    if (playlist) return { kind: 'playlist', uri: playlist.uri, name: playlist.name };
    const artist = data.artists?.items?.find(Boolean);
    if (artist) return { kind: 'artist', uri: artist.uri, name: artist.name };
    const album = data.albums?.items?.find(Boolean);
    if (album) return { kind: 'album', uri: album.uri, name: album.name };
    return null;
  };

  const playVoiceSearch = async (query: string, mediaType = 'auto') => {
    if (!query.trim()) return;
    const cleanQ = query.trim();
    const id = await ensurePlaybackDevice();

    // Check if user specifically requested their Liked Songs library
    const isLikedSongsReq = /\b(liked\s*songs?|my\s*library|saved\s*tracks?|my\s*songs?)\b/i.test(cleanQ);

    if (isLikedSongsReq) {
      // Check if user wants a specific song from their Liked Songs
      // e.g. "play blinding lights from my liked songs" or "find starboy in my liked songs and play it"
      const specificSongMatch = cleanQ.replace(/\b(play|find|listen to|search for|a song|song)\b/gi, '')
        .replace(/\b(from|in)\s*(my\s*)?(liked\s*songs?|library|saved\s*tracks?)\b/gi, '')
        .replace(/\b(and\s*play\s*it|on\s*spotify|please)\b/gi, '')
        .trim();

      const availableTracks = tracksRef.current.length > 0 ? tracksRef.current : tracks;

      if (specificSongMatch && specificSongMatch.length > 1 && !/^(my|all|some|any)$/i.test(specificSongMatch)) {
        // Look for matching track in user's Liked Songs
        const target = specificSongMatch.toLowerCase();
        const matchedInLibrary = availableTracks.find(t => 
          t.name.toLowerCase().includes(target) || t.artist.toLowerCase().includes(target)
        );

        if (matchedInLibrary) {
          setCurrentTrack(matchedInLibrary);
          setProgressMs(0);
          setIsPlaying(true);
          setShowPlaylist(false);

          const playResponse = await spotifyFetch(withDevice('https://api.spotify.com/v1/me/player/play', id), {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              uris: availableTracks.map(t => t.uri),
              offset: { uri: matchedInLibrary.uri }
            })
          });

          if (!playResponse.ok) {
            setIsPlaying(false);
            window.open(`https://open.spotify.com/track/${matchedInLibrary.id}`, '_blank');
          }
          return;
        }
      }

      // Play the Liked Songs collection generally
      if (availableTracks.length > 0) {
        const firstTrack = availableTracks[0];
        setCurrentTrack(firstTrack);
        setProgressMs(0);
        setIsPlaying(true);
        setShowPlaylist(false);

        const playResponse = await spotifyFetch(withDevice('https://api.spotify.com/v1/me/player/play', id), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            uris: availableTracks.slice(0, 50).map(t => t.uri),
            offset: { position: 0 }
          })
        });

        if (!playResponse.ok) {
          setIsPlaying(false);
        }
        return;
      }
    }

    // General Spotify catalog search (e.g., "play [song name]" or "play [song] by [artist]")
    const response = await spotifyFetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(cleanQ)}&type=track,playlist,artist,album&limit=5`);
    if (!response.ok) throw new Error(`Spotify search failed: ${response.status}`);
    const data = await response.json();
    const selected = chooseSpotifyResult(data, cleanQ, mediaType);
    if (!selected) return;

    const selectedTrack = (selected as any).track as Track | undefined;
    if (selectedTrack) {
      setCurrentTrack(selectedTrack);
      setProgressMs(0);
    }
    setIsPlaying(true);
    setShowPlaylist(false);

    const body = selected.kind === 'track' ? { uris: [selected.uri] } : { context_uri: selected.uri };
    const playResponse = await spotifyFetch(withDevice('https://api.spotify.com/v1/me/player/play', id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!playResponse.ok) {
      setIsPlaying(false);
      throw new Error(`Spotify playback failed: ${playResponse.status}`);
    }
  };

  const setPlayerVolume = async (volume: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(volume)));
    const id = await ensurePlaybackDevice();
    await playerRef.current?.setVolume?.(clamped / 100);
    await spotifyFetch(withDevice(`https://api.spotify.com/v1/me/player/volume?volume_percent=${clamped}`, id), { method: 'PUT' });
  };

  const handleSpotifyVoiceAction = async (detail: any) => {
    const action = String(detail?.action || 'play').toLowerCase();
    try {
      if (action === 'play') {
        await playVoiceSearch(String(detail?.query || ''), detail?.mediaType || detail?.media_type || 'auto');
      } else if (action === 'pause' || action === 'stop') {
        setIsPlaying(false);
        await playerRef.current?.pause?.();
        await spotifyFetch('https://api.spotify.com/v1/me/player/pause', { method: 'PUT' });
      } else if (action === 'resume') {
        setIsPlaying(true);
        await playerRef.current?.resume?.();
        await spotifyFetch(withDevice('https://api.spotify.com/v1/me/player/play', await ensurePlaybackDevice()), { method: 'PUT' });
      } else if (action === 'toggle') {
        await togglePlay();
      } else if (action === 'next') {
        await nextTrack();
      } else if (action === 'previous' || action === 'prev') {
        await prevTrack();
      } else if (action === 'volume' && detail?.volume !== undefined) {
        await setPlayerVolume(Number(detail.volume));
      } else if (action === 'volume_up') {
        await setPlayerVolume(75);
      } else if (action === 'volume_down') {
        await setPlayerVolume(35);
      } else if (action === 'shuffle') {
        const state = detail?.shuffle !== false;
        await spotifyFetch(withDevice(`https://api.spotify.com/v1/me/player/shuffle?state=${state}`, await ensurePlaybackDevice()), { method: 'PUT' });
      } else if (action === 'repeat') {
        const state = ['track', 'context', 'off'].includes(String(detail?.repeat)) ? String(detail.repeat) : 'context';
        await spotifyFetch(withDevice(`https://api.spotify.com/v1/me/player/repeat?state=${state}`, await ensurePlaybackDevice()), { method: 'PUT' });
      }
    } catch (err) {
      console.error('Spotify voice action failed', err);
    }
  };

  useEffect(() => {
    const handleVoiceAction = (e: any) => handleSpotifyVoiceAction(e.detail);
    const handleLegacyVoicePlay = (e: any) => handleSpotifyVoiceAction({ action: 'play', query: e.detail, mediaType: 'track' });
    window.addEventListener('spotify_voice_action', handleVoiceAction);
    window.addEventListener('spotify_voice_play', handleLegacyVoicePlay);
    return () => {
      window.removeEventListener('spotify_voice_action', handleVoiceAction);
      window.removeEventListener('spotify_voice_play', handleLegacyVoicePlay);
    };
  });

  useEffect(() => {
    if (!spotifyToken) return;

    if (!document.getElementById("spotify-player-script")) {
      const script = document.createElement("script");
      script.id = "spotify-player-script";
      script.src = "https://sdk.scdn.co/spotify-player.js";
      script.async = true;
      document.body.appendChild(script);
    }

    (window as any).onSpotifyWebPlaybackSDKReady = () => {
        const player = new (window as any).Spotify.Player({
            name: 'Orion Smart Mirror',
            getOAuthToken: (cb: any) => { cb(spotifyTokenRef.current || spotifyToken); },
            volume: 0.5
        });
        playerRef.current = player;

        player.addListener('ready', ({ device_id }: any) => {
            console.log('Ready with Device ID', device_id);
            setDeviceId(device_id);
            deviceIdRef.current = device_id;
            // Transfer playback to this newly created device
            fetch('https://api.spotify.com/v1/me/player', {
                method: 'PUT',
                headers: { 'Authorization': `Bearer ${spotifyToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ device_ids: [device_id], play: false })
            }).catch(console.error);
        });

        player.addListener('not_ready', ({ device_id }: any) => {
            console.log('Device ID has gone offline', device_id);
        });

        player.connect();
    };
  }, [spotifyToken]);

  // Setup OAuth message listener
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'SPOTIFY_AUTH_SUCCESS') {
        const token = event.data.token;
        setSpotifyToken(token);
        spotifyTokenRef.current = token;
        localStorage.setItem('spotify_token', token);
        if (event.data.refreshToken) {
          localStorage.setItem('spotify_refresh_token', event.data.refreshToken);
        }
        fetchMySavedTracks(token);
      }
    };
    window.addEventListener('message', handleMessage);
    
    // Check local storage for existing token
    const existing = localStorage.getItem('spotify_token');
    if (existing) {
      setSpotifyToken(existing);
      spotifyTokenRef.current = existing;
      fetchMySavedTracks(existing);
    }
    
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  useEffect(() => {
    if (!spotifyToken) return;
    
    // Poll for currently playing track
    const checkCurrentPlayback = async () => {
      try {
        let currentDeviceId = deviceId;
        const response = await fetch('https://api.spotify.com/v1/me/player', {
          headers: { 'Authorization': `Bearer ${spotifyToken}` }
        });

        if (response.status === 401) {
          await refreshSpotifyToken();
          return;
        }
        
        if (response.status === 200) {
          const text = await response.text();
          let data;
          try { data = JSON.parse(text); } catch(e) { return; }
          setIsPlaying(data.is_playing);
          if (data.device) {
             currentDeviceId = data.device.id;
             setDeviceId(currentDeviceId);
             deviceIdRef.current = currentDeviceId;
          }
          if (data.item) {
            const track: Track = {
              id: data.item.id,
              name: data.item.name,
              artist: data.item.artists?.map((a: any) => a.name).join(', ') || 'Unknown Artist',
              albumArt: data.item.album?.images?.[0]?.url || '',
              uri: data.item.uri,
              durationMs: data.item.duration_ms || 100000
            };
            setCurrentTrack(track);
            if (!isDragging) {
              setProgressMs(data.progress_ms);
            }
          }
        } else if (response.status === 204) {
          setIsPlaying(false);
        }

        // Try to find a device if none active
        if (!currentDeviceId) {
           const devRes = await fetch('https://api.spotify.com/v1/me/player/devices', {
             headers: { 'Authorization': `Bearer ${spotifyToken}` }
           });
           if (devRes.ok) {
             const text = await devRes.text();
             let devData;
             try { devData = JSON.parse(text); } catch(e) {}
             if (devData && devData.devices && devData.devices.length > 0) {
               const active = devData.devices.find((d: any) => d.is_active) || devData.devices[0];
               if (active) {
                  currentDeviceId = active.id;
                  setDeviceId(active.id);
                  deviceIdRef.current = active.id;
               }
             }
           }
        }
      } catch (err) {
        console.error("Failed to check playback status", err);
      }
    };

    checkCurrentPlayback();
    const interval = setInterval(checkCurrentPlayback, 3000);
    return () => clearInterval(interval);
  }, [spotifyToken, isDragging]);

  const fetchMySavedTracks = async (token: string) => {
    setIsLoadingTracks(true);
    try {
      // Fetch authentic user Liked Songs from /v1/me/tracks
      let response = await fetch('https://api.spotify.com/v1/me/tracks?limit=50', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      // If user-library-read is not available or empty, fallback to recently-played
      if (!response.ok && response.status !== 401) {
        response = await fetch('https://api.spotify.com/v1/me/player/recently-played?limit=50', {
          headers: { 'Authorization': `Bearer ${token}` }
        }).catch(() => response);
      }

      if (!response.ok) {
        if (response.status === 401) {
          const refreshedToken = await refreshSpotifyToken();
          if (refreshedToken) {
            fetchMySavedTracks(refreshedToken);
          }
        }
        setIsLoadingTracks(false);
        return;
      }
      
      const text = await response.text();
      let data;
      try { data = JSON.parse(text); } catch(e) { console.error("Spotify JSON error:", text); return; }
      if (data && data.items && data.items.length > 0) {
        const formattedTracks = data.items.filter((i:any)=>i.track).map((item: any) => ({
          id: item.track.id,
          name: item.track.name,
          artist: item.track.artists?.map((a: any) => a.name).join(', ') || 'Unknown Artist',
          albumArt: item.track.album?.images?.[0]?.url || 'https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?auto=format&fit=crop&q=80&w=300&h=300',
          uri: item.track.uri,
          durationMs: item.track.duration_ms || 100000
        }));
        setTracks(formattedTracks);
        if (!currentTrack) setCurrentTrack(formattedTracks[0]);
      }
    } catch (e) {
      console.error("Failed to fetch Spotify tracks", e);
    } finally {
      setIsLoadingTracks(false);
    }
  };

  const handleConnect = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const response = await fetch('/api/spotify/auth/url');
      const { url } = await response.json();
      window.open(url, 'spotify_oauth', 'width=600,height=700');
    } catch (err) {
      console.error("Failed to get auth URL", err);
    }
  };

  useEffect(() => {
    if (!currentTrack && tracks.length > 0) {
      setCurrentTrack(tracks[0]);
    }
  }, [tracks, currentTrack]);

  // Simulate progress
  useEffect(() => {
    let interval: any;
    if (isPlaying && !isDragging && currentTrack) {
      interval = setInterval(() => {
        setProgressMs(prev => {
          if (prev + 1000 >= currentTrack.durationMs) {
            setIsPlaying(false);
            return 0;
          }
          return prev + 1000;
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isPlaying, isDragging, currentTrack]);

  const togglePlay = async () => {
    if (spotifyToken) {
      try {
        if (isPlaying) {
          setIsPlaying(false);
          await fetch('https://api.spotify.com/v1/me/player/pause', {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${spotifyToken}` }
          });
        } else {
          setIsPlaying(true);
          // Attempt to play
          const res = await fetch(`https://api.spotify.com/v1/me/player/play${deviceId ? `?device_id=${deviceId}` : ''}`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${spotifyToken}` }
          });
          
          if (!res.ok) {
            setIsPlaying(false);
            if (currentTrack?.id) {
               window.open(`https://open.spotify.com/track/${currentTrack.id}`, '_blank');
            } else {
               window.open('https://open.spotify.com', '_blank');
            }
          }
        }
      } catch(e) {
        console.error(e);
        // Revert on error
        setIsPlaying(!isPlaying);
      }
    } else {
      setIsPlaying(!isPlaying);
    }
  };

  const formatTime = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const handleSeek = async (e: React.MouseEvent | React.TouchEvent) => {
    if (!sliderRef.current || !currentTrack) return;
    const rect = sliderRef.current.getBoundingClientRect();
    let clientX = 0;
    if ('touches' in e) {
      clientX = e.touches[0].clientX;
    } else {
      clientX = (e as React.MouseEvent).clientX; // Fixed typescript issue by checking type
    }
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    const percentage = x / rect.width;
    const newProgressMs = Math.floor(percentage * currentTrack.durationMs);

    setProgressMs(newProgressMs);

    if (spotifyToken) {
       try {
         await fetch(`https://api.spotify.com/v1/me/player/seek?position_ms=${newProgressMs}`, {
           method: 'PUT',
           headers: { 'Authorization': `Bearer ${spotifyToken}` }
         });
       } catch (err) {
         console.error('Seek failed', err);
       }
    }
  };

  const playCustomTrack = async (track: Track) => {
    if (!spotifyToken) return;
    
    // Optimistic UI update for fastest response
    setCurrentTrack(track);
    setProgressMs(0);
    setIsPlaying(true);
    setShowPlaylist(false);

    try {
      const isTrackInLibrary = tracks.some(t => t.uri === track.uri);
      const reqBody = isTrackInLibrary 
         ? { uris: tracks.map(t => t.uri), offset: { uri: track.uri } }
         : { uris: [track.uri] };

      const res = await fetch(`https://api.spotify.com/v1/me/player/play${deviceId ? `?device_id=${deviceId}` : ''}`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${spotifyToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(reqBody)
      });
      
      if (!res.ok) {
         setIsPlaying(false);
         window.open(`https://open.spotify.com/track/${track.id}`, '_blank');
      }
    } catch (e) {
      console.error(e);
      setIsPlaying(false);
      window.open(`https://open.spotify.com/track/${track.id}`, '_blank');
    }
  };

  const playCustomTrackRef = useRef<any>(null);
  useEffect(() => {
    playCustomTrackRef.current = playCustomTrack;
  }, [playCustomTrack]);

  const nextTrack = async () => {
    const idx = tracks.findIndex(t => t.id === currentTrack?.id);
    if (idx >= 0 && idx < tracks.length - 1) {
      setCurrentTrack(tracks[idx + 1]);
    } else if (tracks.length > 0) {
      setCurrentTrack(tracks[0]);
    }
    setProgressMs(0);
    setIsPlaying(true);

    if (spotifyToken) {
      await fetch('https://api.spotify.com/v1/me/player/next', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${spotifyToken}` }
      });
    }
  };

  const prevTrack = async () => {
    const idx = tracks.findIndex(t => t.id === currentTrack?.id);
    if (idx > 0) {
      setCurrentTrack(tracks[idx - 1]);
    } else if (tracks.length > 0) {
      setCurrentTrack(tracks[tracks.length - 1]);
    }
    setProgressMs(0);
    setIsPlaying(true);

    if (spotifyToken) {
      await fetch('https://api.spotify.com/v1/me/player/previous', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${spotifyToken}` }
      });
    }
  };

  const currentArt = currentTrack?.albumArt || tracks[0]?.albumArt || 'https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?auto=format&fit=crop&q=80&w=300&h=300';

  return (
    <div className="relative w-full h-[220px] rounded-[2rem] overflow-hidden shadow-[0_8px_32px_rgba(0,0,0,0.4)] group border border-white/20 select-none">
      {/* Background Liquid Glass Effect */}
      <div 
        className="absolute inset-0 bg-cover bg-center transition-all duration-1000 scale-[1.2] blur-xl opacity-80"
        style={{ backgroundImage: `url(${currentArt})` }}
      />
      <div className="absolute inset-0 bg-black/40 mix-blend-overlay"></div>
      <div className="absolute inset-0 bg-gradient-to-tr from-black/60 via-transparent to-white/10"></div>
      
      {/* Visualizer effect top right */}
      <div className="absolute right-6 top-6 flex items-end gap-1 h-6 z-10 opacity-70">
         <motion.div animate={{ height: isPlaying ? ['6px', '16px', '6px'] : '4px' }} transition={{ repeat: Infinity, duration: 1.0, ease: "easeInOut" }} className="w-[3px] bg-white rounded-full shadow-[0_0_8px_rgba(255,255,255,0.8)]" />
         <motion.div animate={{ height: isPlaying ? ['10px', '24px', '10px'] : '4px' }} transition={{ repeat: Infinity, duration: 0.8, delay: 0.2, ease: "easeInOut" }} className="w-[3px] bg-white rounded-full shadow-[0_0_8px_rgba(255,255,255,0.8)]" />
         <motion.div animate={{ height: isPlaying ? ['8px', '18px', '8px'] : '4px' }} transition={{ repeat: Infinity, duration: 1.2, delay: 0.4, ease: "easeInOut" }} className="w-[3px] bg-white rounded-full shadow-[0_0_8px_rgba(255,255,255,0.8)]" />
      </div>

      <div className="relative z-10 p-6 flex flex-col h-full text-white justify-between">
        {/* Top: Album Art & Info */}
        <div className="flex flex-col gap-4">
           {/* Image & Text row */}
           <div className="flex gap-4 items-center">
              <motion.div 
                 whileHover={{ scale: 1.05 }}
                 whileTap={{ scale: 0.95 }}
                 onClick={() => window.open(`https://open.spotify.com/track/${currentTrack?.id}`, '_blank')}
                 className="w-16 h-16 rounded-2xl overflow-hidden shadow-[0_8px_16px_rgba(0,0,0,0.6)] border border-white/30 cursor-pointer relative group/art"
                 title="Open in Spotify App"
              >
                  <img src={currentArt} alt="Album Art" className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover/art:opacity-100 transition-opacity flex items-center justify-center">
                     <svg viewBox="0 0 24 24" className="w-8 h-8 text-[#1DB954] drop-shadow-md" fill="currentColor">
                         <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.24 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15.001 10.62 18.661 12.84c.42.24.6.84.3 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.6.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
                     </svg>
                  </div>
              </motion.div>
              <div className="flex flex-col text-shadow-sm flex-1 overflow-hidden" onClick={() => window.open(`https://open.spotify.com/track/${currentTrack?.id}`, '_blank')} style={{ cursor: 'pointer' }}>
                <h3 className="font-bold text-xl leading-tight drop-shadow-md truncate hover:underline">{currentTrack?.name || 'Unknown Track'}</h3>
                <p className="text-white/80 font-medium text-sm truncate drop-shadow-sm">{currentTrack?.artist || 'Unknown Artist'}</p>
              </div>
              <motion.button 
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                onClick={() => setShowPlaylist(!showPlaylist)} 
                className="p-2.5 bg-white/10 hover:bg-white/20 rounded-xl transition-colors border border-white/10 shadow-lg ml-auto"
                title="Your Library"
              >
                 <ListMusic size={22} className="text-white drop-shadow-md" />
              </motion.button>
           </div>
        </div>

        {/* Middle: Slider */}
        <div className="flex items-center gap-3 text-xs font-bold text-white/90 mt-4 backdrop-blur-sm bg-black/10 px-3 py-1.5 rounded-full border border-white/10">
          <span className="w-8 text-right drop-shadow-sm">{formatTime(progressMs)}</span>
          <div 
            ref={sliderRef}
            className="flex-1 h-4 group/slider relative cursor-pointer flex items-center"
            onMouseDown={(e) => { setIsDragging(true); handleSeek(e); }}
            onMouseMove={(e) => { if(isDragging) handleSeek(e); }}
            onMouseUp={() => setIsDragging(false)}
            onMouseLeave={() => setIsDragging(false)}
            onTouchStart={(e) => { setIsDragging(true); handleSeek(e); }}
            onTouchMove={(e) => { if(isDragging) handleSeek(e); }}
            onTouchEnd={() => setIsDragging(false)}
          >
            <div className="absolute inset-x-0 h-1.5 bg-white/30 rounded-full overflow-hidden shadow-inner">
               <div 
                 className="h-full bg-white transition-none shadow-[0_0_10px_rgba(255,255,255,0.8)]"
                 style={{ width: `${(progressMs / (currentTrack?.durationMs || 1)) * 100}%` }}
               />
            </div>
            {/* Scrubber handle */}
            <motion.div 
               className="w-4 h-4 bg-white rounded-full shadow-[0_2px_8px_rgba(0,0,0,0.6)] absolute pointer-events-none group-hover/slider:scale-125 transition-transform"
               style={{ left: `calc(${(progressMs / (currentTrack?.durationMs || 1)) * 100}% - 8px)` }}
            />
          </div>
          <span className="w-8 drop-shadow-sm">-{formatTime((currentTrack?.durationMs || 0) - progressMs)}</span>
        </div>

        {/* Bottom: Controls */}
        <div className="flex items-center justify-center gap-8 mt-2">
          <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }} onClick={prevTrack} className="p-2 text-white hover:text-white transition-colors">
            <SkipBack size={26} className="fill-current drop-shadow-lg" />
          </motion.button>
          
          <motion.button 
            whileHover={{ scale: 1.05 }} 
            whileTap={{ scale: 0.95 }} 
            onClick={togglePlay} 
            className="w-14 h-14 flex items-center justify-center rounded-full bg-white/20 backdrop-blur-md border border-white/40 text-white shadow-[0_8px_16px_rgba(0,0,0,0.4)]"
          >
            {isPlaying ? (
              <Pause size={24} className="fill-current drop-shadow-md" />
            ) : (
              <Play size={24} className="fill-current ml-1 drop-shadow-md" />
            )}
          </motion.button>
          
          <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }} onClick={nextTrack} className="p-2 text-white hover:text-white transition-colors">
            <SkipForward size={26} className="fill-current drop-shadow-lg" />
          </motion.button>
        </div>
      </div>

      {/* Playlist Modal */}
      <AnimatePresence>
        {showPlaylist && (
          <motion.div 
            initial={{ y: '100%', opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: '100%', opacity: 0 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="absolute inset-0 z-20 bg-black/60 backdrop-blur-3xl flex flex-col pt-6 rounded-[2rem] overflow-hidden"
          >
            <div className="px-6 flex justify-between items-center mb-4">
               <h3 className="text-white font-bold text-lg flex items-center gap-2 drop-shadow-md"><Disc size={20}/> Spotify Library</h3>
               <button onClick={() => setShowPlaylist(false)} className="bg-white/20 hover:bg-white/30 px-4 py-1.5 rounded-full text-xs font-bold text-white transition-colors shadow-lg border border-white/10">Close</button>
            </div>
            
            <div className="flex-1 overflow-y-auto px-4 pb-6 flex flex-col gap-2">
              {!spotifyToken && (
                <div className="mt-2 flex flex-col items-center justify-center p-6 bg-white/10 rounded-2xl border border-white/20 text-center gap-4 shadow-lg backdrop-blur-md">
                   <Music size={32} className="text-white/80 drop-shadow-md" />
                   <p className="text-sm text-white font-medium">Connect to Spotify to see your full library.</p>
                   <button 
                    onClick={handleConnect}
                    className="bg-[#1DB954] text-black font-extrabold text-sm py-3 px-8 rounded-full hover:bg-[#1ed760] transition-colors shadow-[0_4px_12px_rgba(29,185,84,0.4)]"
                   >
                     Connect Spotify
                   </button>
                </div>
              )}
              
              {spotifyToken && isLoadingTracks && (
                 <div className="flex justify-center p-8">
                   <Loader2 size={32} className="text-white animate-spin" />
                 </div>
              )}

              {spotifyToken && !isLoadingTracks && tracks.map((track, i) => (
                 <div 
                   key={`${track.id}-${i}`}
                   onClick={() => playCustomTrack(track)}
                   className={`flex items-center gap-4 p-3 rounded-2xl cursor-pointer transition-all border ${currentTrack?.id === track.id ? 'bg-white/20 border-white/30 shadow-lg' : 'hover:bg-white/15 border-transparent'}`}
                 >
                   <img src={track.albumArt} alt="art" className="w-14 h-14 rounded-xl shadow-md" />
                   <div className="flex-1 truncate">
                     <p className={`font-bold text-sm truncate ${currentTrack?.id === track.id ? 'text-white' : 'text-white/90'}`}>{track.name}</p>
                     <p className="text-xs text-white/60 truncate font-medium">{track.artist}</p>
                   </div>
                   {currentTrack?.id === track.id && isPlaying && (
                     <div className="flex items-end gap-[2px] h-4 mr-3">
                         <motion.div animate={{ height: ['4px', '12px', '4px'] }} transition={{ repeat: Infinity, duration: 0.8, ease: "easeInOut" }} className="w-[3px] bg-white rounded-full shadow-[0_0_8px_rgba(255,255,255,0.8)]" />
                         <motion.div animate={{ height: ['8px', '16px', '8px'] }} transition={{ repeat: Infinity, duration: 0.6, delay: 0.2, ease: "easeInOut" }} className="w-[3px] bg-white rounded-full shadow-[0_0_8px_rgba(255,255,255,0.8)]" />
                         <motion.div animate={{ height: ['5px', '10px', '5px'] }} transition={{ repeat: Infinity, duration: 0.9, delay: 0.4, ease: "easeInOut" }} className="w-[3px] bg-white rounded-full shadow-[0_0_8px_rgba(255,255,255,0.8)]" />
                     </div>
                   )}
                 </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}



