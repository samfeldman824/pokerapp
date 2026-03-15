'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Card as CardType, GamePhase } from '@/engine/types';
import { Card } from './Card';
import {
  PER_CARD_REVEAL_DURATION,
  REVEAL_SETTLE_BUFFER,
  getBoardSnapshotKey,
  detectNewIndices,
  isResetCondition,
  getRevealSchedule,
} from './communityCardReveal';

interface CommunityCardsProps {
  cards: CardType[];
  phase: GamePhase;
  handNumber: number;
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

type RevealState = 'entering' | 'settled' | 'idle';

export const CommunityCards: React.FC<CommunityCardsProps> = ({ cards, phase, handNumber }) => {
  const expectedCount = getExpectedCards(phase);
  const slots = Array.from({ length: 5 }, (_, i) => i);

  const [displayedCards, setDisplayedCards] = useState<(CardType | null)[]>([]);
  const [revealStates, setRevealStates] = useState<RevealState[]>(Array(5).fill('idle'));
  
  const prevBoardKeyRef = useRef<string | null>(null);
  const prevCardsRef = useRef<CardType[]>([]);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    if (isResetCondition(phase, cards)) {
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
      setDisplayedCards([]);
      setRevealStates(Array(5).fill('idle'));
      prevBoardKeyRef.current = null;
      prevCardsRef.current = [];
      return;
    }

    const currentKey = getBoardSnapshotKey(cards, handNumber);

    if (prevBoardKeyRef.current !== currentKey) {
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];

      if (prevBoardKeyRef.current === null && cards.length > 0) {
        setDisplayedCards([...cards]);
        setRevealStates((prev) => {
          const next = [...prev];
          for (let i = 0; i < cards.length; i++) {
            next[i] = 'settled';
          }
          return next;
        });
        prevBoardKeyRef.current = currentKey;
        prevCardsRef.current = [...cards];
        return;
      }

      const newIndices = detectNewIndices(prevCardsRef.current, cards);
      const schedule = getRevealSchedule(newIndices);

      if (schedule.length > 0) {
        schedule.forEach(({ index, delay }) => {
          const timerId = setTimeout(() => {
            setDisplayedCards((prev) => {
              const next = [...prev];
              next[index] = cards[index];
              return next;
            });
            setRevealStates((prev) => {
              const next = [...prev];
              next[index] = 'entering';
              return next;
            });

            const settleTimerId = setTimeout(() => {
              setRevealStates((prev) => {
                const next = [...prev];
                next[index] = 'settled';
                return next;
              });
            }, PER_CARD_REVEAL_DURATION + REVEAL_SETTLE_BUFFER);

            timersRef.current.push(settleTimerId);
          }, delay);

          timersRef.current.push(timerId);
        });
      }

      prevBoardKeyRef.current = currentKey;
      prevCardsRef.current = [...cards];
    }
  }, [cards, phase, handNumber]);

  useEffect(() => {
    return () => {
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
    };
  }, []);

  return (
    <div data-testid="community-cards" className="flex gap-4 items-center justify-center h-32 w-full z-10 p-5 bg-gradient-to-b from-black/50 to-black/80 rounded-[3rem] backdrop-blur-xl border border-white/10 shadow-[inset_0_2px_15px_rgba(255,255,255,0.05),0_15px_35px_rgba(0,0,0,0.6)]">
      {slots.map((i) => {
        const card = displayedCards[i];
        const isExpectedPlaceholder = !card && i < expectedCount;
        const revealState = revealStates[i];
        
        const cardState = card ? 'revealed' : (isExpectedPlaceholder ? 'expected' : 'empty');
        const settledClass = revealState === 'settled' ? 'transition-transform duration-300 hover:-translate-y-3 hover:shadow-[0_20px_25px_-5px_rgba(0,0,0,0.5)]' : '';
        const enteringClass = revealState === 'entering' ? 'animate-card-reveal' : '';

        if (card) {
          return (
            <div 
              key={i} 
              data-testid={`community-card-slot-${i}`}
              data-card-state={cardState}
              data-reveal-state={revealState}
              className={`${settledClass} ${enteringClass}`}
              style={{ animationDelay: '0ms' }}
            >
              <Card card={card} size="lg" />
            </div>
          );
        }

        if (isExpectedPlaceholder) {
          return (
            <div 
              key={i} 
              data-testid={`community-card-slot-${i}`}
              data-card-state={cardState}
              data-reveal-state={revealState}
              className="w-[4.5rem] h-24 rounded-lg border border-amber-500/40 bg-gradient-to-b from-amber-900/20 to-transparent shadow-[inset_0_0_20px_rgba(245,158,11,0.15)] relative overflow-hidden"
            >
              <div className="absolute inset-0 bg-amber-500/5 mix-blend-overlay"></div>
            </div>
          );
        }

        return (
          <div 
            key={i} 
            data-testid={`community-card-slot-${i}`}
            data-card-state={cardState}
            data-reveal-state={revealState}
            className="w-[4.5rem] h-24 rounded-lg border border-white/5 bg-gradient-to-br from-white/[0.04] to-transparent shadow-[inset_0_2px_10px_rgba(0,0,0,0.5)] relative"
          >
            <div className="absolute inset-0 bg-black/40 rounded-lg"></div>
            <div className="absolute inset-x-2 inset-y-3 border border-white/[0.03] rounded opacity-50"></div>
          </div>
        );
      })}
    </div>
  );
};
