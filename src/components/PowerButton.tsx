import React, { useState } from 'react';
import { Power } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface PowerButtonProps {
  isPoweredOn: boolean;
  onToggle: () => void;
  className?: string;
}

/**
 * Minimalist, clean Power button for Orion Smart Mirror.
 * Fixed at the extreme right-center of the screen, vertically centered.
 * Hooks dynamically into Orion's CSS theme tokens (--color-primary, --color-accent-glow).
 */
export const PowerButton: React.FC<PowerButtonProps> = ({
  isPoweredOn,
  onToggle,
  className = '',
}) => {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div
      className={`fixed right-3 sm:right-4 md:right-5 top-1/2 -translate-y-1/2 z-[60] flex items-center select-none ${className}`}
      style={{ pointerEvents: 'auto' }}
    >
      {/* Subtle Tooltip Label on Hover (positioned neatly to the left of the button) */}
      <AnimatePresence>
        {isHovered && (
          <motion.div
            initial={{ opacity: 0, x: 8, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 6, scale: 0.95 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="absolute right-[calc(100%+12px)] pointer-events-none whitespace-nowrap px-3 py-1.5 rounded-xl text-xs font-semibold tracking-wide border shadow-2xl backdrop-blur-xl"
            style={{
              background: 'rgba(10, 10, 10, 0.88)',
              borderColor: 'color-mix(in srgb, var(--color-primary, #38bdf8) 40%, rgba(255, 255, 255, 0.2))',
              color: 'var(--color-primary, #38bdf8)',
              boxShadow: '0 8px 24px rgba(0, 0, 0, 0.7), 0 0 16px var(--color-accent-glow, rgba(56, 189, 248, 0.25))',
            }}
          >
            {isPoweredOn ? 'Turn Off Display' : 'Turn On Mirror'}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Power Button Button element */}
      <motion.button
        type="button"
        onClick={onToggle}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: 0.93 }}
        transition={{ type: 'spring', stiffness: 400, damping: 25 }}
        className="relative group w-11 h-11 sm:w-12 sm:h-12 md:w-13 md:h-13 rounded-full flex items-center justify-center cursor-pointer transition-all duration-300 outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
        style={{
          background: isPoweredOn
            ? 'color-mix(in srgb, var(--color-surface-container, #0c0c0c) 80%, rgba(0, 0, 0, 0.9))'
            : 'rgba(12, 12, 12, 0.75)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderWidth: '1.5px',
          borderStyle: 'solid',
          borderColor: isPoweredOn
            ? 'color-mix(in srgb, var(--color-primary, #38bdf8) 65%, rgba(255, 255, 255, 0.35))'
            : 'color-mix(in srgb, var(--color-primary, #38bdf8) 35%, rgba(255, 255, 255, 0.15))',
          boxShadow: isPoweredOn
            ? '0 0 24px var(--color-accent-glow, rgba(56, 189, 248, 0.4)), inset 0 0 14px color-mix(in srgb, var(--color-primary, #38bdf8) 25%, transparent)'
            : '0 0 14px var(--color-accent-glow, rgba(56, 189, 248, 0.2)), inset 0 0 8px rgba(255, 255, 255, 0.05)',
        }}
        aria-label={isPoweredOn ? 'Power Off Mirror Display' : 'Power On Mirror Display'}
        title={isPoweredOn ? 'Power Off Display' : 'Power On Mirror'}
      >
        {/* Ambient Subtle Pulse Ring when Powered Off (Standby breathe effect in active theme color) */}
        {!isPoweredOn && (
          <span
            className="absolute inset-0 rounded-full animate-ping opacity-25 pointer-events-none"
            style={{
              backgroundColor: 'var(--color-primary, #38bdf8)',
              animationDuration: '3s',
            }}
          />
        )}

        {/* Ambient Glow Aura when Powered On */}
        {isPoweredOn && (
          <span
            className="absolute inset-0 rounded-full opacity-40 blur-md pointer-events-none transition-opacity duration-300 group-hover:opacity-75"
            style={{
              backgroundColor: 'var(--color-primary, #38bdf8)',
            }}
          />
        )}

        {/* Inner subtle specular glass highlight */}
        <span className="absolute inset-[2px] rounded-full bg-gradient-to-b from-white/15 to-transparent pointer-events-none" />

        {/* Power Icon inheriting active theme primary color */}
        <Power
          size={20}
          strokeWidth={2.2}
          className="relative z-10 transition-all duration-300"
          style={{
            color: 'var(--color-primary, #38bdf8)',
            filter: isPoweredOn
              ? 'drop-shadow(0 0 8px var(--color-primary, #38bdf8))'
              : 'drop-shadow(0 0 4px var(--color-accent-glow, rgba(56, 189, 248, 0.3)))',
            opacity: isPoweredOn ? 1 : 0.82,
          }}
        />

        {/* Small Active Status Indicator Pip on bottom-right of button */}
        <span
          className="absolute bottom-1 right-1 w-2 h-2 rounded-full transition-all duration-300 pointer-events-none"
          style={{
            backgroundColor: isPoweredOn
              ? 'var(--color-primary, #38bdf8)'
              : 'color-mix(in srgb, var(--color-primary, #38bdf8) 40%, rgba(255, 255, 255, 0.2))',
            boxShadow: isPoweredOn
              ? '0 0 8px var(--color-primary, #38bdf8)'
              : 'none',
          }}
        />
      </motion.button>
    </div>
  );
};
