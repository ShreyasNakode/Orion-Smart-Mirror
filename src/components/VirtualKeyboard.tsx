import React, { useState } from 'react';
import { Delete, CornerDownLeft, Space, ArrowUp, X, Hash } from 'lucide-react';
import { motion } from 'motion/react';

interface VirtualKeyboardProps {
  onKeyPress: (key: string, isSpecial?: boolean) => void;
  onClose: () => void;
}

export function VirtualKeyboard({ onKeyPress, onClose }: VirtualKeyboardProps) {
  const [layout, setLayout] = useState<'alpha' | 'numeric' | 'symbol'>('alpha');
  const [isShift, setIsShift] = useState(false);

  const alphaRows = [
    ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
    ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
    ['z', 'x', 'c', 'v', 'b', 'n', 'm']
  ];

  const numRows = [
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
    ['-', '/', ':', ';', '(', ')', '$', '&', '@', '"'],
    ['.', ',', '?', '!', "'", '#', '%', '*']
  ];

  const symbolRows = [
    ['[', ']', '{', '}', '#', '%', '^', '*', '+', '='],
    ['_', '\\', '|', '~', '<', '>', '€', '£', '¥', '•'],
    ['.', ',', '?', '!', "'", '-', '/', ':']
  ];

  const currentRows = layout === 'alpha' ? alphaRows : layout === 'numeric' ? numRows : symbolRows;

  const handleKeyClick = (char: string) => {
    const output = (layout === 'alpha' && isShift) ? char.toUpperCase() : char;
    onKeyPress(output, false);
  };

  return (
    <motion.div
      initial={{ y: 50, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 50, opacity: 0 }}
      className="bg-surface-container-high/95 border-t border-primary/30 p-3 flex flex-col gap-2 select-none shadow-[0_-8px_30px_rgba(0,0,0,0.8)] backdrop-blur-xl"
    >
      {/* Header Bar */}
      <div className="flex items-center justify-between px-1 pb-1 border-b border-outline-variant/20 text-xs">
        <span className="text-primary font-medium text-[11px]">On-Screen Touch Keyboard</span>
        <button
          onClick={onClose}
          className="p-1 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-variant/40 transition-colors"
        >
          <X size={14} />
        </button>
      </div>

      {/* Keys Layout */}
      <div className="flex flex-col gap-1.5">
        {currentRows.map((row, rowIndex) => (
          <div key={rowIndex} className="flex justify-center gap-1.5">
            {rowIndex === 2 && layout === 'alpha' && (
              <button
                onClick={() => setIsShift(!isShift)}
                className={`flex-1 max-w-[50px] py-2.5 rounded-lg flex items-center justify-center text-xs font-semibold transition-all ${
                  isShift ? 'bg-primary text-on-primary shadow-md' : 'bg-surface-variant/70 text-on-surface hover:bg-surface-variant'
                }`}
              >
                <ArrowUp size={15} />
              </button>
            )}

            {row.map((char) => (
              <button
                key={char}
                onClick={() => handleKeyClick(char)}
                className="flex-1 py-2.5 rounded-lg bg-surface-variant/60 hover:bg-primary/20 active:bg-primary/40 text-on-surface text-sm font-medium transition-all shadow-sm active:scale-95 text-center min-w-[28px]"
              >
                {layout === 'alpha' && isShift ? char.toUpperCase() : char}
              </button>
            ))}

            {rowIndex === 2 && (
              <button
                onClick={() => onKeyPress('Backspace', true)}
                className="flex-1 max-w-[50px] py-2.5 rounded-lg bg-error/20 text-error hover:bg-error/30 active:bg-error/40 flex items-center justify-center transition-all shadow-sm active:scale-95"
              >
                <Delete size={15} />
              </button>
            )}
          </div>
        ))}

        {/* Bottom Control Row */}
        <div className="flex justify-center gap-1.5 mt-0.5">
          <button
            onClick={() => setLayout(layout === 'alpha' ? 'numeric' : 'alpha')}
            className="px-3 py-2.5 rounded-lg bg-surface-variant/80 hover:bg-surface-variant text-primary text-xs font-semibold min-w-[54px] transition-colors"
          >
            {layout === 'alpha' ? '?123' : 'ABC'}
          </button>

          {layout !== 'alpha' && (
            <button
              onClick={() => setLayout(layout === 'numeric' ? 'symbol' : 'numeric')}
              className="px-2.5 py-2.5 rounded-lg bg-surface-variant/80 hover:bg-surface-variant text-on-surface-variant text-xs font-medium min-w-[48px] transition-colors flex items-center justify-center gap-1"
            >
              <Hash size={13} />
              {layout === 'numeric' ? '#+=' : '123'}
            </button>
          )}

          <button
            onClick={() => handleKeyClick(' ')}
            className="flex-1 py-2.5 rounded-lg bg-surface-variant/60 hover:bg-primary/20 active:bg-primary/40 text-on-surface text-xs font-medium flex items-center justify-center gap-1 transition-all"
          >
            <Space size={14} />
            <span>Space</span>
          </button>

          <button
            onClick={() => handleKeyClick('.')}
            className="px-3.5 py-2.5 rounded-lg bg-surface-variant/60 hover:bg-surface-variant text-on-surface text-sm font-semibold transition-all"
          >
            .
          </button>

          <button
            onClick={() => onKeyPress('Enter', true)}
            className="px-4 py-2.5 rounded-lg bg-primary text-on-primary hover:bg-primary/90 active:bg-primary/80 text-xs font-bold flex items-center justify-center gap-1 transition-all shadow-md active:scale-95 min-w-[60px]"
          >
            <CornerDownLeft size={14} />
            <span>Enter</span>
          </button>
        </div>
      </div>
    </motion.div>
  );
}
