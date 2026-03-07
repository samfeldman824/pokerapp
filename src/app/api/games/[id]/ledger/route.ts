import { NextResponse } from 'next/server'

import { getSessionLedger } from '@/db/persistence'
import { gameStore } from '@/server/gameStore'

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const ledger = await getSessionLedger(params.id)
  const liveGame = gameStore.get(params.id)
  const currentChipsByPlayerId = new Map(
    liveGame?.players.map((player) => [player.id, player.chips]) ?? [],
  )

  const mergedLedger = ledger.map((entry) => {
    const liveChips = currentChipsByPlayerId.get(entry.playerId)
    const chipsCarriedOut = liveChips ?? entry.chipsCarriedOut

    return {
      ...entry,
      chipsCarriedOut,
      netResult:
        chipsCarriedOut === null
          ? null
          : chipsCarriedOut - entry.chipsBroughtIn,
    }
  })

  return NextResponse.json(mergedLedger)
}
