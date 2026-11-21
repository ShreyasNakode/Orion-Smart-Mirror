import { ReactNode } from 'react';
import { cn } from '../lib/utils';
import { motion, HTMLMotionProps } from 'motion/react';

interface GlassCardProps extends HTMLMotionProps<"div"> {
  children: ReactNode;
  variant?: 'default' | 'light' | 'interactive';
  className?: string;
}

export function GlassCard({ children, variant = 'default', className, ...props }: GlassCardProps) {
  const baseClasses = "rounded-2xl overflow-hidden transition-all duration-300";
  
  const variants = {
    default: "glass-panel ice-border text-white font-medium",
    light: "glass-panel-light text-white font-medium",
    interactive: "glass-panel ice-border hover:bg-white/10 hover:border-white/40 active:scale-[0.98] cursor-pointer text-white font-medium",
  };

  return (
    <motion.div 
      className={cn(baseClasses, variants[variant], className)}
      {...props}
    >
      <div className="absolute inset-0 bg-gradient-to-br from-white/[0.04] to-transparent pointer-events-none" />
      <div className="relative z-10 w-full h-full">
        {children}
      </div>
    </motion.div>
  );
}

