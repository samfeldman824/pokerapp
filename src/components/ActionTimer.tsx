import React, { useEffect, useState } from 'react';

export interface ActionTimerProps {
  timePerAction: number;
  timerStart: number | null;
  onTimeout?: () => void;
}

export const ActionTimer: React.FC<ActionTimerProps> = ({ timePerAction, timerStart, onTimeout }) => {
  const [timeLeft, setTimeLeft] = useState(timePerAction);

  useEffect(() => {
    if (timePerAction === 0 || timerStart === null) return;

    const interval = setInterval(() => {
      const now = Date.now();
      const elapsed = (now - timerStart) / 1000;
      const remaining = Math.max(0, timePerAction - elapsed);
      setTimeLeft(remaining);

      if (remaining === 0) {
        clearInterval(interval);
        if (onTimeout) {
          onTimeout();
        }
      }
    }, 100);

    return () => clearInterval(interval);
  }, [timePerAction, timerStart, onTimeout]);

  if (timePerAction === 0 || timerStart === null) return null;

  const percentage = Math.max(0, Math.min(100, (timeLeft / timePerAction) * 100));
  
  let colorClass = 'bg-emerald-500';
  if (percentage <= 25) {
    colorClass = 'bg-red-500';
  } else if (percentage <= 50) {
    colorClass = 'bg-amber-400';
  }

  return (
    <div className="flex flex-col gap-1.5 w-full min-w-[120px] max-w-[200px]">
      <div className="flex justify-between items-center text-xs font-mono tracking-widest uppercase">
        <span className="text-white/50 font-semibold">Time</span>
        <span className={`font-bold ${percentage <= 25 ? 'text-red-400 animate-pulse' : 'text-white/90'}`}>
          {Math.ceil(timeLeft)}s
        </span>
      </div>
      <div className="h-2 w-full bg-white/5 rounded-full overflow-hidden shadow-inner ring-1 ring-white/10">
        <div 
          className={`h-full transition-all duration-100 ease-linear rounded-full ${colorClass} shadow-[0_0_10px_rgba(255,255,255,0.2)]`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
};
