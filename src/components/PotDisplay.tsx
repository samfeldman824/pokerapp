import React from 'react';
import { SidePot } from '@/engine/types';

interface PotDisplayProps {
  pot: number;
  sidePots: SidePot[];
}

export const PotDisplay: React.FC<PotDisplayProps> = ({ pot, sidePots }) => {
  return (
    <div className="flex flex-col items-center justify-end h-16 mb-4 space-y-1 z-10">
      <div className="bg-amber-950/80 border border-amber-500/50 rounded-full px-5 py-1.5 shadow-[0_0_15px_rgba(245,158,11,0.3)] backdrop-blur-sm flex items-center gap-2">
        <span className="text-amber-400 text-xl">🪙</span>
        <span className="text-amber-100 font-bold tracking-wider font-mono text-lg">
          Pot: {pot}
        </span>
      </div>
      
      {sidePots.length > 0 && (
        <div className="flex flex-wrap gap-2 justify-center">
          {sidePots.map((sidePot, idx) => (
            <div 
              key={idx} 
              className="bg-amber-950/60 border border-amber-600/30 rounded-full px-3 py-0.5 shadow-sm backdrop-blur flex items-center gap-1"
            >
              <span className="text-amber-500 text-xs">🪙</span>
              <span className="text-amber-200/80 font-mono text-xs">
                Side {idx + 1}: {sidePot.amount}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
