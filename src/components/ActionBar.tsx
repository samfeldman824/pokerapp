import React, { useState, useEffect, useRef } from 'react';
import { ClientGameState, PlayerAction, ActionType, GamePhase } from '../engine/types';
import { ActionTimer } from './ActionTimer';

export interface ActionBarProps {
  gameState: ClientGameState;
  playerId: string;
  onAction: (action: PlayerAction) => void;
  isActing: boolean;
  confirmationMessage: string | null;
}

const POSTFLOP_STREETS = [GamePhase.Flop, GamePhase.Turn, GamePhase.River]

export const ActionBar: React.FC<ActionBarProps> = ({ gameState, playerId, onAction, isActing, confirmationMessage }) => {
  const player = gameState.players.find(p => p?.id === playerId);
  
  const currentBet = gameState.currentBet ?? 0;
  const playerBet = player?.bet ?? 0;
  const playerChips = player?.chips ?? 0;
  
  const callAmount = Math.max(0, currentBet - playerBet);
  const minRaise = gameState.minRaise ?? gameState.config.bigBlind;
  const allInAmount = playerChips + playerBet;
  
  const [raiseAmount, setRaiseAmount] = useState<number>(minRaise);
  const [raiseInputValue, setRaiseInputValue] = useState<string>(String(minRaise));
  const [isRaiseOpen, setIsRaiseOpen] = useState(false);
  const raiseInputRef = useRef<HTMLInputElement>(null);

  const isPlayerTurn = !!player && gameState.activePlayerIndex >= 0 && player.seatIndex === gameState.activePlayerIndex;

  useEffect(() => {
    if (!isPlayerTurn) setIsRaiseOpen(false);
  }, [isPlayerTurn]);

  useEffect(() => {
    const newAmount = Math.min(currentBet + minRaise, allInAmount);
    setRaiseAmount(newAmount);
    setRaiseInputValue(String(newAmount));
  }, [minRaise, allInAmount, currentBet]);

  const canCheck = currentBet === 0 || playerBet === currentBet;
  const canCall = currentBet > playerBet && playerChips > 0;
  const canRaise = playerChips > callAmount;

  const openRaise = () => {
    setIsRaiseOpen(true);
    setTimeout(() => raiseInputRef.current?.focus(), 0);
  };

  const closeRaise = () => {
    setIsRaiseOpen(false);
  };

  // Keyboard shortcuts
  useEffect(() => {
    if (!isPlayerTurn || isActing) {
      return;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      const activeElement = document.activeElement as HTMLElement;
      const isInputActive = activeElement?.tagName === 'INPUT' || activeElement?.tagName === 'TEXTAREA';
      const isRaiseInputFocused = raiseInputRef.current === activeElement;

      if (e.key === 'Escape') {
        if (isRaiseOpen) {
          e.preventDefault();
          closeRaise();
        }
        return;
      }

      if (e.key === 'Enter' && isRaiseInputFocused) {
        e.preventDefault();
        handleRaise();
        return;
      }

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
            if (!isRaiseOpen) {
              openRaise();
            } else {
              handleRaise();
            }
          }
          break;
        case '1':
          e.preventDefault();
          if (canRaise && isRaiseOpen) calcHalfPot();
          break;
        case '2':
          e.preventDefault();
          if (canRaise && isRaiseOpen) calcPot();
          break;
        case '3':
          e.preventDefault();
          if (canRaise && isRaiseOpen) calcAllIn();
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canCheck, canCall, canRaise, isActing, isPlayerTurn, raiseAmount, isRaiseOpen]);

  if (!player) return null;
  const isBet = POSTFLOP_STREETS.includes(gameState.phase) && currentBet === 0;
  const raiseLabel = isBet ? 'Bet' : 'Raise';

  const actualCallAmount = Math.min(callAmount, playerChips);
  const livePot = gameState.pot + gameState.players.reduce((total, currentPlayer) => total + (currentPlayer?.bet ?? 0), 0);
  const potOdds = canCall && !canCheck
    ? Math.round((actualCallAmount / (livePot + actualCallAmount)) * 100)
    : null;

  const submitAction = (action: PlayerAction) => {
    if (isActing) {
      return;
    }

    onAction(action);
  };

  const handleFold = () => submitAction({ type: ActionType.Fold });
  const handleCheck = () => submitAction({ type: ActionType.Check });
  const handleCall = () => submitAction({ type: ActionType.Call });
  const handleRaise = () => {
    const num = Number(raiseInputValue);
    const minVal = Math.min(currentBet + minRaise, allInAmount);
    const finalAmount = isNaN(num) || raiseInputValue === ''
      ? minVal
      : Math.max(minVal, Math.min(num, allInAmount));
    setRaiseAmount(finalAmount);
    setRaiseInputValue(String(finalAmount));
    setIsRaiseOpen(false);
    submitAction(
      isBet
        ? { type: ActionType.Bet, amount: finalAmount }
        : { type: ActionType.Raise, amount: finalAmount }
    );
  };

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
    setRaiseInputValue(String(clamped));
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
    setRaiseInputValue(String(allInAmount));
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-neutral-900/95 backdrop-blur border-t border-neutral-800 p-4 shadow-2xl z-50">
      <div className={`max-w-6xl mx-auto flex flex-col md:flex-row items-center gap-6 justify-between transition-opacity duration-300${!isPlayerTurn ? ' opacity-50' : ''}`}>

        <div className={`w-full md:w-auto flex-shrink-0 flex items-center justify-center md:justify-start${!isPlayerTurn ? ' invisible' : ''}`}>
          <ActionTimer 
            timePerAction={gameState.config.timePerAction} 
            timerStart={isPlayerTurn ? gameState.actionTimerStart : null} 
            onTimeout={handleTimeout}
          />
        </div>

        <div className="flex gap-3 flex-1 justify-center w-full">
          <button
            onClick={handleFold}
            disabled={!isPlayerTurn || isActing}
            className="flex-1 md:flex-none px-6 py-3 rounded-lg font-bold text-sm tracking-widest uppercase transition-all bg-neutral-800 text-neutral-300 hover:bg-neutral-700 hover:text-white border border-neutral-700 relative disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-neutral-800 disabled:hover:text-neutral-300"
          >
            Fold
            <kbd className="absolute top-1 right-1 text-xs bg-neutral-700 text-neutral-300 px-1.5 py-0.5 rounded font-mono border border-neutral-600">F</kbd>
          </button>

          <button
            onClick={handleCheck}
            disabled={!isPlayerTurn || !canCheck || isActing}
            className="flex-1 md:flex-none px-8 py-3 rounded-lg font-bold text-sm tracking-widest uppercase transition-all bg-amber-500/20 text-amber-500 hover:bg-amber-500/30 border border-amber-500/30 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-amber-500/20 relative"
          >
            Check
            <kbd className="absolute top-1 right-1 text-xs bg-amber-900/40 text-amber-500 px-1.5 py-0.5 rounded font-mono border border-amber-700/30">K</kbd>
          </button>

          <button
            onClick={handleCall}
            disabled={!isPlayerTurn || !canCall || isActing}
            className="flex-1 md:flex-none px-8 py-3 rounded-lg font-bold text-sm tracking-widest uppercase transition-all bg-amber-500/20 text-amber-500 hover:bg-amber-500/30 border border-amber-500/30 flex items-center justify-center gap-2 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-amber-500/20 relative"
          >
            <span>Call</span>
            {canCall && <span className="opacity-70">${actualCallAmount}</span>}
            <kbd className="absolute top-1 right-1 text-xs bg-amber-900/40 text-amber-500 px-1.5 py-0.5 rounded font-mono border border-amber-700/30">C</kbd>
          </button>

          {canRaise && (
            <button
              onClick={() => isRaiseOpen ? handleRaise() : openRaise()}
              disabled={!isPlayerTurn || isActing}
              className={`flex-1 md:flex-none px-8 py-3 rounded-lg font-bold text-sm tracking-widest uppercase transition-all border flex items-center justify-center gap-2 relative disabled:opacity-30 disabled:cursor-not-allowed ${
                isRaiseOpen && isPlayerTurn
                  ? 'bg-amber-500 text-amber-950 hover:bg-amber-400 border-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.3)]'
                  : 'bg-amber-500/20 text-amber-500 hover:bg-amber-500/30 border-amber-500/30 disabled:hover:bg-amber-500/20'
              }`}
            >
              <span>{raiseLabel}</span>
              {isRaiseOpen && isPlayerTurn && (
                <span
                  className="inline-flex items-center gap-0.5"
                  onClick={e => e.stopPropagation()}
                >
                  <span className="opacity-70">$</span>
                  <input
                    ref={raiseInputRef}
                    type="number"
                    value={raiseInputValue}
                    onChange={(e) => {
                      setRaiseInputValue(e.target.value);
                      const num = Number(e.target.value);
                      if (!isNaN(num) && e.target.value !== '') setRaiseAmount(num);
                    }}
                    onBlur={() => {
                      const num = Number(raiseInputValue);
                      if (isNaN(num) || raiseInputValue === '') {
                        const minVal = Math.min(currentBet + minRaise, allInAmount);
                        setRaiseAmount(minVal);
                        setRaiseInputValue(String(minVal));
                      } else {
                        setRaiseClamped(num);
                      }
                    }}
                    onFocus={e => e.target.select()}
                    onClick={e => e.stopPropagation()}
                    onKeyDown={e => {
                      if (e.key === 'Enter') { e.preventDefault(); handleRaise(); }
                      if (e.key === 'Escape') { e.preventDefault(); closeRaise(); }
                    }}
                    disabled={isActing}
                    className="w-16 bg-transparent text-inherit font-bold text-right outline-none cursor-text [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                </span>
              )}
              <kbd className={`absolute top-1 right-1 text-xs px-1.5 py-0.5 rounded font-mono border ${
                isRaiseOpen && isPlayerTurn
                  ? 'bg-amber-700 text-amber-100 border-amber-600'
                  : 'bg-amber-900/40 text-amber-500 border-amber-700/30'
              }`}>R</kbd>
            </button>
          )}

          {potOdds !== null && (
            <div className="flex items-center rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-emerald-300">
              Pot Odds: {potOdds}%
            </div>
          )}
        </div>

        {canRaise && (
          <div className={`flex flex-col gap-3 w-full md:w-auto md:min-w-[320px]${!isPlayerTurn || !isRaiseOpen ? ' invisible' : ''}`}>
            <input
              type="range"
              min={Math.min(currentBet + minRaise, allInAmount)}
              max={allInAmount}
              step={1}
              value={raiseAmount}
              onChange={(e) => {
                const val = Number(e.target.value);
                setRaiseAmount(val);
                setRaiseInputValue(String(val));
              }}
              disabled={isActing}
              className="w-full h-2 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-amber-500"
            />
            
            <div className="flex gap-2 justify-end">
              <button onClick={calcHalfPot} disabled={isActing} className="px-3 py-1 rounded text-xs font-bold uppercase tracking-wider bg-neutral-800 text-neutral-400 hover:bg-neutral-700 hover:text-white transition-colors relative disabled:opacity-40 disabled:cursor-not-allowed">
                ½ Pot
                <kbd className="absolute top-0 right-0.5 text-xs bg-neutral-700 text-neutral-300 px-1 py-0.5 rounded font-mono border border-neutral-600 leading-none">1</kbd>
              </button>
              <button onClick={calcPot} disabled={isActing} className="px-3 py-1 rounded text-xs font-bold uppercase tracking-wider bg-neutral-800 text-neutral-400 hover:bg-neutral-700 hover:text-white transition-colors relative disabled:opacity-40 disabled:cursor-not-allowed">
                Pot
                <kbd className="absolute top-0 right-0.5 text-xs bg-neutral-700 text-neutral-300 px-1 py-0.5 rounded font-mono border border-neutral-600 leading-none">2</kbd>
              </button>
              <button onClick={calcAllIn} disabled={isActing} className="px-3 py-1 rounded text-xs font-bold uppercase tracking-wider bg-red-900/40 text-red-400 hover:bg-red-900/60 transition-colors relative disabled:opacity-40 disabled:cursor-not-allowed">
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
