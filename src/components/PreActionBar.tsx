import React, { useState, useEffect } from 'react';
import { ClientGameState, PlayerAction, ActionType } from '../engine/types';

export interface PreActionBarProps {
  gameState: ClientGameState;
  playerId: string;
  onAction: (action: PlayerAction) => void;
}

type PreActionType = 'fold' | 'check-fold' | null;

export const PreActionBar: React.FC<PreActionBarProps> = ({ gameState, playerId, onAction }) => {
  const [selectedPreAction, setSelectedPreAction] = useState<PreActionType>(null);
  
  const player = gameState.players.find(p => p?.id === playerId);
  
  useEffect(() => {
    setSelectedPreAction(null);
  }, [gameState.handNumber]);
  

  useEffect(() => {
    if (!player) return;
    if (gameState.activePlayerIndex < 0) return;
    if (player.seatIndex !== gameState.activePlayerIndex) return;
    if (!selectedPreAction) return;
    
    const currentBet = gameState.currentBet ?? 0;
    const playerBet = player.bet ?? 0;
    const canCheck = currentBet === 0 || playerBet === currentBet;
    
    if (selectedPreAction === 'fold') {
      onAction({ type: ActionType.Fold });
    } else if (selectedPreAction === 'check-fold') {
      if (canCheck) {
        onAction({ type: ActionType.Check });
      } else {
        onAction({ type: ActionType.Fold });
      }
    }
    
    setSelectedPreAction(null);
  }, [gameState.activePlayerIndex, selectedPreAction, player, gameState.currentBet, onAction]);
  
  if (!player) return null;
  if (gameState.activePlayerIndex < 0) return null;
  if (player.seatIndex === gameState.activePlayerIndex) return null;
  
  const currentBet = gameState.currentBet ?? 0;
  const playerBet = player.bet ?? 0;
  const canCheck = currentBet === 0 || playerBet === currentBet;
  
  const togglePreAction = (action: 'fold' | 'check-fold') => {
    setSelectedPreAction(prev => prev === action ? null : action);
  };
  
  return (
    <div className="fixed bottom-0 left-0 right-0 bg-neutral-900/70 backdrop-blur-sm border-t border-neutral-800/50 p-3 shadow-lg z-40">
      <div className="max-w-6xl mx-auto flex items-center justify-center gap-4">
        <span className="text-neutral-400 text-sm font-medium">Pre-actions:</span>
        
        <label className="flex items-center gap-2 cursor-pointer group">
          <input
            type="checkbox"
            checked={selectedPreAction === 'fold'}
            onChange={() => togglePreAction('fold')}
            className="w-4 h-4 rounded border-neutral-600 bg-neutral-800 text-red-500 focus:ring-red-500/30 focus:ring-2 cursor-pointer"
          />
          <span className="text-sm font-medium text-neutral-300 group-hover:text-white transition-colors">
            Fold
          </span>
        </label>
        
        <label className="flex items-center gap-2 cursor-pointer group">
          <input
            type="checkbox"
            checked={selectedPreAction === 'check-fold'}
            onChange={() => togglePreAction('check-fold')}
            className="w-4 h-4 rounded border-neutral-600 bg-neutral-800 text-amber-500 focus:ring-amber-500/30 focus:ring-2 cursor-pointer"
          />
          <span className="text-sm font-medium text-neutral-300 group-hover:text-white transition-colors">
            Check/Fold
            {selectedPreAction === 'check-fold' && (
              <span className="ml-2 text-xs text-neutral-500">
                (will {canCheck ? 'check' : 'fold'})
              </span>
            )}
          </span>
        </label>
      </div>
    </div>
  );
};
