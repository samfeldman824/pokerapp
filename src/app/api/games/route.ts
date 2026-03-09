/**
 * POST /api/games
 *
 * Creates a new poker game and registers the host as the first player.
 *
 * Flow:
 *   1. Validate all incoming config fields (blinds, stack, seats, timer).
 *   2. Call `createGame` (engine) to build an in-memory game state.
 *   3. Call `addPlayer` (engine) to seat the host and generate their auth token.
 *   4. Persist both the game and host player to the database.
 *   5. Register the game in the in-memory `gameStore` so Socket.IO can reach it instantly.
 *   6. Return the game ID and host token to the client.
 *      The client stores the token in localStorage under `poker_token_<gameId>` and
 *      uses it to re-authenticate when reconnecting via Socket.IO.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createGame } from '@/engine/gameController';
import { addPlayer, findPlayerById } from '@/engine/playerManager';
import { gameStore } from '@/server/gameStore';
import { saveGame, savePlayer } from '@/db/persistence';
import { GameConfig } from '@/engine/types';

/**
 * Handles game creation requests.
 *
 * @param req - Incoming Next.js request. Expects a JSON body with:
 *   - `smallBlind`       {number} - Small blind amount (min 1)
 *   - `bigBlind`         {number} - Big blind amount (min smallBlind * 2)
 *   - `startingStack`    {number} - Each player's starting chip count (min bigBlind * 10)
 *   - `timePerAction`    {number} - Seconds per player action; 0 means no limit (0–120)
 *   - `maxPlayers`       {number} - Table size (2–9)
 *   - `hostDisplayName`  {string} - The host's display name (non-empty)
 *   - `hostSeatIndex`    {number} - Which seat (0-indexed) the host occupies
 *
 * @returns 201 with `{ gameId, hostToken }` on success.
 *          400 with `{ error }` for any validation failure.
 *          500 with `{ error }` if game creation throws unexpectedly.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { 
      smallBlind, 
      bigBlind, 
      startingStack, 
      timePerAction, 
      betweenHandsDelay,
      maxPlayers, 
      hostDisplayName, 
      hostSeatIndex 
    } = body;

    // --- Input validation ---
    // Each rule mirrors the engine constraints so errors surface before any state is created.
    if (typeof smallBlind !== 'number' || smallBlind < 1) {
      return NextResponse.json({ error: 'smallBlind must be at least 1' }, { status: 400 });
    }
    if (typeof bigBlind !== 'number' || bigBlind < smallBlind * 2) {
      return NextResponse.json({ error: 'bigBlind must be at least smallBlind * 2' }, { status: 400 });
    }
    if (typeof startingStack !== 'number' || startingStack < bigBlind * 10) {
      return NextResponse.json({ error: 'startingStack must be at least bigBlind * 10' }, { status: 400 });
    }
    if (typeof maxPlayers !== 'number' || maxPlayers < 2 || maxPlayers > 9) {
      return NextResponse.json({ error: 'maxPlayers must be between 2 and 9' }, { status: 400 });
    }
    if (typeof timePerAction !== 'number' || timePerAction < 0 || timePerAction > 120) {
      return NextResponse.json({ error: 'timePerAction must be between 0 and 120' }, { status: 400 });
    }
    if (typeof betweenHandsDelay !== 'number' || betweenHandsDelay < 2 || betweenHandsDelay > 15) {
      return NextResponse.json({ error: 'betweenHandsDelay must be between 2 and 15' }, { status: 400 });
    }
    if (typeof hostDisplayName !== 'string' || !hostDisplayName.trim()) {
      return NextResponse.json({ error: 'hostDisplayName is required' }, { status: 400 });
    }
    if (typeof hostSeatIndex !== 'number' || hostSeatIndex < 0 || hostSeatIndex >= maxPlayers) {
      return NextResponse.json({ error: 'Invalid hostSeatIndex' }, { status: 400 });
    }

    const config: GameConfig = {
      smallBlind,
      bigBlind,
      startingStack,
      timePerAction,
      betweenHandsDelay,
      maxPlayers,
    };

    // Build the initial game state (phase: "waiting", no hands dealt yet)
    let game = createGame(config);

    // Seat the host and receive their opaque auth token.
    // The token is a secret shared only with this player's browser — used to
    // verify identity on Socket.IO reconnects without a login system.
    const { game: updatedGame, token, playerId } = addPlayer(game, hostDisplayName, hostSeatIndex);
    game = updatedGame;

    // Mark this player as the game host so the client can render host controls
    game.hostPlayerId = playerId;

    // Persist to DB so the game survives server restarts
    await saveGame(game);
    const hostPlayer = findPlayerById(game, playerId);
    if (!hostPlayer) {
        return NextResponse.json({ error: 'Failed to create host player' }, { status: 500 });
    }
    await savePlayer(hostPlayer, game.id);

    // Register in the in-memory store for immediate Socket.IO access
    // (avoids an extra DB round-trip when the host's socket connects moments later)
    gameStore.set(game.id, game);

    return NextResponse.json({ 
      gameId: game.id, 
      hostToken: token 
    }, { status: 201 });

  } catch (error) {
    console.error('Error creating game:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
