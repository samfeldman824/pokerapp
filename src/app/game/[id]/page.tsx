"use client";

import { useCallback, useEffect, useRef, useState, FormEvent } from "react";
import { useParams } from "next/navigation";
import PokerTable from "@/components/PokerTable";
import { HandResultOverlay } from "@/components/HandResultOverlay";
import { SessionLedger } from "@/components/SessionLedger";
import { useGameSocket } from "@/lib/useGameSocket";
import { PlayerAction } from "@/engine/types";
import Link from "next/link";

interface GameInfo {
  id: string;
  config: {
    maxPlayers: number;
    smallBlind: number;
    bigBlind: number;
    startingStack: number;
  };
  phase: string;
  playerCount: number;
  maxPlayers: number;
  isPaused: boolean;
  occupiedSeats: number[];
}

type PendingSeatJoin = {
  displayName: string;
  seatIndex: number;
};

export default function GamePage() {
  const params = useParams();
  const gameId = params.id as string;

  const [gameInfo, setGameInfo] = useState<GameInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isJoining, setIsJoining] = useState(false);

  const [showJoinModal, setShowJoinModal] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [selectedSeat, setSelectedSeat] = useState<number | null>(null);
  const [pendingTokenJoin, setPendingTokenJoin] = useState<string | null>(null);
  const [pendingSeatJoin, setPendingSeatJoin] = useState<PendingSeatJoin | null>(null);
  const [showLedger, setShowLedger] = useState(false);
  const [activeHandResult, setActiveHandResult] = useState<ReturnType<typeof useGameSocket>["lastHandResult"]>(null);
  const [connectionBanner, setConnectionBanner] = useState<
    | {
        tone: "warn" | "success";
        message: string;
      }
    | null
  >(null);

  const { gameState, playerId, isConnected, emit, lastHandResult } = useGameSocket(gameId);

  const prevConnectedRef = useRef<boolean | null>(null);
  const bannerTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (bannerTimeoutRef.current) {
        clearTimeout(bannerTimeoutRef.current);
        bannerTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (prevConnectedRef.current === null) {
      prevConnectedRef.current = isConnected;
      return;
    }

    const wasConnected = prevConnectedRef.current;
    if (wasConnected && !isConnected) {
      if (bannerTimeoutRef.current) {
        clearTimeout(bannerTimeoutRef.current);
        bannerTimeoutRef.current = null;
      }
      setConnectionBanner({ tone: "warn", message: "Connection lost — reconnecting..." });
    }

    if (!wasConnected && isConnected) {
      if (bannerTimeoutRef.current) {
        clearTimeout(bannerTimeoutRef.current);
      }
      setConnectionBanner({ tone: "success", message: "Reconnected!" });
      bannerTimeoutRef.current = setTimeout(() => {
        setConnectionBanner(null);
        bannerTimeoutRef.current = null;
      }, 2000);
    }

    prevConnectedRef.current = isConnected;
  }, [isConnected]);

  useEffect(() => {
    async function fetchGameInfo() {
      try {
        const res = await fetch(`/api/games/${gameId}`);
        if (!res.ok) {
          if (res.status === 404) {
            setError("Game not found");
          } else {
            setError("Failed to load game info");
          }
          setIsLoading(false);
          return;
        }

        const data = await res.json();
        setGameInfo(data);

        const token = localStorage.getItem(`poker_token_${gameId}`);
        if (token) {
          setPendingTokenJoin(token);
        } else {
          setShowJoinModal(true);
        }
      } catch (err) {
        setError("Network error");
      } finally {
        setIsLoading(false);
      }
    }

    if (gameId) {
      fetchGameInfo();
    }
  }, [gameId]);

  useEffect(() => {
    if (!isConnected) {
      return;
    }
    if (playerId && gameState) {
      return;
    }

    if (pendingTokenJoin) {
      emit("join-game", { gameId, token: pendingTokenJoin });
    }

    if (pendingSeatJoin) {
      emit("join-game", {
        gameId,
        displayName: pendingSeatJoin.displayName,
        seatIndex: pendingSeatJoin.seatIndex,
      });
    }
  }, [isConnected, gameId, emit, pendingSeatJoin, pendingTokenJoin, playerId]);

  useEffect(() => {
    if (gameState && playerId) {
      setShowJoinModal(false);
      setIsJoining(false);
      setPendingSeatJoin(null);
      setPendingTokenJoin(null);
    }
  }, [gameState, playerId]);

  useEffect(() => {
    if (lastHandResult) {
      setActiveHandResult(lastHandResult);
    }
  }, [lastHandResult]);

  const handleAction = useCallback((action: PlayerAction) => {
    if (!playerId) return;

    emit("player-action", { gameId, playerId, action });
  }, [emit, gameId, playerId]);

  const handleRebuy = useCallback(() => {
    if (!playerId) return;
    emit("rebuy", { gameId, playerId });
  }, [emit, gameId, playerId]);

  const handleJoinSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!displayName.trim() || selectedSeat === null) return;

    setIsJoining(true);
    setPendingSeatJoin({
      displayName: displayName.trim(),
      seatIndex: selectedSeat,
    });
  };

  const handleStartGame = () => {
    if (!playerId) return;

    emit("start-game", { gameId, playerId });
  };

  const handlePauseResume = () => {
    if (!playerId) return;

    if (gameState?.isPaused) {
      emit("resume-game", { gameId, playerId });
    } else {
      emit("pause-game", { gameId, playerId });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-950 text-gray-200">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-indigo-500"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-950 text-gray-200">
        <h1 className="text-3xl font-bold mb-4">{error}</h1>
        <Link
          href="/"
          className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-md transition-colors"
        >
          Return Home
        </Link>
      </div>
    );
  }

  const renderJoinModal = () => {
    if (!gameInfo) return null;

    const seats = Array.from({ length: gameInfo.maxPlayers }, (_, i) => i);
    const isSeatOccupied = (index: number) => {
      if (gameState) {
        return gameState.players.some((player) => player?.seatIndex === index);
      }

      return gameInfo.occupiedSeats.includes(index);
    };

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
        <div className="bg-gray-900 border border-gray-800 rounded-xl shadow-2xl p-6 w-full max-w-md">
          <h2 className="text-2xl font-bold text-white mb-2">Join Game</h2>
          
          <div className="mb-6 p-4 bg-gray-950 rounded-lg text-sm text-gray-400 grid grid-cols-2 gap-2 border border-gray-800">
            <div>
              <span className="block text-gray-500 text-xs uppercase tracking-wider mb-1">Blinds</span>
              <span className="text-gray-200">{gameInfo.config.smallBlind} / {gameInfo.config.bigBlind}</span>
            </div>
            <div>
              <span className="block text-gray-500 text-xs uppercase tracking-wider mb-1">Starting Stack</span>
              <span className="text-gray-200">{gameInfo.config.startingStack}</span>
            </div>
            <div>
              <span className="block text-gray-500 text-xs uppercase tracking-wider mb-1">Max Players</span>
              <span className="text-gray-200">{gameInfo.maxPlayers}</span>
            </div>
          </div>

          <form onSubmit={handleJoinSubmit} className="space-y-5">
            <div>
              <label htmlFor="displayName" className="block text-sm font-medium text-gray-300 mb-1">
                Display Name
              </label>
              <input
                id="displayName"
                type="text"
                required
                maxLength={20}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full px-4 py-2 bg-gray-950 border border-gray-800 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent placeholder-gray-600"
                placeholder="Enter your name"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Select Seat
              </label>
              <div className="grid grid-cols-3 gap-2">
                {seats.map((seatIndex) => {
                  const occupied = isSeatOccupied(seatIndex);
                  const selected = selectedSeat === seatIndex;
                  return (
                    <button
                      key={seatIndex}
                      type="button"
                      disabled={occupied}
                      onClick={() => setSelectedSeat(seatIndex)}
                      className={`
                        py-3 rounded-md text-sm font-medium transition-all
                        ${occupied ? "bg-gray-800 text-gray-600 cursor-not-allowed" : ""}
                        ${!occupied && selected ? "bg-indigo-600 text-white shadow-[0_0_15px_rgba(79,70,229,0.5)] border-indigo-500 border" : ""}
                        ${!occupied && !selected ? "bg-gray-950 text-gray-400 border border-gray-800 hover:border-gray-600 hover:text-gray-200" : ""}
                      `}
                    >
                      Seat {seatIndex + 1}
                    </button>
                  );
                })}
              </div>
            </div>

            <button
              type="submit"
              disabled={isJoining || !displayName.trim() || selectedSeat === null}
              className="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-800 disabled:text-gray-500 text-white font-medium rounded-md transition-colors shadow-[0_0_20px_rgba(79,70,229,0.3)] disabled:shadow-none mt-2"
            >
              {isJoining ? "Joining..." : "Join Game"}
            </button>
          </form>
        </div>
      </div>
    );
  };

  const isHost = gameState && playerId === gameState.hostPlayerId;

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col font-sans text-gray-200 relative overflow-hidden">
      <header className="h-14 bg-gray-900 border-b border-gray-800 flex items-center justify-between px-6 z-10">
        <div className="flex items-center space-x-4">
          <h1 className="font-bold text-white tracking-wider">
            GAME <span className="text-gray-500 font-mono text-sm ml-2">#{gameId.slice(0, 8)}</span>
          </h1>
          {(gameState?.phase ?? gameInfo?.phase) === "waiting" && (
            <span className="px-3 py-1 bg-yellow-900/30 text-yellow-500 border border-yellow-700/50 rounded-full text-xs font-medium animate-pulse">
              Waiting for host...
            </span>
          )}
        </div>

        <div className="flex items-center space-x-6">
          <div className="text-sm text-gray-400">
            Players: <span className="text-white font-medium">{gameState?.players.filter(Boolean).length || gameInfo?.playerCount || 0}/{gameInfo?.maxPlayers || 0}</span>
          </div>

          <div
            className={
              `flex items-center gap-2 rounded-full border px-3 py-1 ` +
              (isConnected
                ? "border-emerald-500/30 bg-emerald-950/20"
                : "border-red-500/30 bg-red-950/20")
            }
          >
            <div
              className={
                `w-2 h-2 rounded-full ` +
                (isConnected
                  ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.8)]"
                  : "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)] animate-pulse")
              }
            />
            <span className="text-xs text-gray-500 uppercase tracking-widest">
              {isConnected ? "Connected" : "Reconnecting..."}
            </span>
          </div>
        </div>
      </header>

      {connectionBanner && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 px-4 pointer-events-none">
          <div
            className={
              "pointer-events-auto rounded-full border px-4 py-2 text-sm shadow-lg backdrop-blur " +
              (connectionBanner.tone === "success"
                ? "bg-emerald-950/70 border-emerald-500/30 text-emerald-200"
                : "bg-amber-950/70 border-amber-500/30 text-amber-200")
            }
          >
            {connectionBanner.message}
          </div>
        </div>
      )}

      {isHost && (
        <div className="bg-gray-900/80 backdrop-blur border-b border-gray-800 px-6 py-3 flex items-center justify-between z-10">
          <div className="flex items-center space-x-2">
            <span className="text-xs text-indigo-400 uppercase tracking-widest font-bold bg-indigo-900/30 px-2 py-1 rounded">Host Controls</span>
          </div>
          <div className="flex items-center space-x-3">
            <button
              onClick={() => setShowLedger(true)}
              className="px-4 py-1.5 bg-gray-800 hover:bg-gray-700 text-white text-sm font-medium rounded border border-gray-700 transition-colors"
            >
              Session Ledger
            </button>
            <button
              onClick={handleStartGame}
              disabled={gameState?.phase !== "waiting"}
              className="px-4 py-1.5 bg-green-600 hover:bg-green-500 disabled:bg-gray-800 disabled:text-gray-600 text-white text-sm font-medium rounded transition-colors"
            >
              Start Game
            </button>
            <button
              onClick={handlePauseResume}
              className="px-4 py-1.5 bg-gray-800 hover:bg-gray-700 text-white text-sm font-medium rounded border border-gray-700 transition-colors"
            >
              {gameState?.isPaused ? "Resume" : "Pause"}
            </button>
          </div>
        </div>
      )}

      <main className="flex-1 relative flex items-center justify-center">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(31,41,55,0.4)_0,rgba(3,7,18,1)_100%)] pointer-events-none"></div>
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[400px] bg-indigo-900/10 blur-[120px] rounded-full pointer-events-none"></div>
        
        {gameState && playerId ? (
          <div className="w-full h-full p-4 relative z-10">
            <PokerTable gameState={gameState} playerId={playerId} onAction={handleAction} onRebuy={handleRebuy} />
          </div>
        ) : (
          !showJoinModal && (
            <div className="text-gray-500 animate-pulse">Loading table...</div>
          )
        )}
      </main>

      {showJoinModal && renderJoinModal()}
      {showLedger && <SessionLedger gameId={gameId} onClose={() => setShowLedger(false)} />}
      {activeHandResult && gameState && (
        <HandResultOverlay
          results={activeHandResult.results}
          players={gameState.players}
          onClose={() => setActiveHandResult(null)}
        />
      )}
    </div>
  );
}
