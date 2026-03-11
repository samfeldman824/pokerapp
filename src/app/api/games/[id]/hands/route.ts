import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'

import { db } from '@/db'
import { games, handResults, hands, players } from '@/db/schema'

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const [game] = await db
    .select({ id: games.id })
    .from(games)
    .where(eq(games.id, params.id))
    .limit(1)

  if (!game) {
    return NextResponse.json({ error: 'Game not found' }, { status: 404 })
  }

  const handsRows = await db
    .select({
      id: hands.id,
      handNumber: hands.handNumber,
      potTotal: hands.potTotal,
      communityCards: hands.communityCards,
      completedAt: hands.completedAt,
    })
    .from(hands)
    .where(eq(hands.gameId, params.id))
    .orderBy(hands.handNumber)

  if (handsRows.length === 0) {
    return NextResponse.json([])
  }

  const allResultsRows = await db
    .select({
      handId: handResults.handId,
      displayName: players.displayName,
      winnings: handResults.winnings,
    })
    .from(handResults)
    .innerJoin(players, eq(handResults.playerId, players.id))
    .innerJoin(hands, eq(handResults.handId, hands.id))
    .where(eq(hands.gameId, params.id))

  const resultsByHandId = new Map<
    string,
    Array<{ displayName: string; winnings: number }>
  >()
  for (const row of allResultsRows) {
    const existing = resultsByHandId.get(row.handId) ?? []
    existing.push({ displayName: row.displayName, winnings: row.winnings })
    resultsByHandId.set(row.handId, existing)
  }

  const response = handsRows.map((hand) => {
    const allResults = resultsByHandId.get(hand.id) ?? []
    const winners = allResults.filter((r) => r.winnings > 0)

    return {
      handNumber: hand.handNumber,
      potTotal: hand.potTotal,
      communityCards: hand.communityCards,
      winners,
      completedAt: hand.completedAt,
    }
  })

  return NextResponse.json(response)
}
