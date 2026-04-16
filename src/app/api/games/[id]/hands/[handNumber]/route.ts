import { and, asc, eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'

import { db } from '@/db'
import { games, handActions, handResults, hands, players } from '@/db/schema'
import { buildHandHistoryDetail } from '@/lib/handHistory'

export async function GET(
  _request: Request,
  { params }: { params: { id: string; handNumber: string } },
) {
  const handNumberInt = parseInt(params.handNumber, 10)
  if (isNaN(handNumberInt)) {
    return NextResponse.json({ error: 'Hand not found' }, { status: 404 })
  }

  const [game] = await db
    .select({ id: games.id })
    .from(games)
    .where(eq(games.id, params.id))
    .limit(1)

  if (!game) {
    return NextResponse.json({ error: 'Game not found' }, { status: 404 })
  }

  const [hand] = await db
    .select({
      id: hands.id,
      handNumber: hands.handNumber,
      potTotal: hands.potTotal,
      communityCards: hands.communityCards,
      boards: hands.boards,
      completedAt: hands.completedAt,
    })
    .from(hands)
    .where(and(eq(hands.gameId, params.id), eq(hands.handNumber, handNumberInt)))
    .limit(1)

  if (!hand) {
    return NextResponse.json({ error: 'Hand not found' }, { status: 404 })
  }

  const actionsRows = await db
    .select({
      phase: handActions.phase,
      actionType: handActions.actionType,
      amount: handActions.amount,
      displayName: players.displayName,
      ordering: handActions.ordering,
    })
    .from(handActions)
    .innerJoin(players, eq(handActions.playerId, players.id))
    .where(eq(handActions.handId, hand.id))
    .orderBy(asc(handActions.ordering))

  const resultsRows = await db
    .select({
      displayName: players.displayName,
      holeCards: handResults.holeCards,
      boardResults: handResults.boardResults,
      handRank: handResults.handRank,
      handDescription: handResults.handDescription,
      winnings: handResults.winnings,
    })
    .from(handResults)
    .innerJoin(players, eq(handResults.playerId, players.id))
    .where(eq(handResults.handId, hand.id))

  const response = buildHandHistoryDetail(hand, actionsRows, resultsRows)

  return NextResponse.json(response)
}
