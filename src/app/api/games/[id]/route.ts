/**
 * GET /api/games/[id]
 *
 * Returns a lightweight public snapshot of a game's current state.
 * Used by the game page on initial load to determine whether a seat-select
 * modal should be shown and which seats are already taken.
 *
 * Note: sensitive fields (player tokens, hole cards) are intentionally excluded.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getOrLoadGame } from '@/server/gameStore';

/**
 * Fetches game metadata by ID.
 *
 * Checks the in-memory `gameStore` first; falls back to loading from the DB
 * if the server restarted and the game was evicted from memory.
 *
 * @param _req  - Unused; required by Next.js route handler signature.
 * @param params.id - The game's UUID from the URL segment.
 *
 * @returns 200 with a public game snapshot:
 *   ```json
 *   {
 *     "id": "...",
 *     "config": { "maxPlayers", "smallBlind", "bigBlind", "startingStack", "timePerAction" },
 *     "phase": "waiting" | "preflop" | "flop" | "turn" | "river" | "showdown",
 *     "playerCount": number,
 *     "maxPlayers": number,
 *     "isPaused": boolean,
 *     "occupiedSeats": number[]   // 0-indexed seat numbers already taken
 *   }
 *   ```
 *          404 if no game with that ID exists.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params;
  const game = await getOrLoadGame(id);

  if (!game) {
    return NextResponse.json({ error: 'Game not found' }, { status: 404 });
  }

  return NextResponse.json({
    id: game.id,
    config: game.config,
    phase: game.phase,
    playerCount: game.players.length,
    maxPlayers: game.config.maxPlayers,
    isPaused: game.isPaused,
    // Seat indices let the join modal grey-out already-occupied seats
    // before the Socket.IO connection is established and live state is available
    occupiedSeats: game.players.map((player) => player.seatIndex),
  });
}
