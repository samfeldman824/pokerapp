import React, { useState, useEffect, useRef } from 'react';
import { ClientGameState, PlayerAction, ActionType, GamePhase } from '../engine/types';
import { ActionTimer } from './ActionTimer';

export interface ActionBarProps {
  gameState: ClientGameState;
  playerId: string;
  onAction: (action: PlayerAction) => void;
}

const POSTFLOP_STREETS = [GamePhase.Flop, GamePhase.Turn, GamePhase.River]

export const ActionBar: React.FC<ActionBarProps> = ({ gameState, playerId, onAction }) => {
  const player = gameState.players.find(p => p?.id === playerId);
  
  const currentBet = gameState.currentBet ?? 0;
  const playerBet = player?.bet ?? 0;
  const playerChips = player?.chips ?? 0;
  
  const callAmount = Math.max(0, currentBet - playerBet);
  const minRaise = gameState.minRaise ?? gameState.config.bigBlind;
  const allInAmount = playerChips + playerBet;
  
  const [raiseAmount, setRaiseAmount] = useState<number>(minRaise);
  const raiseInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setRaiseAmount(Math.min(currentBet + minRaise, allInAmount));
  }, [minRaise, allInAmount, currentBet]);

  if (!player) return null;
  if (gameState.activePlayerIndex < 0) return null;
  if (player.seatIndex !== gameState.activePlayerIndex) return null;

  const canCheck = currentBet === 0 || playerBet === currentBet;
  const canCall = currentBet > playerBet && playerChips > 0;
  const canRaise = playerChips > callAmount;

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Get active element
      const activeElement = document.activeElement as HTMLElement;
      const isInputActive = activeElement?.tagName === 'INPUT' || activeElement?.tagName === 'TEXTAREA';
      const isRaiseInputFocused = raiseInputRef.current === activeElement;

      // Handle Enter on raise input separately
      if (e.key === 'Enter' && isRaiseInputFocused) {
        e.preventDefault();
        handleRaise();
        return;
      }

      // Ignore all other shortcuts when typing in inputs
      if (isInputActive) {
        return;
      }

      switch (e.key.toLowerCase()) {
        case 'f':
          e.preventDefault();
          handleFold();
          break;
        case 'k':
          e.preventDefault();
          if (canCheck) handleCheck();
          break;
        case 'c':
          e.preventDefault();
          if (canCall) handleCall();
          break;
        case 'r':
          e.preventDefault();
          if (canRaise) {
            raiseInputRef.current?.focus();
          }
          break;
        case '1':
          e.preventDefault();
          if (canRaise) calcHalfPot();
          break;
        case '2':
          e.preventDefault();
          if (canRaise) calcPot();
          break;
        case '3':
          e.preventDefault();
          if (canRaise) calcAllIn();
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canCheck, canCall, canRaise]);



  const isBet = POSTFLOP_STREETS.includes(gameState.phase) && currentBet === 0;
  const raiseLabel = isBet ? 'Bet' : 'Raise';

  const actualCallAmount = Math.min(callAmount, playerChips);

  const handleFold = () => onAction({ type: ActionType.Fold });
  const handleCheck = () => onAction({ type: ActionType.Check });
  const handleCall = () => onAction({ type: ActionType.Call });
  const handleRaise = () => onAction(
    isBet
      ? { type: ActionType.Bet, amount: raiseAmount }
      : { type: ActionType.Raise, amount: raiseAmount }
  );

  const handleTimeout = () => {
    if (canCheck) {
      handleCheck();
    } else {
      handleFold();
    }
  };

  const setRaiseClamped = (val: number) => {
    const clamped = Math.max(Math.min(currentBet + minRaise, allInAmount), Math.min(val, allInAmount));
    setRaiseAmount(clamped);
  };

  const calcHalfPot = () => {
    const potWithCall = gameState.pot + callAmount;
    setRaiseClamped(currentBet + Math.floor(potWithCall / 2));
  };

  const calcPot = () => {
    const potWithCall = gameState.pot + callAmount;
    setRaiseClamped(currentBet + potWithCall);
  };

  const calcAllIn = () => {
    setRaiseAmount(allInAmount);
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-neutral-900/95 backdrop-blur border-t border-neutral-800 p-4 shadow-2xl z-50">
      <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center gap-6 justify-between">
        
        <div className="w-full md:w-auto flex-shrink-0 flex items-center justify-center md:justify-start">
          <ActionTimer 
            timePerAction={gameState.config.timePerAction} 
            timerStart={gameState.timerStart} 
            onTimeout={handleTimeout}
          />
        </div>

        <div className="flex gap-3 flex-1 justify-center w-full">
          <button
            onClick={handleFold}
            className="flex-1 md:flex-none px-6 py-3 rounded-lg font-bold text-sm tracking-widest uppercase transition-all bg-neutral-800 text-neutral-300 hover:bg-neutral-700 hover:text-white border border-neutral-700 relative"
          >
            Fold
            <kbd className="absolute top-1 right-1 text-xs bg-neutral-700 text-neutral-300 px-1.5 py-0.5 rounded font-mono border border-neutral-600">F</kbd>
          </button>

          <button
            onClick={handleCheck}
            disabled={!canCheck}
            className="flex-1 md:flex-none px-8 py-3 rounded-lg font-bold text-sm tracking-widest uppercase transition-all bg-amber-500/20 text-amber-500 hover:bg-amber-500/30 border border-amber-500/30 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-amber-500/20 relative"
          >
            Check
            <kbd className="absolute top-1 right-1 text-xs bg-amber-900/40 text-amber-500 px-1.5 py-0.5 rounded font-mono border border-amber-700/30">K</kbd>
          </button>

          <button
            onClick={handleCall}
            disabled={!canCall}
            className="flex-1 md:flex-none px-8 py-3 rounded-lg font-bold text-sm tracking-widest uppercase transition-all bg-amber-500/20 text-amber-500 hover:bg-amber-500/30 border border-amber-500/30 flex items-center justify-center gap-2 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-amber-500/20 relative"
          >
            <span>Call</span>
            {canCall && <span className="opacity-70">${actualCallAmount}</span>}
            <kbd className="absolute top-1 right-1 text-xs bg-amber-900/40 text-amber-500 px-1.5 py-0.5 rounded font-mono border border-amber-700/30">C</kbd>
          </button>
        </div>

        {canRaise && (
          <div className="flex flex-col gap-3 w-full md:w-auto md:min-w-[320px]">
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={Math.min(currentBet + minRaise, allInAmount)}
                max={allInAmount}
                step={1}
                value={raiseAmount}
                onChange={(e) => setRaiseAmount(Number(e.target.value))}
                className="flex-1 h-2 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-amber-500"
              />
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-amber-500/50 font-bold">$</span>
                <input
                  type="number"
                  ref={raiseInputRef}
                  min={Math.min(currentBet + minRaise, allInAmount)}
                  max={allInAmount}
                  value={raiseAmount}
                  onChange={(e) => setRaiseClamped(Number(e.target.value))}
                  className="w-24 bg-neutral-950 border border-neutral-800 rounded py-2 pl-7 pr-3 text-amber-400 font-bold text-right focus:outline-none focus:border-amber-500/50 transition-colors"
                />
              </div>
              <button
                onClick={handleRaise}
                className="px-6 py-2 rounded font-bold text-sm tracking-widest uppercase transition-all bg-amber-500 text-amber-950 hover:bg-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.3)] relative"
              >
                {raiseLabel}
                <kbd className="absolute top-0.5 right-1 text-xs bg-amber-700 text-amber-100 px-1 py-0.5 rounded font-mono border border-amber-600">R</kbd>
              </button>
            </div>
            
            <div className="flex gap-2 justify-end">
              <button onClick={calcHalfPot} className="px-3 py-1 rounded text-xs font-bold uppercase tracking-wider bg-neutral-800 text-neutral-400 hover:bg-neutral-700 hover:text-white transition-colors relative">
                ½ Pot
                <kbd className="absolute top-0 right-0.5 text-xs bg-neutral-700 text-neutral-300 px-1 py-0.5 rounded font-mono border border-neutral-600 leading-none">1</kbd>
              </button>
              <button onClick={calcPot} className="px-3 py-1 rounded text-xs font-bold uppercase tracking-wider bg-neutral-800 text-neutral-400 hover:bg-neutral-700 hover:text-white transition-colors relative">
                Pot
                <kbd className="absolute top-0 right-0.5 text-xs bg-neutral-700 text-neutral-300 px-1 py-0.5 rounded font-mono border border-neutral-600 leading-none">2</kbd>
              </button>
              <button onClick={calcAllIn} className="px-3 py-1 rounded text-xs font-bold uppercase tracking-wider bg-red-900/40 text-red-400 hover:bg-red-900/60 transition-colors relative">
                All-in
                <kbd className="absolute top-0 right-0.5 text-xs bg-red-900/60 text-red-300 px-1 py-0.5 rounded font-mono border border-red-700/50 leading-none">3</kbd>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
