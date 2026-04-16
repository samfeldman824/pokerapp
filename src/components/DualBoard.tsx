import { Card as CardType, GamePhase } from '@/engine/types';
import { CommunityCards } from './CommunityCards';

interface DualBoardProps {
  communityCards: CardType[];
  phase: GamePhase;
  handNumber: number;
  currentRunIndex: 0 | 1 | null;
  runoutPhase: GamePhase | null;
  firstBoard: CardType[] | null;
  secondBoard: CardType[] | null;
}

function getBoardPhases(
  phase: GamePhase,
  runoutPhase: GamePhase | null,
  currentRunIndex: 0 | 1 | null,
  firstBoard: CardType[] | null,
  secondBoard: CardType[] | null,
): { boardOnePhase: GamePhase; boardTwoPhase: GamePhase } {
  const liveRunPhase = runoutPhase ?? phase;

  if (currentRunIndex === 0) {
    return {
      boardOnePhase: liveRunPhase,
      boardTwoPhase: GamePhase.Preflop,
    };
  }

  if (currentRunIndex === 1) {
    return {
      boardOnePhase: firstBoard && firstBoard.length === 5 ? GamePhase.Showdown : GamePhase.River,
      boardTwoPhase: liveRunPhase,
    };
  }

  return {
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
  firstBoard,
  secondBoard,
}: DualBoardProps) {
  const boardOneCards = currentRunIndex === 0
    ? communityCards
    : (firstBoard ?? communityCards);

  const boardTwoCards = currentRunIndex === 1
    ? communityCards
    : (secondBoard ?? []);

  const { boardOnePhase, boardTwoPhase } = getBoardPhases(
    phase,
    runoutPhase,
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
