import { ClientGameState, PlayerAction } from '@/engine/types';
import { PotDisplay } from './PotDisplay';
import { CommunityCards } from './CommunityCards';
import { DualBoard } from './DualBoard';
import { PlayerSeat } from './PlayerSeat';
import { ActionBar } from '@/components/ActionBar';
import type { HandResultEvent } from '@/lib/useGameSocket';

interface PokerTableProps {
  gameState: ClientGameState;
  playerId: string;
  onAction: (action: PlayerAction) => void;
  actionConfirmation: {
    message: string;
    pending: boolean;
  } | null;
  lastHandResult?: HandResultEvent | null;
  runItTwicePotAwards?: HandResultEvent['results'][number]['potAwards'];
}

export function PokerTable({ gameState, playerId, onAction, actionConfirmation, lastHandResult, runItTwicePotAwards = [] }: PokerTableProps) {
  const currentPlayerSeatIndex = gameState.players.findIndex(p => p?.id === playerId);
  const isPlaying = currentPlayerSeatIndex >= 0;
  
  const getSeatPosition = (seatIndex: number) => {
    let offset = seatIndex;
    if (isPlaying) {
      const maxSeats = gameState.config.maxPlayers;
      offset = (seatIndex - currentPlayerSeatIndex + maxSeats) % maxSeats;
    }

    // All positions use percentages within the table bounds — no negative px offsets.
    // Bottom row sits above the action bar, top row below the header.
    const positions9 = [
      { bottom: '6%', left: '50%', transform: 'translateX(-50%)' },
      { bottom: '14%', left: '18%', transform: 'translateX(-50%)' },
      { top: '38%', left: '3%', transform: 'translateY(-50%)' },
      { top: '14%', left: '12%', transform: 'translateY(-50%)' },
      { top: '2%', left: '35%', transform: 'translateX(-50%)' },
      { top: '2%', left: '65%', transform: 'translateX(-50%)' },
      { top: '14%', right: '12%', transform: 'translateY(-50%)' },
      { top: '38%', right: '3%', transform: 'translateY(-50%)' },
      { bottom: '14%', right: '18%', transform: 'translateX(-50%)' },
    ];

    return positions9[offset];
  };

  const showActionBar = isPlaying && !gameState.isPaused;

  const seatedPlayers = gameState.players.filter(Boolean);
  const maxSeats = gameState.config.maxPlayers;
  const dealerSeat = gameState.dealerIndex;
  const occupiedSeatSet = new Set(seatedPlayers.map(p => p!.seatIndex));
  
  function getNextOccupiedSeat(from: number): number {
    for (let offset = 1; offset <= maxSeats; offset++) {
      const seat = (from + offset) % maxSeats;
      if (occupiedSeatSet.has(seat)) return seat;
    }
    return -1;
  }
  const sbSeat = seatedPlayers.length >= 2 ? getNextOccupiedSeat(dealerSeat) : -1;
  const bbSeat = sbSeat !== -1 ? getNextOccupiedSeat(sbSeat) : -1;

  // Animate pot when someone wins
  const hasWonPot = lastHandResult && lastHandResult.results.some(r => r.winnings > 0);

  const hasRunItTwice = gameState.runItTwiceEligible;
  const runOneAwards = runItTwicePotAwards.filter((award) => award.runIndex === 0);
  const runTwoAwards = runItTwicePotAwards.filter((award) => award.runIndex === 1);

  return (
    <div className="w-full h-full flex items-center justify-center bg-gray-950 font-sans overflow-hidden p-4 pb-24">
      <div className="relative w-full max-w-7xl aspect-[1.8/1] bg-green-800 rounded-[200px] border-[16px] border-slate-800 shadow-[inset_0_0_80px_rgba(0,0,0,0.8),0_20px_40px_rgba(0,0,0,0.5)] flex items-center justify-center overflow-hidden">
        <div className="absolute inset-4 rounded-[180px] border border-green-600/30 pointer-events-none" />

        <div className="flex flex-col items-center justify-center space-y-4 z-10">
          <div key={`pot-${lastHandResult?.handNumber}`} className={hasWonPot ? "animate-pot-win" : ""}>
            <PotDisplay pot={gameState.pot} sidePots={gameState.sidePots} />
          </div>
          {hasRunItTwice ? (
            <>
              <DualBoard
                communityCards={gameState.communityCards}
                phase={gameState.phase}
                handNumber={gameState.handNumber}
                currentRunIndex={gameState.currentRunIndex}
                runoutPhase={gameState.runoutPhase}
                runoutStartPhase={gameState.runoutStartPhase}
                firstBoard={gameState.firstBoard}
                secondBoard={gameState.secondBoard}
              />
              {(runOneAwards.length > 0 || runTwoAwards.length > 0) && (
                <div className="w-full max-w-4xl rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-xs text-gray-300">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="uppercase tracking-[0.2em] text-amber-300">Run 1 Awards</p>
                      <p className="mt-1">
                        {runOneAwards.length === 0
                          ? 'Pending'
                          : runOneAwards.map((award) => `Pot ${award.potIndex + 1}: ${award.amount}`).join(' · ')}
                      </p>
                    </div>
                    <div>
                      <p className="uppercase tracking-[0.2em] text-sky-300">Run 2 Awards</p>
                      <p className="mt-1">
                        {runTwoAwards.length === 0
                          ? 'Pending'
                          : runTwoAwards.map((award) => `Pot ${award.potIndex + 1}: ${award.amount}`).join(' · ')}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            <CommunityCards cards={gameState.communityCards} phase={gameState.phase} handNumber={gameState.handNumber} />
          )}
        </div>

        {Array.from({ length: maxSeats }).map((_, i) => {
          const player = gameState.players[i] || null;
          const pos = getSeatPosition(i);
          const seatOffset = isPlaying
            ? (i - currentPlayerSeatIndex + maxSeats) % maxSeats
            : i;
          const badgeAbove = seatOffset === 0 || seatOffset === 1 || seatOffset === maxSeats - 1;

          const isWinner = Boolean(player && lastHandResult && lastHandResult.results.some(r => r.playerId === player.id && r.winnings > 0));

          return (
            <div
              key={i}
              className={`absolute z-20 ${isWinner ? "animate-pot-win" : ""}`}
              style={pos}
            >
              <PlayerSeat
                player={player}
                seatIndex={i}
                communityCards={gameState.communityCards}
                isCurrentPlayer={player?.id === playerId}
                isActive={gameState.activePlayerIndex === i}
                isDealer={gameState.dealerIndex === i}
                isSmallBlind={i === sbSeat}
                isBigBlind={i === bbSeat}
                badgeAbove={badgeAbove}
                isWinner={isWinner}
                winHandNumber={lastHandResult?.handNumber}
              />
            </div>
          );
        })}
      </div>

      {showActionBar && (
        <div className="absolute bottom-8 w-full max-w-3xl z-50">
          <ActionBar
            gameState={gameState}
            playerId={playerId}
            onAction={onAction}
            isActing={actionConfirmation?.pending ?? false}
            confirmationMessage={actionConfirmation?.message ?? null}
          />
        </div>
      )}

    </div>
  );
}

export default PokerTable
