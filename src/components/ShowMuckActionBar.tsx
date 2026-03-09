import React from 'react';

interface ShowMuckActionBarProps {
  onShow: () => void;
  onMuck: () => void;
}

export const ShowMuckActionBar: React.FC<ShowMuckActionBarProps> = ({ onShow, onMuck }) => {
  return (
    <div className="flex gap-4 justify-center items-center w-full bg-neutral-900/80 p-4 rounded-xl border border-neutral-700/50 shadow-2xl backdrop-blur-sm animate-in slide-in-from-bottom-4 fade-in duration-200">
      <div className="text-emerald-400 font-bold text-sm tracking-widest uppercase mr-4">
        You Won
      </div>
      <button
        onClick={onShow}
        className="px-8 py-3 rounded-lg font-bold text-sm tracking-widest uppercase transition-all bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 border border-emerald-500/30"
      >
        Show Cards
      </button>
      <button
        onClick={onMuck}
        className="px-8 py-3 rounded-lg font-bold text-sm tracking-widest uppercase transition-all bg-neutral-800 text-neutral-300 hover:bg-neutral-700 hover:text-white border border-neutral-700"
      >
        Muck
      </button>
    </div>
  );
};
