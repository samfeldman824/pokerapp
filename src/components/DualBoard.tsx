import { Card as CardType, GamePhase } from '@/engine/types';
import { CommunityCards } from './CommunityCards';

interface DualBoardProps {
  communityCards: CardType[];
  phase: GamePhase;
  handNumber: number;
  currentRunIndex: 0 | 1 | null;
  runoutPhase: GamePhase | null;
  runoutStartPhase: GamePhase | null;
  firstBoard: CardType[] | null;
  secondBoard: CardType[] | null;
}

function getSharedPrefixCards(cards: CardType[], runoutStartPhase: GamePhase | null): CardType[] {
  if (runoutStartPhase === GamePhase.Flop) {
    return cards.slice(0, 3);
  }

  if (runoutStartPhase === GamePhase.Turn) {
    return cards.slice(0, 4);
  }

  return [];
}

export function getDualBoardDisplayState(
  communityCards: CardType[],
  phase: GamePhase,
  runoutPhase: GamePhase | null,
  runoutStartPhase: GamePhase | null,
  currentRunIndex: 0 | 1 | null,
  firstBoard: CardType[] | null,
  secondBoard: CardType[] | null,
): {
  boardOneCards: CardType[];
  boardTwoCards: CardType[];
  boardOnePhase: GamePhase;
  boardTwoPhase: GamePhase;
} {
  const liveRunPhase = runoutPhase ?? phase;
  const sharedPrefixCards = getSharedPrefixCards(communityCards, runoutStartPhase);

  if (currentRunIndex === 0) {
    return {
      boardOneCards: communityCards,
      boardTwoCards: secondBoard ?? sharedPrefixCards,
      boardOnePhase: liveRunPhase,
      boardTwoPhase: runoutStartPhase ?? liveRunPhase,
    };
  }

  if (currentRunIndex === 1) {
    return {
      boardOneCards: firstBoard ?? communityCards,
      boardTwoCards: secondBoard ?? communityCards,
      boardOnePhase: firstBoard && firstBoard.length === 5 ? GamePhase.Showdown : GamePhase.River,
      boardTwoPhase: liveRunPhase,
    };
  }

  return {
    boardOneCards: firstBoard ?? communityCards,
    boardTwoCards: secondBoard ?? [],
    boardOnePhase: firstBoard && firstBoard.length === 5 ? GamePhase.Showdown : phase,
    boardTwoPhase: secondBoard && secondBoard.length === 5 ? GamePhase.Showdown : GamePhase.Preflop,
  };
}

export function DualBoard({
  communityCards,
  phase,
  handNumber,
  currentRunIndex,
  runoutPhase,
  runoutStartPhase,
  firstBoard,
  secondBoard,
}: DualBoardProps) {
  const { boardOneCards, boardTwoCards, boardOnePhase, boardTwoPhase } = getDualBoardDisplayState(
    communityCards,
    phase,
    runoutPhase,
    runoutStartPhase,
    currentRunIndex,
    firstBoard,
    secondBoard,
  );

  return (
    <div className="flex w-full max-w-4xl flex-col gap-3">
      <div className="space-y-1">
        <p className="text-center text-xs font-semibold uppercase tracking-[0.24em] text-amber-300/80">Run 1</p>
        <CommunityCards cards={boardOneCards} phase={boardOnePhase} handNumber={handNumber} />
      </div>
      <div className="space-y-1">
        <p className="text-center text-xs font-semibold uppercase tracking-[0.24em] text-sky-300/80">Run 2</p>
        <CommunityCards cards={boardTwoCards} phase={boardTwoPhase} handNumber={handNumber} />
      </div>
    </div>
  );
}
