"use client";

/**
 * GamePage — /game/[id]
 *
 * The main game room. Orchestrates Socket.IO connection, join flow, and real-time gameplay UI.
 *
 * High-level flow on mount:
 *   1. Fetch game metadata from REST (`/api/games/[id]`) to get config and occupied seats.
 *   2. Check localStorage for a saved token (`poker_token_<gameId>`).
 *      - Token found → queue a token-based join (returning player / host reconnect).
 *      - No token    → show the join modal so the user can pick a name and seat.
 *   3. Once the Socket.IO connection is established (`isConnected`), fire the queued join event.
 *      The join is queued rather than sent immediately because the socket may not be ready yet.
 *   4. After the server confirms the join (`gameState` + `playerId` are populated), hide the modal.
 *   5. The session ledger is rendered as a modal layer on top of the table.
 *
 * Connection resilience:
 *   - A `connectionBanner` state surfaces disconnect/reconnect events to the user.
 *   - On reconnect the pending join events re-fire automatically (see the isConnected useEffect).
 */

import { useCallback, useEffect, useRef, useState, FormEvent } from "react";
import { useParams } from "next/navigation";
import PokerTable from "@/components/PokerTable";
import { SessionLedger } from "@/components/SessionLedger";
import { InviteShare } from "@/components/InviteShare";
import { HandHistory } from "@/components/HandHistory";
import { ChatPanel } from "@/components/ChatPanel";
import type { ChatMessage } from "@/lib/useGameSocket";
import { useGameSocket } from "@/lib/useGameSocket";
import { PlayerAction, GamePhase, ActionType, GameConfig } from "@/engine/types";
import { getCurrentBlinds } from "@/engine/gameController";
import Link from "next/link";
import { ShowMuckActionBar } from "@/components/ShowMuckActionBar";

/** Shape of the REST game snapshot fetched on mount. */
interface GameInfo {
  id: string;
  config: GameConfig;
  phase: string;
  playerCount: number;
  maxPlayers: number;
  isPaused: boolean;
  /** 0-indexed seat numbers already occupied — used to grey out seats in the join modal. */
  occupiedSeats: number[];
}

/** Payload queued when a new (non-token) player submits the join modal. */
type PendingSeatJoin = {
  displayName: string;
  seatIndex: number;
};

type ActionConfirmation = {
  message: string;
  pending: boolean;
  phase: GamePhase;
  handNumber: number;
};

const ACTION_CONFIRMATION_DURATION_MS = 1500;

export default function GamePage() {
  const params = useParams();
  const gameId = params.id as string;

  // REST-fetched metadata (available before Socket.IO connects)
  const [gameInfo, setGameInfo] = useState<GameInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isJoining, setIsJoining] = useState(false);

  // Join modal state
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [selectedSeat, setSelectedSeat] = useState<number | null>(null);

  // Queued join payloads — held until the socket is ready, then sent in a useEffect
  const [pendingTokenJoin, setPendingTokenJoin] = useState<string | null>(null);
  const [pendingSeatJoin, setPendingSeatJoin] = useState<PendingSeatJoin | null>(null);
  const [pendingSpectatorJoin, setPendingSpectatorJoin] = useState<string | null>(null);

  const [showLedger, setShowLedger] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [showHandHistory, setShowHandHistory] = useState(false);

  /**
   * Transient banner shown at the top of the screen on disconnect/reconnect.
   * Auto-dismissed after 2 s on successful reconnect.
   */
  const [connectionBanner, setConnectionBanner] = useState<
    | {
        tone: "warn" | "success";
        message: string;
      }
    | null
  >(null);

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const onChatMessage = useCallback((msg: ChatMessage) => {
    setChatMessages((prev) => {
      // Prevent duplicates by ID (if same message arrives twice)
      if (prev.some((m) => m.id === msg.id)) return prev;
      return [...prev, msg];
    });
    setIsChatOpen((prevIsOpen) => {
      if (!prevIsOpen) {
        setUnreadCount((prevCount) => prevCount + 1);
      }
      return prevIsOpen;
    });
  }, []);

  const { gameState, playerId, spectatorId, isConnected, lastError, lastHandResult, emit } = useGameSocket(gameId, { onChatMessage });

  const handleSendChatMessage = useCallback((text: string, type: 'custom' | 'reaction') => {
    if (!playerId && !spectatorId) return;
    const senderId = playerId ?? spectatorId ?? '';
    let senderName = displayName || 'Unknown';
    if (gameState) {
      const player = gameState.players.find(p => p?.id === senderId);
      if (player) senderName = player.displayName;
    }
    emit('chat-message', { gameId, senderId, senderName, text, type });
  }, [emit, gameId, playerId, spectatorId, gameState, displayName]);

  const handleToggleChat = useCallback(() => {
    setIsChatOpen(prev => {
      if (!prev) setUnreadCount(0);
      return !prev;
    });
  }, []);

  const isSpectator = !!spectatorId;

  const [muckedHandNumber, setMuckedHandNumber] = useState<number | null>(null);
  const [actionConfirmation, setActionConfirmation] = useState<ActionConfirmation | null>(null);

  // Tracks the previous connection state so we can detect transitions (connected→lost, lost→reconnected)
  const prevConnectedRef = useRef<boolean | null>(null);
  // Holds the auto-dismiss timer for the "Reconnected!" banner
  const bannerTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const actionConfirmationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup the auto-dismiss timer on unmount to avoid setState on unmounted component
  useEffect(() => {
    return () => {
      if (bannerTimeoutRef.current) {
        clearTimeout(bannerTimeoutRef.current);
        bannerTimeoutRef.current = null;
      }
      if (actionConfirmationTimeoutRef.current) {
        clearTimeout(actionConfirmationTimeoutRef.current);
        actionConfirmationTimeoutRef.current = null;
      }
    };
  }, []);

  const formatActionConfirmation = useCallback((action: PlayerAction): string => {
    if (!gameState || !playerId) {
      return "Action sent";
    }

    const player = gameState.players.find((candidate) => candidate?.id === playerId);
    const currentBet = gameState.currentBet ?? 0;
    const playerBet = player?.bet ?? 0;
    const playerChips = player?.chips ?? 0;
    const callAmount = Math.min(Math.max(0, currentBet - playerBet), playerChips);
    const isBet = [GamePhase.Flop, GamePhase.Turn, GamePhase.River].includes(gameState.phase) && currentBet === 0;

    switch (action.type) {
      case ActionType.Fold:
        return "You folded";
      case ActionType.Check:
        return "You checked";
      case ActionType.Call:
        return `You called $${callAmount}`;
      case ActionType.Bet:
        return `You bet $${action.amount}`;
      case ActionType.Raise:
        return `${isBet ? "You bet" : "You raised to"} $${action.amount}`;
      default:
        return "Action sent";
    }
  }, [gameState, playerId]);

  // Show/hide the connection banner on state transitions.
  // We skip the very first render (prevConnectedRef === null) to avoid a spurious banner on load.
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

  // On mount: fetch game metadata and determine whether to show join modal or auto-join via token.
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

        // A saved token means this browser has previously joined (or is the host).
        // Queue the token join; it will fire once the socket connects.
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

  // Fire any queued join event once the socket becomes available.
  // This also re-fires on reconnect, which is the desired behavior for resuming sessions.
  // Guard: skip if already in game (playerId + gameState both set).
  useEffect(() => {
    if (!isConnected) {
      return;
    }
    if (playerId && gameState) {
      return;
    }
    if (spectatorId && gameState && !pendingSeatJoin) {
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

    if (pendingSpectatorJoin) {
      emit("join-game", {
        gameId,
        displayName: pendingSpectatorJoin,
        spectator: true,
      });
    }
  }, [isConnected, gameId, emit, pendingSeatJoin, pendingSpectatorJoin, pendingTokenJoin, playerId, spectatorId]);

  useEffect(() => {
    if (gameState && (playerId || spectatorId) && isJoining) {
      setShowJoinModal(false);
      setIsJoining(false);
      setPendingSeatJoin(null);
      setPendingSpectatorJoin(null);
      setPendingTokenJoin(null);
    }
  }, [gameState, playerId, spectatorId, isJoining]);

  /**
   * Sends a player action (fold, check, call, raise) to the server via Socket.IO.
   * No-ops if the player ID is not yet known (shouldn't happen in practice once seated).
   */
  const handleAction = useCallback((action: PlayerAction) => {
    if (!playerId) return;

    if (actionConfirmationTimeoutRef.current) {
      clearTimeout(actionConfirmationTimeoutRef.current);
      actionConfirmationTimeoutRef.current = null;
    }

    setActionConfirmation({
      message: formatActionConfirmation(action),
      pending: true,
      phase: gameState?.phase ?? GamePhase.Waiting,
      handNumber: gameState?.handNumber ?? 0,
    });
    emit("player-action", { gameId, playerId, action });
  }, [emit, formatActionConfirmation, gameId, gameState, playerId]);

  useEffect(() => {
    if (!actionConfirmation?.pending || !gameState || !playerId) {
      return;
    }

    const player = gameState.players.find((candidate) => candidate?.id === playerId);
    const isPlayersTurn = !!player && gameState.activePlayerIndex === player.seatIndex;

    const gameAdvanced =
      gameState.phase !== actionConfirmation.phase ||
      gameState.handNumber !== actionConfirmation.handNumber;

    if (isPlayersTurn && !gameAdvanced) {
      return;
    }

    setActionConfirmation((current) => current ? { ...current, pending: false } : current);
  }, [actionConfirmation, gameState, playerId]);

  useEffect(() => {
    if (!actionConfirmation || actionConfirmation.pending) {
      return;
    }

    actionConfirmationTimeoutRef.current = setTimeout(() => {
      setActionConfirmation(null);
      actionConfirmationTimeoutRef.current = null;
    }, ACTION_CONFIRMATION_DURATION_MS);

    return () => {
      if (actionConfirmationTimeoutRef.current) {
        clearTimeout(actionConfirmationTimeoutRef.current);
        actionConfirmationTimeoutRef.current = null;
      }
    };
  }, [actionConfirmation]);

  useEffect(() => {
    if (!actionConfirmation?.pending) {
      return;
    }

    if (!isConnected || lastError) {
      if (actionConfirmationTimeoutRef.current) {
        clearTimeout(actionConfirmationTimeoutRef.current);
        actionConfirmationTimeoutRef.current = null;
      }
      setActionConfirmation(null);
    }
  }, [actionConfirmation, isConnected, lastError]);

  const handleShowCards = useCallback(() => {
    if (!playerId || !gameState) return;
    emit("show-cards", { gameId, playerId });
  }, [emit, gameId, playerId, gameState]);

  const handleMuckCards = useCallback(() => {
    if (!gameState) return;
    setMuckedHandNumber(gameState.handNumber);
  }, [gameState]);

  /**
   * Submits the join modal form. Queues a seat join; the socket useEffect will send it
   * once connected (or immediately if already connected).
   */
  const handleJoinSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!displayName.trim() || selectedSeat === null) return;

    setIsJoining(true);
    setPendingSeatJoin({
      displayName: displayName.trim(),
      seatIndex: selectedSeat,
    });
  };

  const handleWatchSubmit = () => {
    if (!displayName.trim()) return;

    setIsJoining(true);
    setPendingSpectatorJoin(displayName.trim());
  };

  /** Emits `start-game` — only the host should have access to this button (enforced in UI). */
  const handleStartGame = () => {
    if (!playerId) return;

    emit("start-game", { gameId, playerId });
  };

  /** Toggles game pause/resume. The server validates that the emitter is the host. */
  const handlePauseResume = () => {
    if (!playerId) return;

    if (gameState?.isPaused) {
      emit("resume-game", { gameId, playerId });
    } else {
      emit("pause-game", { gameId, playerId });
    }
  };

  /** Resets the game back to Waiting phase, keeping all players but restoring chip stacks. */
  const handleResetGame = () => {
    if (!playerId) return;
    emit("reset-game", { gameId, playerId });
  };

  const handleRebuy = () => {
    if (!playerId) return;
    emit("rebuy", { gameId, playerId });
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

  /**
   * Renders the seat-selection modal for new players.
   *
   * Seat occupancy is determined from live Socket.IO state when available,
   * falling back to the REST snapshot (`gameInfo.occupiedSeats`) before the socket connects.
   */
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

            <div className="flex gap-3 mt-2">
              <button
                type="submit"
                disabled={isJoining || !displayName.trim() || selectedSeat === null}
                className="flex-1 py-3 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-800 disabled:text-gray-500 text-white font-medium rounded-md transition-colors shadow-[0_0_20px_rgba(79,70,229,0.3)] disabled:shadow-none"
              >
                {isJoining ? "Joining..." : "Join Game"}
              </button>
              <button
                type="button"
                onClick={handleWatchSubmit}
                disabled={isJoining || !displayName.trim()}
                className="flex-1 py-3 px-4 bg-gray-800 hover:bg-gray-700 disabled:bg-gray-900 disabled:text-gray-600 text-gray-300 font-medium rounded-md transition-colors border border-gray-700"
              >
                Watch
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  };

  // True only if the current player is the game host — gates host-only controls
  const isHost = gameState && playerId === gameState.hostPlayerId;
  const betweenHandsDelay = gameState?.config.betweenHandsDelay ?? gameInfo?.config.betweenHandsDelay;

  let currentBlindsInfo = null;
  if (gameState?.config.blindSchedule && gameState.config.blindSchedule.length > 0 && gameState.config.blindIncreaseInterval) {
    const displayHandNumber = Math.max(1, gameState.handNumber);
    const { smallBlind, bigBlind } = getCurrentBlinds(gameState.config, displayHandNumber);
    const interval = gameState.config.blindIncreaseInterval;
    const handsUntilIncrease = interval - ((displayHandNumber - 1) % interval);
    currentBlindsInfo = { smallBlind, bigBlind, handsUntilIncrease };
  }

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
          {isSpectator && (
            <span className="px-3 py-1 bg-blue-900/30 text-blue-400 border border-blue-700/50 rounded-full text-xs font-medium">
              Watching
            </span>
          )}
        </div>

        <div className="flex items-center space-x-6">
          <div className="text-sm text-gray-400 flex items-center">
            {currentBlindsInfo && (
              <>
                <span>
                  Blinds: <span className="text-white font-medium">{currentBlindsInfo.smallBlind}/{currentBlindsInfo.bigBlind}</span>
                  <span className="ml-1 text-xs text-gray-500">· Next increase in {currentBlindsInfo.handsUntilIncrease} hand{currentBlindsInfo.handsUntilIncrease !== 1 && 's'}</span>
                </span>
                <span className="mx-2 text-gray-600">|</span>
              </>
            )}
            <span>Players: <span className="text-white font-medium">{gameState?.players.filter(Boolean).length || gameInfo?.playerCount || 0}/{gameInfo?.maxPlayers || 0}</span></span>
            {(gameState?.spectators?.length ?? 0) > 0 && (
              <>
                <span className="mx-2 text-gray-600">|</span>
                <span>Watching: <span className="text-white font-medium">{gameState?.spectators.length}</span></span>
              </>
            )}
          </div>

          <div className="flex items-center space-x-3">
            {isSpectator && (
              <button
                onClick={() => setShowJoinModal(true)}
                className="px-4 py-1.5 bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-300 text-sm font-medium rounded border border-indigo-500/30 transition-colors"
              >
                Join Game
              </button>
            )}
            <button
              onClick={() => setShowInvite(true)}
              className="px-4 py-1.5 bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-300 text-sm font-medium rounded border border-indigo-500/30 transition-colors"
            >
              Invite
            </button>
            <button
              onClick={() => setShowHandHistory(true)}
              className="px-4 py-1.5 bg-gray-800 hover:bg-gray-700 text-white text-sm font-medium rounded border border-gray-700 transition-colors"
            >
              Hand History
            </button>
            <button
              onClick={() => setShowLedger(true)}
              className="px-4 py-1.5 bg-gray-800 hover:bg-gray-700 text-white text-sm font-medium rounded border border-gray-700 transition-colors"
            >
              Session Ledger
            </button>
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
            {betweenHandsDelay !== undefined && (
              <span className="text-xs text-gray-400 uppercase tracking-widest">
                Delay Between Hands: <span className="text-white font-medium normal-case">{betweenHandsDelay}s</span>
              </span>
            )}
          </div>
          <div className="flex items-center space-x-3">
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
            <button
              onClick={handleResetGame}
              className="px-4 py-1.5 bg-red-700 hover:bg-red-600 text-white text-sm font-medium rounded transition-colors"
            >
              Reset Game
            </button>
          </div>
        </div>
      )}

      <main className="flex-1 relative flex items-center justify-center">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(31,41,55,0.4)_0,rgba(3,7,18,1)_100%)] pointer-events-none"></div>
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[400px] bg-indigo-900/10 blur-[120px] rounded-full pointer-events-none"></div>
        
        {gameState && (playerId || spectatorId) ? (
          <div className="w-full h-full p-4 relative z-10">
            <PokerTable gameState={gameState} playerId={playerId ?? ""} onAction={handleAction} actionConfirmation={actionConfirmation} lastHandResult={lastHandResult} />
            {playerId && (() => {
              const activePlayers = gameState.players.filter(p => p && !p.isFolded);
              const isUncontestedWin = gameState.phase === GamePhase.Showdown && activePlayers.length === 1;
              const isWinner = isUncontestedWin && activePlayers[0]?.id === playerId;
              const hasShown = gameState.shownCards[playerId];
              const hasMucked = muckedHandNumber === gameState.handNumber;
              
              if (isWinner && !hasShown && !hasMucked) {
                return (
                  <div className="absolute bottom-8 w-full max-w-3xl left-1/2 -translate-x-1/2 z-50 px-4">
                    <ShowMuckActionBar onShow={handleShowCards} onMuck={handleMuckCards} />
                  </div>
                );
              }

              const startingStack = gameState.config.startingStack;
              const currentPlayer = gameState.players.find(p => p?.id === playerId);
              const playerChips = currentPlayer?.chips ?? 0;
              const isBetweenHands = gameState.phase === GamePhase.Waiting || gameState.phase === GamePhase.Showdown;
              const canRebuy = isBetweenHands && playerChips < startingStack;

              if (canRebuy) {
                const rebuyLabel = playerChips === 0 ? 'Rebuy' : 'Top Up';
                return (
                  <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-50">
                    <button
                      onClick={handleRebuy}
                      className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-lg shadow-lg transition-colors"
                    >
                      {rebuyLabel}
                    </button>
                  </div>
                );
              }

              return null;
            })()}
          </div>
        ) : (
          !showJoinModal && (
            <div className="text-gray-500 animate-pulse">Loading table...</div>
          )
        )}
      </main>

      {showJoinModal && renderJoinModal()}
      {showHandHistory && <HandHistory gameId={gameId} onClose={() => setShowHandHistory(false)} />}
      {showLedger && <SessionLedger gameId={gameId} onClose={() => setShowLedger(false)} gameState={gameState} lastHandResult={lastHandResult} />}
      {showInvite && <InviteShare gameUrl={typeof window !== 'undefined' ? window.location.href : ''} onClose={() => setShowInvite(false)} />}
      {(playerId || spectatorId) && (
        <ChatPanel
          messages={chatMessages}
          onSendMessage={handleSendChatMessage}
          isOpen={isChatOpen}
          onToggle={handleToggleChat}
          unreadCount={unreadCount}
          currentUserId={playerId ?? spectatorId}
        />
      )}
    </div>
  );
}
