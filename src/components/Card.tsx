import React from 'react';
import { Card as CardType, Suit, Rank } from '@/engine/types';

interface CardProps {
  card?: CardType | null;
  faceDown?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

const suitSymbols: Record<Suit, string> = {
  [Suit.Spades]: '♠',
  [Suit.Hearts]: '♥',
  [Suit.Diamonds]: '♦',
  [Suit.Clubs]: '♣',
};

const suitColors: Record<Suit, string> = {
  [Suit.Spades]: 'text-gray-900',
  [Suit.Hearts]: 'text-red-600',
  [Suit.Diamonds]: 'text-red-600',
  [Suit.Clubs]: 'text-gray-900',
};

const sizeClasses = {
  sm: 'w-8 h-12 text-xs',
  md: 'w-12 h-[72px] text-sm',
  lg: 'w-16 h-24 text-base',
};

export const Card: React.FC<CardProps> = ({ card, faceDown = false, size = 'md' }) => {
  const sizeClass = sizeClasses[size];

  if (faceDown || !card) {
    return (
      <div 
        className={`${sizeClass} rounded flex items-center justify-center 
          bg-gradient-to-br from-indigo-900 via-purple-900 to-slate-900 
          border border-slate-700 shadow-md 
          transition-transform duration-200 hover:-translate-y-1 
          relative overflow-hidden`}
      >
        <div className="absolute inset-1 rounded-sm border border-indigo-500/30 opacity-50 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-indigo-500/20 to-transparent" />
        <div className="w-full h-full opacity-20 bg-[repeating-linear-gradient(45deg,transparent,transparent_2px,white_2px,white_4px)]"></div>
      </div>
    );
  }

  const colorClass = suitColors[card.suit];
  const symbol = suitSymbols[card.suit];

  return (
    <div 
      className={`${sizeClass} rounded flex flex-col justify-between p-1
        bg-white border border-gray-300 shadow-md 
        transition-transform duration-200 hover:-translate-y-1 
        ${colorClass} font-bold select-none`}
    >
      <div className="flex flex-col items-center leading-none">
        <span>{card.rank}</span>
        <span className="text-[0.8em]">{symbol}</span>
      </div>
      <div className="text-center self-center scale-150">
        {symbol}
      </div>
    </div>
  );
};
