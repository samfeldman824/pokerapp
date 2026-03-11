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
    <div className="flex gap-4 items-center justify-center h-32 w-full z-10 p-5 bg-gradient-to-b from-black/50 to-black/80 rounded-[3rem] backdrop-blur-xl border border-white/10 shadow-[inset_0_2px_15px_rgba(255,255,255,0.05),0_15px_35px_rgba(0,0,0,0.6)]">
      {slots.map((i) => {
        const card = cards[i];
        const isExpectedPlaceholder = !card && i < expectedCount;

        if (card) {
          return (
            <div key={i} className="transition-transform duration-300 hover:-translate-y-3 hover:shadow-[0_20px_25px_-5px_rgba(0,0,0,0.5)]">
              <Card card={card} size="lg" />
            </div>
          );
        }

        if (isExpectedPlaceholder) {
          return (
            <div key={i} className="w-[4.5rem] h-24 rounded-lg border border-amber-500/40 bg-gradient-to-b from-amber-900/20 to-transparent shadow-[inset_0_0_20px_rgba(245,158,11,0.15)] animate-pulse relative overflow-hidden">
              <div className="absolute inset-0 bg-amber-500/5 mix-blend-overlay"></div>
            </div>
          );
        }

        return (
          <div key={i} className="w-[4.5rem] h-24 rounded-lg border border-white/5 bg-gradient-to-br from-white/[0.04] to-transparent shadow-[inset_0_2px_10px_rgba(0,0,0,0.5)] relative">
            <div className="absolute inset-0 bg-black/40 rounded-lg"></div>
            <div className="absolute inset-x-2 inset-y-3 border border-white/[0.03] rounded opacity-50"></div>
          </div>
        );
      })}
    </div>
  );
};
