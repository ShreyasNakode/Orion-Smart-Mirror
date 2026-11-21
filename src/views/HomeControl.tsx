import React from 'react';
import { motion } from 'motion/react';
import { GlassCard } from '../components/GlassCard';
import { 
  Lightbulb, Fan, Thermometer, Tv, 
  ToggleRight, Lock, Unlock, Blinds, Activity,
  Play, Pause, SkipForward, SkipBack, Plus, Minus, Volume2
} from 'lucide-react';
import { cn } from '../lib/utils';
import { SmartDevice } from '../types';
import { useAppContext } from '../context/AppContext';
import { HomeAssistantWebView } from '../components/HomeAssistantWebView';

export function HomeControl() {
  const { devices, setDevices, callHAService } = useAppContext();

  const toggleDevice = (device: SmartDevice) => {
    if (callHAService) {
      const domain = device.id.split('.')[0];
      let service = device.isOn ? 'turn_off' : 'turn_on';
      
      if (domain === 'lock') {
        service = device.isOn ? 'lock' : 'unlock';
      } else if (domain === 'cover') {
        service = device.isOn ? 'close_cover' : 'open_cover';
      }
      
      callHAService(domain, service, { entity_id: device.id });
    }
    // Optimistic UI update
    setDevices(devices.map(d => d.id === device.id ? { ...d, isOn: !d.isOn } : d));
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="pt-6 pb-32 pl-4 pr-16 sm:px-8 w-full h-full overflow-y-auto flex flex-col gap-8"
    >
      {/* Top Title Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pl-14">
        <div>
          <h1 className="text-4xl font-extrabold tracking-tight mb-2">Home Control</h1>
          <p className="text-sm font-medium text-on-surface-variant">
            Home Assistant &amp; Smart Device Management
          </p>
        </div>
      </div>

      {/* Main Display Area */}
      <div className="w-full transition-all duration-300">
        <HomeAssistantWebView className="min-h-[700px] h-[calc(100vh-220px)]" />
      </div>

      {/* Pure Native Device Cards View Mode */}
      <div className="w-full transition-all duration-300">
        <NativeDevicesGrid devices={devices} onToggle={toggleDevice} />
      </div>
    </motion.div>
  );
}

function NativeDevicesGrid({ devices, onToggle }: { devices: SmartDevice[]; onToggle: (d: SmartDevice) => void }) {
  if (devices.length === 0) {
    return (
      <div className="text-on-surface-variant text-center py-16 font-medium bg-surface-container/40 rounded-3xl border border-white/5">
        No smart devices found on Home Assistant.
      </div>
    );
  }

  const rooms = Array.from(new Set(devices.map(d => d.room)));

  return (
    <div className="space-y-8">
      {rooms.map((room, index) => (
        <div key={room}>
          <h2 className={cn("text-xl font-bold mb-6 flex items-center gap-2", index > 0 && "mt-8")}>
            {room}
            <div className="h-[1px] flex-1 bg-white/10 ml-4 rounded-full" />
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {devices.filter(d => d.room === room).map(device => (
              <DeviceCard key={device.id} device={device} onToggle={() => onToggle(device)} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function DeviceCard({ device, onToggle }: { device: SmartDevice, onToggle: () => void, key?: any }) {
  const { callHAService } = useAppContext();

  const getIcon = () => {
    switch (device.type) {
      case 'light': return <Lightbulb size={24} className={device.isOn ? "text-primary filter drop-shadow-[0_0_8px_rgba(164,201,255,0.6)]" : "text-on-surface-variant"} />;
      case 'fan': return <Fan size={24} className={cn("transition-transform", device.isOn ? "text-secondary animate-spin-slow" : "text-on-surface-variant")} />;
      case 'ac': return <Thermometer size={24} className={device.isOn ? "text-tertiary animate-pulse" : "text-on-surface-variant"} />;
      case 'tv': return <Tv size={24} className={device.isOn ? "text-primary" : "text-on-surface-variant"} />;
      case 'lock': return device.isOn ? <Unlock size={24} className="text-secondary" /> : <Lock size={24} className="text-red-400" />;
      case 'cover': return <Blinds size={24} className={device.isOn ? "text-primary" : "text-on-surface-variant"} />;
      case 'sensor': return <Activity size={24} className="text-cyan-400" />;
      default: return <ToggleRight size={24} className={device.isOn ? "text-primary" : "text-on-surface-variant"} />;
    }
  };

  const getStatusText = () => {
    if (device.type === 'sensor') {
      return `${device.state}${device.attributes?.unit_of_measurement || ''}`;
    }
    if (device.type === 'lock') {
      return device.isOn ? 'Unlocked' : 'Locked';
    }
    if (device.type === 'cover') {
      return device.isOn ? (device.value ? `Open • ${device.value}%` : 'Open') : 'Closed';
    }
    if (!device.isOn) return 'Off';
    switch (device.type) {
      case 'light': return device.value ? `On • ${device.value}% Brightness` : 'On';
      case 'fan': return device.value ? `Speed ${device.value}%` : 'On';
      case 'ac': return device.value ? `Cooling to ${device.value}°` : 'On';
      case 'tv': return 'On';
      default: return 'On';
    }
  };

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value);
    if (!callHAService) return;
    
    if (device.type === 'light') {
      callHAService('light', 'turn_on', { entity_id: device.id, brightness_pct: val });
    } else if (device.type === 'fan') {
      callHAService('fan', 'set_percentage', { entity_id: device.id, percentage: val });
    } else if (device.type === 'ac') {
      callHAService('climate', 'set_temperature', { entity_id: device.id, temperature: val });
    }
  };

  const isReadOnly = device.type === 'sensor';

  return (
    <GlassCard 
      variant={isReadOnly ? "default" : "interactive"} 
      className="p-6 relative group overflow-hidden" 
      onClick={isReadOnly ? undefined : onToggle}
    >
      {device.isOn && !isReadOnly && (
         <div className="absolute inset-0 bg-primary/5 pointer-events-none" />
      )}
      
      <div className="flex justify-between items-start mb-6 relative z-10">
        <div className={cn(
          "w-12 h-12 rounded-full flex items-center justify-center transition-colors",
          device.isOn ? "bg-white/10 shadow-[0_0_15px_rgba(255,255,255,0.1)]" : "bg-white/5"
        )}>
          {getIcon()}
        </div>
        
        {!isReadOnly && (
          <div 
             className={cn(
               "w-12 h-6 rounded-full p-1 flex items-center transition-colors duration-300 pointer-events-auto",
               device.isOn ? "bg-primary" : "bg-surface-container-high"
             )}
             onClick={(e) => { e.stopPropagation(); onToggle(); }}
          >
             <motion.div 
               className="bg-white w-4 h-4 rounded-full shadow-sm"
               animate={{ x: device.isOn ? 24 : 0 }}
               transition={{ type: "spring", stiffness: 500, damping: 30 }}
             />
          </div>
        )}
      </div>

      <div className="relative z-10 mb-4">
        <h3 className="font-bold text-xl tracking-tight mb-1">{device.name}</h3>
        <p className="text-sm font-medium text-on-surface-variant">{getStatusText()}</p>
      </div>

      {/* Light Brightness Slider */}
      {device.isOn && device.type === 'light' && device.capabilities?.some(c => c.type === 'brightness') && (
        <div className="relative z-20 mt-4" onClick={e => e.stopPropagation()}>
          <div className="flex justify-between text-xs text-on-surface-variant font-medium mb-1">
            <span>Brightness</span>
            <span>{device.value || 0}%</span>
          </div>
          <input 
            type="range" 
            min={1} 
            max={100} 
            value={device.value || 0}
            onChange={handleSliderChange}
            className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/50 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:rounded-full"
          />
        </div>
      )}

      {/* Fan Speed Control */}
      {device.isOn && device.type === 'fan' && (
        <div className="mt-4 relative z-20" onClick={e => e.stopPropagation()}>
          <div className="flex justify-between text-xs text-on-surface-variant font-medium mb-1">
            <span>Speed</span>
            <span>{device.value || 0}%</span>
          </div>
          <input 
            type="range" 
            min={0} 
            max={100} 
            value={device.value || 0}
            onChange={handleSliderChange}
            className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-secondary/50 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-secondary [&::-webkit-slider-thumb]:rounded-full"
          />
        </div>
      )}

      {/* Climate AC controls */}
      {device.isOn && device.type === 'ac' && (
        <div className="mt-4 flex flex-col gap-3 relative z-20" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between gap-4">
            <button 
              onClick={() => callHAService?.('climate', 'set_temperature', { entity_id: device.id, temperature: (device.value || 72) - 1 })}
              className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/15 flex items-center justify-center border border-white/10"
            >
              <Minus size={16} />
            </button>
            <span className="text-lg font-bold">{device.value || 72}°</span>
            <button 
              onClick={() => callHAService?.('climate', 'set_temperature', { entity_id: device.id, temperature: (device.value || 72) + 1 })}
              className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/15 flex items-center justify-center border border-white/10"
            >
              <Plus size={16} />
            </button>
          </div>
          <div className="grid grid-cols-4 gap-1 text-[10px] font-bold">
            {['off', 'heat', 'cool', 'auto'].map(m => (
              <button
                key={m}
                onClick={() => callHAService?.('climate', 'set_hvac_mode', { entity_id: device.id, hvac_mode: m })}
                className={cn(
                  "py-1 rounded capitalize border border-white/5 transition-colors",
                  device.attributes?.hvac_mode === m ? "bg-tertiary text-black" : "bg-white/5 hover:bg-white/10"
                )}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Cover positions */}
      {device.type === 'cover' && (
        <div className="mt-4 flex flex-col gap-2 relative z-20" onClick={e => e.stopPropagation()}>
          <div className="flex gap-2">
            <button
              onClick={() => callHAService?.('cover', 'open_cover', { entity_id: device.id })}
              className="flex-1 py-1 px-2 text-xs font-bold bg-white/5 hover:bg-white/10 rounded border border-white/10"
            >
              Open
            </button>
            <button
              onClick={() => callHAService?.('cover', 'stop_cover', { entity_id: device.id })}
              className="flex-1 py-1 px-2 text-xs font-bold bg-white/5 hover:bg-white/10 rounded border border-white/10"
            >
              Stop
            </button>
            <button
              onClick={() => callHAService?.('cover', 'close_cover', { entity_id: device.id })}
              className="flex-1 py-1 px-2 text-xs font-bold bg-white/5 hover:bg-white/10 rounded border border-white/10"
            >
              Close
            </button>
          </div>
          {device.isOn && device.value !== undefined && (
            <input 
              type="range" 
              min={0} 
              max={100} 
              value={device.value || 0}
              onChange={(e) => callHAService?.('cover', 'set_cover_position', { entity_id: device.id, position: parseInt(e.target.value) })}
              className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer focus:outline-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:rounded-full"
            />
          )}
        </div>
      )}

      {/* Media control (TV) */}
      {device.isOn && device.type === 'tv' && (
        <div className="mt-4 flex flex-col gap-3 relative z-20" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-center gap-4">
            <button 
              onClick={() => callHAService?.('media_player', 'media_previous_track', { entity_id: device.id })}
              className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/15 flex items-center justify-center border border-white/10 text-gray-300"
            >
              <SkipBack size={16} />
            </button>
            <button 
              onClick={() => callHAService?.('media_player', device.state === 'playing' ? 'media_pause' : 'media_play', { entity_id: device.id })}
              className="w-10 h-10 rounded-full bg-primary/20 hover:bg-primary/30 flex items-center justify-center border border-primary/20 text-primary"
            >
              {device.state === 'playing' ? <Pause size={18} /> : <Play size={18} />}
            </button>
            <button 
              onClick={() => callHAService?.('media_player', 'media_next_track', { entity_id: device.id })}
              className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/15 flex items-center justify-center border border-white/10 text-gray-300"
            >
              <SkipForward size={16} />
            </button>
          </div>
          {device.attributes?.volume_level !== undefined && (
            <div className="flex items-center gap-2 text-xs text-on-surface-variant font-medium mt-2">
              <Volume2 size={14} className="shrink-0" />
              <input 
                type="range" 
                min={0} 
                max={100} 
                value={Math.round(device.attributes.volume_level * 100)}
                onChange={(e) => callHAService?.('media_player', 'volume_set', { entity_id: device.id, volume_level: parseInt(e.target.value) / 100 })}
                className="flex-1 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer focus:outline-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:rounded-full"
              />
            </div>
          )}
        </div>
      )}
    </GlassCard>
  );
}
