/**
 * GET /api/games/[id]/ledger
 *
 * Returns the session ledger — a per-player accounting of chips brought in vs. carried out.
 *
 * Data source strategy (DB + live merge):
 *   - The DB stores the "settled" ledger rows written when players leave or the session ends.
 *     `chipsCarriedOut` is null for players still seated (they haven't cashed out yet).
 *   - The in-memory `gameStore` holds the live chip counts for the current session.
 *   - This handler merges the two: if a player is currently in the live game, their real-time
 *     chip count replaces the DB value so the ledger reflects the current state mid-session.
 *   - `netResult` is null for players still at the table (can't finalize until they leave).
 */

import { NextResponse } from 'next/server'

import { getSessionLedger } from '@/db/persistence'
import { gameStore } from '@/server/gameStore'

/**
 * Fetches and returns the merged session ledger for a game.
 *
 * @param params.id - The game's UUID from the URL segment.
 *
 * @returns 200 with an array of ledger entries:
 *   ```json
 *   [
 *     {
 *       "playerId": "...",
 *       "displayName": "...",
 *       "chipsBroughtIn": number,
 *       "chipsCarriedOut": number | null,  // null = player still seated
 *       "netResult": number | null          // null = player still seated
 *     }
 *   ]
 *   ```
 */
export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  // Load the persisted ledger rows from the DB
  const ledger = await getSessionLedger(params.id)

  // Build a fast lookup of live chip counts from the in-memory game (if it's running)
  const liveGame = gameStore.get(params.id)
  const currentChipsByPlayerId = new Map(
    liveGame?.players.map((player) => [player.id, player.chips]) ?? [],
  )

  // Merge live chips into DB rows so mid-session balances reflect real-time state.
  // If the player is no longer in the live game (left or game ended), fall back to
  // whatever `chipsCarriedOut` the DB recorded at exit time.
  const mergedLedger = ledger.map((entry) => {
    const liveChips = currentChipsByPlayerId.get(entry.playerId)
    const chipsCarriedOut = liveChips ?? entry.chipsCarriedOut

    return {
      ...entry,
      chipsCarriedOut,
      // null means the player is still seated; finalized only on exit
      netResult:
        chipsCarriedOut === null
          ? null
          : chipsCarriedOut - entry.chipsBroughtIn,
    }
  })

  return NextResponse.json(mergedLedger)
}
