import React, { useEffect, useMemo, useState } from 'react';
import { ClientPlayerState, ActionType, Card } from '@/engine/types';
import { evaluateHand } from '@/engine/handEvaluator';
import { HoleCards } from './HoleCards';

const AVATAR_SIZE = 80;
const SEAT_OFFSETS = {
  badge: AVATAR_SIZE + 8,       // 88px — avatar + gap
  holeCards: AVATAR_SIZE,       // 80px — flush with avatar bottom
  handStrength: AVATAR_SIZE + 46, // 126px — avatar + badge height
  bet: AVATAR_SIZE + 55,        // 135px — avatar + badge + gap
} as const;

interface PlayerSeatProps {
  player: ClientPlayerState | null;
  seatIndex: number;
  communityCards: Card[];
  isCurrentPlayer: boolean;
  isActive: boolean;
  isDealer: boolean;
  isSmallBlind?: boolean;
  isBigBlind?: boolean;
  badgeAbove?: boolean;
  isWinner?: boolean;
  winHandNumber?: number;
}

export const PlayerSeat: React.FC<PlayerSeatProps> = ({ 
  player, 
  seatIndex, 
  communityCards,
  isCurrentPlayer, 
  isActive, 
  isDealer, 
  isSmallBlind,
  isBigBlind,
  badgeAbove = false,
  isWinner = false,
  winHandNumber,
}) => {
  const [showAction, setShowAction] = useState(false);
  const handStrength = useMemo(() => {
    if (!player || !isCurrentPlayer || player.isFolded || !player.holeCards || communityCards.length < 3) {
      return null;
    }

    return evaluateHand(player.holeCards as [Card, Card], communityCards).description;
  }, [communityCards, isCurrentPlayer, player]);

  useEffect(() => {
    if (player?.lastAction) {
      setShowAction(true);
      const timer = setTimeout(() => setShowAction(false), 3500);
      return () => clearTimeout(timer);
    } else {
      setShowAction(false);
    }
  }, [player?.lastAction?.timestamp]);

  if (!player) {
    return (
      <div className="w-24 h-24 rounded-full border-2 border-dashed border-gray-600/50 flex flex-col items-center justify-center bg-gray-900/40 hover:bg-gray-800/60 transition-colors cursor-pointer text-gray-400 group relative shadow-inner backdrop-blur-sm">
        <span className="text-2xl font-light mb-1 group-hover:text-amber-500 transition-colors">+</span>
        <span className="text-xs uppercase tracking-widest font-semibold group-hover:text-amber-500 transition-colors">Seat {seatIndex}</span>
      </div>
    );
  }

  const getInitials = (name: string) => name.substring(0, 2).toUpperCase();
  const displayName = player.displayName.substring(0, 12) + (player.displayName.length > 12 ? '...' : '');

  const seatClasses = [
    'relative flex flex-col items-center',
    !player.isConnected
      ? 'opacity-40 brightness-75 grayscale'
      : player.isFolded
        ? 'opacity-50 grayscale hover:grayscale-0 transition-all'
        : '',
  ].join(' ');

  const seatStyle = {
    '--seat-badge': `${SEAT_OFFSETS.badge}px`,
    '--seat-holes': `${SEAT_OFFSETS.holeCards}px`,
    '--seat-hand': `${SEAT_OFFSETS.handStrength}px`,
    '--seat-bet': `${SEAT_OFFSETS.bet}px`,
  } as React.CSSProperties;

  const badgePositionClass = badgeAbove
    ? 'bottom-[var(--seat-badge)]'
    : 'top-[var(--seat-badge)]';

  let actionText = '';
  let actionColor = 'bg-gray-900/70 border-gray-500';
  
  if (player.lastAction) {
    const { type, amount } = player.lastAction;
    if (player.isAllIn && type !== ActionType.Fold && type !== ActionType.Check) {
      actionText = `All-in $${amount}`;
      actionColor = 'bg-red-900/80 border-red-700/50 text-red-100';
    } else {
      switch (type) {
        case ActionType.Fold:
          actionText = 'Folded';
          actionColor = 'bg-red-900/80 border-red-700/50 text-red-100';
          break;
        case ActionType.Check:
          actionText = 'Checked';
          actionColor = 'bg-amber-900/80 border-amber-700/50 text-amber-100';
          break;
        case ActionType.Call:
          actionText = `Called $${amount}`;
          actionColor = 'bg-green-900/80 border-green-700/50 text-green-100';
          break;
        case ActionType.Bet:
          actionText = `Bet $${amount}`;
          actionColor = 'bg-green-900/80 border-green-700/50 text-green-100';
          break;
        case ActionType.Raise:
          actionText = `Raised to $${amount}`;
          actionColor = 'bg-green-900/80 border-green-700/50 text-green-100';
          break;
      }
    }
  }

  return (
    <div className={seatClasses} style={seatStyle}>
      {isActive && (
        <div className="absolute -inset-3 rounded-full border-[3px] border-amber-400/80 animate-pulse shadow-[0_0_20px_rgba(251,191,36,0.6)] z-0" />
      )}
      
      {isWinner && (
        <div key={`win-glow-${winHandNumber}`} className="absolute -inset-4 rounded-full border-4 border-amber-400 animate-pot-win z-0 pointer-events-none" />
      )}

      {isDealer && (
        <div className="absolute -right-3 top-0 w-6 h-6 rounded-full bg-white border-2 border-gray-900 shadow-md text-gray-900 font-bold text-xs flex items-center justify-center z-20">
          D
        </div>
      )}
      {isSmallBlind && (
        <div className="absolute -left-3 top-0 w-6 h-6 rounded-full bg-blue-500 border-2 border-gray-900 shadow-md text-white font-bold text-xs flex items-center justify-center z-20">
          S
        </div>
      )}
      {isBigBlind && (
        <div className="absolute -left-3 top-0 w-6 h-6 rounded-full bg-purple-500 border-2 border-gray-900 shadow-md text-white font-bold text-xs flex items-center justify-center z-20">
          B
        </div>
      )}

      <div className={`w-20 h-20 rounded-full border-[3px] flex items-center justify-center z-10 shadow-lg relative bg-gradient-to-b from-slate-700 to-slate-900
        ${isActive ? 'border-amber-400' : 'border-slate-600'}
        ${isCurrentPlayer ? 'ring-2 ring-indigo-500 ring-offset-2 ring-offset-slate-900' : ''}
      `}>
        <span className="text-2xl font-bold text-white tracking-widest">{getInitials(player.displayName)}</span>
        
        {player.isAllIn && (
          <div className="absolute -bottom-2 bg-red-600 text-white text-[10px] uppercase font-bold px-2 py-0.5 rounded shadow-sm border border-red-800 tracking-wider z-20">
            All-In
          </div>
        )}
        {!player.isConnected && (
          <div className="absolute -top-2 bg-gray-600/80 text-gray-200 text-[10px] uppercase font-bold px-2 py-0.5 rounded shadow-sm z-20 backdrop-blur border border-gray-500">
            Offline
          </div>
        )}

        <div className={`absolute transition-all duration-300 ${showAction ? 'opacity-100 scale-100' : 'opacity-0 scale-95 pointer-events-none'} -right-4 translate-x-full top-1/2 -translate-y-1/2 ${actionColor} text-[10px] uppercase font-bold px-2 py-0.5 rounded shadow-sm border backdrop-blur z-30 whitespace-nowrap`}>
          {actionText}
        </div>

      </div>

      <div className={`absolute ${badgePositionClass} left-1/2 -translate-x-1/2 bg-slate-900/90 border border-slate-700/50 rounded-xl px-4 py-1.5 flex flex-col items-center shadow-md backdrop-blur-sm z-30 min-w-[100px] whitespace-nowrap`}>
        <span className={`text-sm font-semibold truncate max-w-full ${isCurrentPlayer ? 'text-amber-400' : 'text-slate-200'}`}>
          {displayName}
        </span>
        <span className="text-emerald-400 font-mono text-xs mt-0.5 font-medium">
          ${player.chips}
        </span>
      </div>

      <div className="absolute top-[var(--seat-holes)] -right-[15px] z-20 scale-75 origin-top-left">
        <HoleCards cards={player.holeCards} isCurrentPlayer={isCurrentPlayer} isFolded={player.isFolded} />
      </div>

      {handStrength && (
        <div className="absolute top-[var(--seat-hand)] left-1/2 -translate-x-1/2 rounded-full border border-indigo-500/30 bg-indigo-950/70 px-3 py-1 text-[10px] font-semibold tracking-wide text-indigo-100 shadow-sm backdrop-blur-md z-20 whitespace-nowrap">
          {handStrength}
        </div>
      )}

      {player.bet > 0 && (
        <div key={`bet-${player.bet}`} className={`animate-chip-bet absolute ${badgeAbove ? 'bottom-[var(--seat-bet)]' : 'top-[var(--seat-bet)]'} flex items-center gap-1.5 bg-slate-950/80 border border-emerald-500/30 rounded-full px-3 py-1 shadow-sm backdrop-blur-md whitespace-nowrap z-30 transform hover:scale-110 transition-transform`}>
          <span className="text-emerald-500 text-sm">🪙</span>
          <span className="text-emerald-100 font-mono text-xs font-bold">{player.bet}</span>
        </div>
      )}
    </div>
  );
};
