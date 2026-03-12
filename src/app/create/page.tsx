"use client";

/**
 * CreateGamePage — /create
 *
 * Form page that lets a user configure and start a new poker game.
 *
 * Responsibilities:
 *   1. Collect game config (blinds, stack, table size, timer) and host details.
 *   2. Client-side validate all fields before hitting the network.
 *   3. POST to /api/games, receive { gameId, hostToken }.
 *   4. Store the host token in localStorage so the game page can auto-authenticate
 *      the host's Socket.IO connection without a login step.
 *   5. Redirect to /game/[id].
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

/** Field-level error map — keys match formData keys plus a `general` slot for network errors. */
interface FormErrors {
  hostDisplayName?: string;
  hostSeatIndex?: string;
  smallBlind?: string;
  bigBlind?: string;
  startingStack?: string;
  timePerAction?: string;
  betweenHandsDelay?: string;
  maxPlayers?: string;
  blindIncreaseInterval?: string;
  general?: string;
}

const BLIND_PRESETS = {
  turbo: {
    interval: 5,
    schedule: [
      { smallBlind: 1, bigBlind: 2 },
      { smallBlind: 2, bigBlind: 4 },
      { smallBlind: 3, bigBlind: 6 },
      { smallBlind: 5, bigBlind: 10 },
      { smallBlind: 10, bigBlind: 20 },
      { smallBlind: 25, bigBlind: 50 },
    ],
  },
  normal: {
    interval: 10,
    schedule: [
      { smallBlind: 1, bigBlind: 2 },
      { smallBlind: 2, bigBlind: 4 },
      { smallBlind: 5, bigBlind: 10 },
      { smallBlind: 10, bigBlind: 20 },
      { smallBlind: 25, bigBlind: 50 },
      { smallBlind: 50, bigBlind: 100 },
    ],
  },
  slow: {
    interval: 20,
    schedule: [
      { smallBlind: 1, bigBlind: 2 },
      { smallBlind: 2, bigBlind: 4 },
      { smallBlind: 5, bigBlind: 10 },
      { smallBlind: 10, bigBlind: 20 },
    ],
  },
};

export default function CreateGamePage() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});

  const [formData, setFormData] = useState({
    hostDisplayName: "",
    hostSeatIndex: 0,
    smallBlind: 1,
    bigBlind: 2,
    startingStack: 1000,
    timePerAction: 30,
    betweenHandsDelay: 3,
    maxPlayers: 9,
    enableBlindSchedule: false,
    blindSchedulePreset: "normal" as "turbo" | "normal" | "slow",
    blindIncreaseInterval: 10,
  });

  /**
   * Generic change handler for all form inputs.
   * Coerces number inputs to `number` type (HTML inputs always yield strings).
   * Also clears the specific field's error as the user types, preventing stale error messages.
   */
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === "number" || type === "range" ? Number(value) : value,
    }));
    // Clear field-specific error when user types
    if (errors[name as keyof FormErrors]) {
      setErrors((prev) => ({ ...prev, [name]: undefined, general: undefined }));
    }
  };

  const handleCheckboxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, checked } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: checked,
    }));
  };

  const handlePresetChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const preset = e.target.value as "turbo" | "normal" | "slow";
    setFormData((prev) => ({
      ...prev,
      blindSchedulePreset: preset,
      blindIncreaseInterval: BLIND_PRESETS[preset].interval,
    }));
  };

  /**
   * Client-side validation. Mirrors the server-side rules in /api/games/route.ts
   * so users get instant feedback without a round-trip.
   *
   * Rules:
   *   - hostDisplayName: required, max 20 chars
   *   - hostSeatIndex: must be within [0, maxPlayers)
   *   - smallBlind: ≥ 1
   *   - bigBlind: ≥ 2 and ≥ smallBlind * 2
   *   - startingStack: ≥ 20 and ≥ bigBlind * 10
   *   - timePerAction: 0–120 (0 = unlimited)
   *   - betweenHandsDelay: 2–15
   *   - maxPlayers: 2–9
   *
   * @returns true if all fields pass, false if any errors were set.
   */
  const validate = (): boolean => {
    const newErrors: FormErrors = {};

    if (!formData.hostDisplayName.trim()) {
      newErrors.hostDisplayName = "Display name is required.";
    } else if (formData.hostDisplayName.length > 20) {
      newErrors.hostDisplayName = "Max 20 characters.";
    }

    if (formData.hostSeatIndex < 0 || formData.hostSeatIndex >= formData.maxPlayers) {
      newErrors.hostSeatIndex = `Seat must be between 0 and ${formData.maxPlayers - 1}.`;
    }

    if (formData.smallBlind < 1) {
      newErrors.smallBlind = "Must be at least 1.";
    }

    if (formData.bigBlind < 2) {
      newErrors.bigBlind = "Must be at least 2.";
    } else if (formData.bigBlind < formData.smallBlind * 2) {
      newErrors.bigBlind = "Big blind must be at least 2x small blind.";
    }

    if (formData.startingStack < 20) {
      newErrors.startingStack = "Must be at least 20.";
    } else if (formData.startingStack < formData.bigBlind * 10) {
      newErrors.startingStack = "Starting stack must be at least 10x big blind.";
    }

    if (formData.timePerAction < 0 || formData.timePerAction > 120) {
      newErrors.timePerAction = "Must be between 0 and 120.";
    }

    if (formData.betweenHandsDelay < 2 || formData.betweenHandsDelay > 15) {
      newErrors.betweenHandsDelay = "Must be between 2 and 15 seconds.";
    }

    if (formData.maxPlayers < 2 || formData.maxPlayers > 9) {
      newErrors.maxPlayers = "Max players must be between 2 and 9.";
    }

    if (formData.enableBlindSchedule) {
      if (formData.blindIncreaseInterval < 1 || formData.blindIncreaseInterval > 100) {
        newErrors.blindIncreaseInterval = "Must be between 1 and 100 hands.";
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  /**
   * Form submit handler.
   *
   * Flow:
   *   1. Run client-side validation; bail early on failure.
   *   2. POST form data to /api/games.
   *   3. On success, persist the host token to localStorage then navigate to the game.
   *      The token key follows the pattern `poker_token_<gameId>` — the game page reads
   *      it on mount to auto-authenticate this browser as the host via Socket.IO.
   *   4. On failure, surface the server's error message in the `general` error slot.
   */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setIsSubmitting(true);
    setErrors({});

    try {
      const payload: any = { ...formData };
      if (formData.enableBlindSchedule) {
        payload.blindSchedule = BLIND_PRESETS[formData.blindSchedulePreset].schedule;
        payload.blindIncreaseInterval = formData.blindIncreaseInterval;
      } else {
        delete payload.blindSchedule;
        delete payload.blindIncreaseInterval;
      }
      delete payload.enableBlindSchedule;
      delete payload.blindSchedulePreset;

      const res = await fetch("/api/games", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to create game");
      }

      if (data.gameId && data.hostToken) {
        localStorage.setItem(`poker_token_${data.gameId}`, data.hostToken);
        router.push(`/game/${data.gameId}`);
      } else {
        throw new Error("Invalid response from server");
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "An unknown error occurred";
      setErrors({ general: errorMessage });
      setIsSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-300 relative overflow-hidden font-sans py-12 px-6">
      {/* Atmosphere */}
      <div className="absolute top-0 right-0 w-full h-full pointer-events-none bg-[radial-gradient(circle_at_100%_0%,#451a03,transparent_50%)] opacity-30"></div>
      
      <div className="max-w-xl mx-auto relative z-10">
        <div className="mb-10">
          <Link href="/" className="inline-flex items-center text-zinc-500 hover:text-amber-500 transition-colors text-sm uppercase tracking-widest font-semibold mb-6">
            <span className="mr-2">←</span> Back to Lobby
          </Link>
          <h1 className="text-4xl md:text-5xl font-serif font-bold text-white tracking-tight">
            Configure <span className="text-amber-500 italic">Table</span>
          </h1>
          <p className="text-zinc-500 mt-2 text-lg">Set the rules and deal the cards.</p>
        </div>

        <div className="bg-zinc-900/50 border border-zinc-800/80 p-8 shadow-2xl backdrop-blur-md">
          {errors.general && (
            <div className="mb-6 p-4 bg-red-950/50 border border-red-900/50 text-red-400 text-sm font-medium">
              {errors.general}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            
            {/* Player Info Section */}
            <div className="space-y-6 pb-6 border-b border-zinc-800/50">
              <h2 className="text-xs uppercase tracking-widest text-emerald-500 font-bold mb-4">Player Details</h2>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label htmlFor="hostDisplayName" className="block text-sm font-medium text-zinc-400 mb-2">
                    Your Name
                  </label>
                  <input
                    type="text"
                    id="hostDisplayName"
                    name="hostDisplayName"
                    value={formData.hostDisplayName}
                    onChange={handleChange}
                    placeholder="Enter your display name"
                    className={`w-full bg-zinc-950/50 border ${errors.hostDisplayName ? 'border-red-500/50 focus:border-red-500' : 'border-zinc-800 focus:border-amber-500/50'} px-4 py-3 text-white placeholder-zinc-700 outline-none transition-colors`}
                  />
                  {errors.hostDisplayName && <p className="mt-1.5 text-xs text-red-500 font-medium">{errors.hostDisplayName}</p>}
                </div>

                <div>
                  <label htmlFor="hostSeatIndex" className="block text-sm font-medium text-zinc-400 mb-2">
                    Your Seat (0-{formData.maxPlayers - 1})
                  </label>
                  <input
                    type="number"
                    id="hostSeatIndex"
                    name="hostSeatIndex"
                    value={formData.hostSeatIndex}
                    onChange={handleChange}
                    min={0}
                    max={formData.maxPlayers - 1}
                    className={`w-full bg-zinc-950/50 border ${errors.hostSeatIndex ? 'border-red-500/50 focus:border-red-500' : 'border-zinc-800 focus:border-amber-500/50'} px-4 py-3 text-white outline-none transition-colors`}
                  />
                  {errors.hostSeatIndex && <p className="mt-1.5 text-xs text-red-500 font-medium">{errors.hostSeatIndex}</p>}
                </div>
              </div>
            </div>

            {/* Game Rules Section */}
            <div className="space-y-6 pt-2">
              <h2 className="text-xs uppercase tracking-widest text-amber-500 font-bold mb-4">Game Rules</h2>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label htmlFor="maxPlayers" className="block text-sm font-medium text-zinc-400 mb-2">
                    Max Players
                  </label>
                  <input
                    type="number"
                    id="maxPlayers"
                    name="maxPlayers"
                    value={formData.maxPlayers}
                    onChange={handleChange}
                    min={2}
                    max={9}
                    className={`w-full bg-zinc-950/50 border ${errors.maxPlayers ? 'border-red-500/50 focus:border-red-500' : 'border-zinc-800 focus:border-amber-500/50'} px-4 py-3 text-white outline-none transition-colors`}
                  />
                  {errors.maxPlayers && <p className="mt-1.5 text-xs text-red-500 font-medium">{errors.maxPlayers}</p>}
                </div>

                <div>
                  <label htmlFor="startingStack" className="block text-sm font-medium text-zinc-400 mb-2">
                    Starting Stack
                  </label>
                  <input
                    type="number"
                    id="startingStack"
                    name="startingStack"
                    value={formData.startingStack}
                    onChange={handleChange}
                    min={20}
                    className={`w-full bg-zinc-950/50 border ${errors.startingStack ? 'border-red-500/50 focus:border-red-500' : 'border-zinc-800 focus:border-amber-500/50'} px-4 py-3 text-white outline-none transition-colors`}
                  />
                  {errors.startingStack && <p className="mt-1.5 text-xs text-red-500 font-medium">{errors.startingStack}</p>}
                </div>

                <div>
                  <label htmlFor="smallBlind" className="block text-sm font-medium text-zinc-400 mb-2">
                    Small Blind
                  </label>
                  <input
                    type="number"
                    id="smallBlind"
                    name="smallBlind"
                    value={formData.smallBlind}
                    onChange={handleChange}
                    min={1}
                    className={`w-full bg-zinc-950/50 border ${errors.smallBlind ? 'border-red-500/50 focus:border-red-500' : 'border-zinc-800 focus:border-amber-500/50'} px-4 py-3 text-white outline-none transition-colors`}
                  />
                  {errors.smallBlind && <p className="mt-1.5 text-xs text-red-500 font-medium">{errors.smallBlind}</p>}
                </div>

                <div>
                  <label htmlFor="bigBlind" className="block text-sm font-medium text-zinc-400 mb-2">
                    Big Blind
                  </label>
                  <input
                    type="number"
                    id="bigBlind"
                    name="bigBlind"
                    value={formData.bigBlind}
                    onChange={handleChange}
                    min={2}
                    className={`w-full bg-zinc-950/50 border ${errors.bigBlind ? 'border-red-500/50 focus:border-red-500' : 'border-zinc-800 focus:border-amber-500/50'} px-4 py-3 text-white outline-none transition-colors`}
                  />
                  {errors.bigBlind && <p className="mt-1.5 text-xs text-red-500 font-medium">{errors.bigBlind}</p>}
                </div>

                <div className="md:col-span-2">
                  <label htmlFor="timePerAction" className="block text-sm font-medium text-zinc-400 mb-2">
                    Time Per Action (seconds, 0 = no limit)
                  </label>
                  <input
                    type="number"
                    id="timePerAction"
                    name="timePerAction"
                    value={formData.timePerAction}
                    onChange={handleChange}
                    min={0}
                    max={120}
                    className={`w-full bg-zinc-950/50 border ${errors.timePerAction ? 'border-red-500/50 focus:border-red-500' : 'border-zinc-800 focus:border-amber-500/50'} px-4 py-3 text-white outline-none transition-colors`}
                  />
                  {errors.timePerAction && <p className="mt-1.5 text-xs text-red-500 font-medium">{errors.timePerAction}</p>}
                </div>

                <div className="md:col-span-2">
                  <div className="flex items-center justify-between mb-2 gap-4">
                    <label htmlFor="betweenHandsDelay" className="block text-sm font-medium text-zinc-400">
                      Delay Between Hands
                    </label>
                    <span className="text-sm font-semibold text-amber-400">{formData.betweenHandsDelay}s</span>
                  </div>
                  <input
                    type="range"
                    id="betweenHandsDelay"
                    name="betweenHandsDelay"
                    value={formData.betweenHandsDelay}
                    onChange={handleChange}
                    min={2}
                    max={15}
                    className="w-full accent-amber-500"
                  />
                  <div className="mt-2 flex justify-between text-xs uppercase tracking-widest text-zinc-600">
                    <span>2s</span>
                    <span>15s</span>
                  </div>
                  {errors.betweenHandsDelay && <p className="mt-1.5 text-xs text-red-500 font-medium">{errors.betweenHandsDelay}</p>}
                </div>

                <div className="md:col-span-2 pt-2 border-t border-zinc-800/50">
                  <div className="flex items-center justify-between mb-4">
                    <label className="block text-sm font-medium text-zinc-400">Enable Blind Increases</label>
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        name="enableBlindSchedule"
                        checked={formData.enableBlindSchedule}
                        onChange={handleCheckboxChange}
                        className="w-4 h-4 accent-amber-500 cursor-pointer"
                      />
                      <span className="text-sm text-zinc-400">Blinds increase over time</span>
                    </label>
                  </div>

                  {formData.enableBlindSchedule && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-zinc-950/30 p-4 border border-zinc-800/50 mt-4">
                      <div>
                        <label htmlFor="blindSchedulePreset" className="block text-sm font-medium text-zinc-400 mb-2">
                          Schedule Preset
                        </label>
                        <select
                          id="blindSchedulePreset"
                          name="blindSchedulePreset"
                          value={formData.blindSchedulePreset}
                          onChange={handlePresetChange}
                          className="w-full bg-zinc-950/50 border border-zinc-800 focus:border-amber-500/50 px-4 py-3 text-white outline-none transition-colors appearance-none cursor-pointer"
                        >
                          <option value="turbo">Turbo (Fast jumps)</option>
                          <option value="normal">Normal (Standard jumps)</option>
                          <option value="slow">Slow (Gradual jumps)</option>
                        </select>
                      </div>
                      
                      <div>
                        <label htmlFor="blindIncreaseInterval" className="block text-sm font-medium text-zinc-400 mb-2">
                          Increase Every N Hands
                        </label>
                        <input
                          type="number"
                          id="blindIncreaseInterval"
                          name="blindIncreaseInterval"
                          value={formData.blindIncreaseInterval}
                          onChange={handleChange}
                          min={1}
                          max={100}
                          className={`w-full bg-zinc-950/50 border ${errors.blindIncreaseInterval ? 'border-red-500/50 focus:border-red-500' : 'border-zinc-800 focus:border-amber-500/50'} px-4 py-3 text-white outline-none transition-colors`}
                        />
                        {errors.blindIncreaseInterval && <p className="mt-1.5 text-xs text-red-500 font-medium">{errors.blindIncreaseInterval}</p>}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="pt-6">
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full relative group flex items-center justify-center px-8 py-4 font-bold text-zinc-950 bg-amber-500 hover:bg-amber-400 transition-all duration-300 disabled:opacity-50 disabled:hover:bg-amber-500 disabled:cursor-not-allowed"
              >
                {!isSubmitting && <span className="absolute inset-0 border border-amber-300 scale-100 opacity-0 group-hover:opacity-100 group-hover:scale-[1.02] transition-all duration-300"></span>}
                <span className="tracking-widest uppercase text-base">
                  {isSubmitting ? "Creating..." : "Start Game"}
                </span>
              </button>
            </div>
            
          </form>
        </div>
      </div>
    </main>
  );
}
