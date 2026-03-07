import React from 'react';
import { Card as CardType } from '@/engine/types';
import { Card } from './Card';

interface HoleCardsProps {
  cards: CardType[] | null;
  isCurrentPlayer: boolean;
  isFolded?: boolean;
}

export const HoleCards: React.FC<HoleCardsProps> = ({ cards, isCurrentPlayer, isFolded = false }) => {
  if (!cards && !isCurrentPlayer) {
    return (
      <div className={`flex -space-x-3 ${isFolded ? 'opacity-40 grayscale' : 'opacity-100'} transition-opacity`}>
        <div className="rotate-[-5deg] transform origin-bottom-right shadow-lg">
          <Card faceDown size="md" />
        </div>
        <div className="rotate-[5deg] transform origin-bottom-left shadow-lg">
          <Card faceDown size="md" />
        </div>
      </div>
    );
  }

  if (!cards && isCurrentPlayer) {
    return (
      <div className="flex -space-x-3 opacity-50">
        <div className="w-12 h-[72px] border-2 border-dashed border-gray-600 rounded flex items-center justify-center bg-gray-800/50">
          <span className="text-gray-500 text-xs">?</span>
        </div>
        <div className="w-12 h-[72px] border-2 border-dashed border-gray-600 rounded flex items-center justify-center bg-gray-800/50">
          <span className="text-gray-500 text-xs">?</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex -space-x-3 ${isFolded ? 'opacity-40 grayscale' : 'opacity-100'} transition-all`}>
      {cards?.map((card, i) => (
        <div 
          key={i} 
          className={`transform origin-bottom shadow-lg transition-transform hover:z-10
            ${i === 0 ? 'rotate-[-5deg]' : 'rotate-[5deg]'}
          `}
        >
          <Card card={card} size="md" />
        </div>
      ))}
    </div>
  );
};
