import { ClientGameState, PlayerAction } from '@/engine/types';
import { PotDisplay } from './PotDisplay';
import { CommunityCards } from './CommunityCards';
import { PlayerSeat } from './PlayerSeat';
import { ActionBar } from '@/components/ActionBar';

interface PokerTableProps {
  gameState: ClientGameState;
  playerId: string;
  onAction: (action: PlayerAction) => void;
}

export function PokerTable({ gameState, playerId, onAction }: PokerTableProps) {
  const currentPlayerSeatIndex = gameState.players.findIndex(p => p?.id === playerId);
  const isPlaying = currentPlayerSeatIndex >= 0;
  
  const getSeatPosition = (seatIndex: number) => {
    let offset = seatIndex;
    if (isPlaying) {
      offset = (seatIndex - currentPlayerSeatIndex + 9) % 9;
    }
    
    const positions9 = [
      { bottom: '-40px', left: '50%', transform: 'translateX(-50%)' },
      { bottom: '5%', left: '20%', transform: 'translateX(-50%)' },
      { top: '60%', left: '-20px', transform: 'translateY(-50%)' },
      { top: '20%', left: '10%', transform: 'translateY(-50%)' },
      { top: '-40px', left: '35%', transform: 'translateX(-50%)' },
      { top: '-40px', left: '65%', transform: 'translateX(-50%)' },
      { top: '20%', right: '10%', transform: 'translateY(-50%)' },
      { top: '60%', right: '-20px', transform: 'translateY(-50%)' },
      { bottom: '5%', right: '20%', transform: 'translateX(-50%)' },
    ];

    return positions9[offset];
  };

  const isTurn = gameState.activePlayerIndex === currentPlayerSeatIndex;

  return (
    <div className="w-full h-full min-h-[600px] flex items-center justify-center bg-gray-950 p-8 font-sans">
      <div className="relative w-full max-w-6xl aspect-[2.2/1] bg-green-800 rounded-[200px] border-[16px] border-slate-800 shadow-[inset_0_0_80px_rgba(0,0,0,0.8),0_20px_40px_rgba(0,0,0,0.5)] flex items-center justify-center">
        <div className="absolute inset-4 rounded-[180px] border border-green-600/30 pointer-events-none" />
        
        <div className="flex flex-col items-center justify-center space-y-4">
          <PotDisplay pot={gameState.pot} sidePots={gameState.sidePots} />
          <CommunityCards cards={gameState.communityCards} phase={gameState.phase} />
        </div>

        {Array.from({ length: 9 }).map((_, i) => {
          const player = gameState.players[i] || null;
          const pos = getSeatPosition(i);
          
          return (
            <div 
              key={i} 
              className="absolute z-20"
              style={pos}
            >
              <PlayerSeat
                player={player}
                seatIndex={i}
                isCurrentPlayer={player?.id === playerId}
                isActive={gameState.activePlayerIndex === i}
                isDealer={gameState.dealerIndex === i}
                config={gameState.config}
              />
            </div>
          );
        })}
      </div>

      {isTurn && (
        <div className="absolute bottom-8 w-full max-w-3xl z-50">
          <ActionBar gameState={gameState} playerId={playerId} onAction={onAction} />
        </div>
      )}
    </div>
  );
}

export default PokerTable
