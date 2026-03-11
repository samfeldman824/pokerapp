import React from 'react';
import { SidePot } from '@/engine/types';

interface PotDisplayProps {
  pot: number;
  sidePots: SidePot[];
}

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-US').format(amount);
};

const ChipIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" strokeDasharray="3 4" fill="none" />
    <circle cx="12" cy="12" r="5" fill="currentColor" />
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="0.5" fill="none" opacity="0.5" />
  </svg>
);

export const PotDisplay: React.FC<PotDisplayProps> = ({ pot, sidePots }) => {
  return (
    <div className="flex flex-col items-center justify-end h-16 mb-6 space-y-2 z-10">
      <div className="bg-gradient-to-b from-amber-900/90 to-amber-950/95 border border-amber-500/50 rounded-full px-6 py-2 shadow-[0_4px_20px_rgba(245,158,11,0.3),inset_0_2px_10px_rgba(251,191,36,0.15)] backdrop-blur-md flex items-center gap-3 transition-all duration-300">
        <ChipIcon className="w-6 h-6 text-amber-400 drop-shadow-[0_0_8px_rgba(251,191,36,0.6)]" />
        <span className="text-amber-50 font-bold tracking-widest font-mono text-xl drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]">
          <span className="text-amber-500/80 mr-1 text-lg">$</span>
          {formatCurrency(pot)}
        </span>
      </div>
      
      {sidePots.length > 0 && (
        <div className="flex flex-wrap gap-3 justify-center">
          {sidePots.map((sidePot, idx) => (
            <div 
              key={idx} 
              className="bg-gradient-to-b from-stone-800/80 to-stone-900/90 border border-amber-700/40 rounded-full px-4 py-1 shadow-[0_2px_10px_rgba(0,0,0,0.4),inset_0_1px_5px_rgba(251,191,36,0.1)] backdrop-blur flex items-center gap-2 transition-all"
            >
              <ChipIcon className="w-4 h-4 text-amber-500/80" />
              <span className="text-amber-100/90 font-mono text-xs tracking-wider">
                Side {idx + 1}: <span className="text-amber-500/60 ml-0.5">$</span>{formatCurrency(sidePot.amount)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
