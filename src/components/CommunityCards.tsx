import React from 'react';
import { Card as CardType, GamePhase } from '@/engine/types';
import { Card } from './Card';

interface CommunityCardsProps {
  cards: CardType[];
  phase: GamePhase;
}

const getExpectedCards = (phase: GamePhase): number => {
  switch (phase) {
    case GamePhase.Waiting:
    case GamePhase.Preflop:
      return 0;
    case GamePhase.Flop:
      return 3;
    case GamePhase.Turn:
      return 4;
    case GamePhase.River:
    case GamePhase.Showdown:
      return 5;
    default:
      return 0;
  }
};

export const CommunityCards: React.FC<CommunityCardsProps> = ({ cards, phase }) => {
  const expectedCount = getExpectedCards(phase);
  const slots = Array.from({ length: 5 }, (_, i) => i);

  return (
    <div className="flex gap-4 items-center justify-center h-28 w-full z-10 p-4 bg-black/20 rounded-[4rem] backdrop-blur-md border border-white/5 shadow-inner">
      {slots.map((i) => {
        const card = cards[i];
        const isExpectedPlaceholder = !card && i < expectedCount;
        const isEmptyPlaceholder = !card && i >= expectedCount;

        if (card) {
          return (
            <div key={i} className="animate-fade-in-up transition-transform hover:-translate-y-2">
              <Card card={card} size="lg" />
            </div>
          );
        }

        if (isExpectedPlaceholder) {
          return (
            <div key={i} className="w-16 h-24 rounded border-2 border-dashed border-gray-600 bg-gray-900/40 animate-pulse flex items-center justify-center">
              <span className="text-gray-600/50">...</span>
            </div>
          );
        }

        return (
          <div key={i} className="w-16 h-24 rounded border border-gray-700 bg-gray-900/20" />
        );
      })}
    </div>
  );
};
