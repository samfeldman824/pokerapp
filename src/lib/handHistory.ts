import type { Card, CompletedHandBoard, PotAward } from '@/engine/types'

export type HandHistoryBoard = CompletedHandBoard & {
  winners: Array<{ displayName: string; winnings: number }>
}

export type HandHistorySummary = {
  handNumber: number
  potTotal: number
  boards: HandHistoryBoard[]
  completedAt: string | Date | null
}

export type HandHistoryAction = {
  phase: string
  actionType: string
  amount: number | null
  displayName: string
  ordering: number
}

export type HandHistoryPlayerBoardResult = {
  runIndex: 0 | 1
  handRank: number | null
  handDescription: string | null
  winnings: number
  potAwards: PotAward[]
}

export type HandHistoryResult = {
  displayName: string
  holeCards: Card[] | null
  winnings: number
  boardResults: HandHistoryPlayerBoardResult[]
}

export type HandHistoryDetail = {
  handNumber: number
  potTotal: number
  boards: CompletedHandBoard[]
  completedAt: string | Date | null
  actions: HandHistoryAction[]
  results: HandHistoryResult[]
}

type HandHistorySummaryRow = {
  id: string
  handNumber: number
  potTotal: number
  communityCards: unknown
  boards: unknown
  completedAt: string | Date | null
}

type HandHistoryResultSummaryRow = {
  handId: string
  displayName: string
  boardResults: unknown
  handRank: number | null
  handDescription: string | null
  winnings: number
}

type HandHistoryDetailRow = {
  handNumber: number
  potTotal: number
  communityCards: unknown
  boards: unknown
  completedAt: string | Date | null
}

type HandHistoryDetailResultRow = {
  displayName: string
  holeCards: unknown
  boardResults: unknown
  handRank: number | null
  handDescription: string | null
  winnings: number
}

export function normalizeCompletedHandBoards(
  boards: unknown,
  communityCards: unknown,
): CompletedHandBoard[] {
  if (Array.isArray(boards) && boards.length > 0) {
    return boards
      .map<CompletedHandBoard>((board) => ({
        runIndex: board?.runIndex === 1 ? 1 : 0,
        communityCards: Array.isArray(board?.communityCards) ? board.communityCards as Card[] : [],
      }))
      .sort((left, right) => left.runIndex - right.runIndex)
  }

  return [{ runIndex: 0, communityCards: Array.isArray(communityCards) ? communityCards as Card[] : [] }]
}

export function normalizePersistedBoardResults(
  boardResults: unknown,
  fallback: {
    handRank: number | null
    handDescription: string | null
    winnings: number
  },
): HandHistoryPlayerBoardResult[] {
  if (Array.isArray(boardResults) && boardResults.length > 0) {
    return boardResults
      .map<HandHistoryPlayerBoardResult>((boardResult) => ({
        runIndex: boardResult?.runIndex === 1 ? 1 : 0,
        handRank: typeof boardResult?.handRank === 'number' ? boardResult.handRank : null,
        handDescription: typeof boardResult?.handDescription === 'string' ? boardResult.handDescription : null,
        winnings: typeof boardResult?.winnings === 'number' ? boardResult.winnings : 0,
        potAwards: Array.isArray(boardResult?.potAwards) ? boardResult.potAwards as PotAward[] : [],
      }))
      .sort((left, right) => left.runIndex - right.runIndex)
  }

  return [{
    runIndex: 0,
    handRank: fallback.handRank,
    handDescription: fallback.handDescription,
    winnings: fallback.winnings,
    potAwards: [],
  }]
}

export function buildHandHistorySummaries(
  handsRows: HandHistorySummaryRow[],
  allResultsRows: HandHistoryResultSummaryRow[],
): HandHistorySummary[] {
  const resultsByHandId = new Map<string, HandHistoryResultSummaryRow[]>()

  for (const row of allResultsRows) {
    const existing = resultsByHandId.get(row.handId) ?? []
    existing.push(row)
    resultsByHandId.set(row.handId, existing)
  }

  return handsRows.map((hand) => {
    const allResults = resultsByHandId.get(hand.id) ?? []
    const boards = normalizeCompletedHandBoards(hand.boards, hand.communityCards)
    const winnersByRunIndex = new Map<number, Array<{ displayName: string; winnings: number }>>()

    for (const result of allResults) {
      const boardResults = normalizePersistedBoardResults(result.boardResults, {
        handRank: result.handRank,
        handDescription: result.handDescription,
        winnings: result.winnings,
      })

      for (const boardResult of boardResults) {
        if (boardResult.winnings <= 0) {
          continue
        }

        const winners = winnersByRunIndex.get(boardResult.runIndex) ?? []
        winners.push({ displayName: result.displayName, winnings: boardResult.winnings })
        winnersByRunIndex.set(boardResult.runIndex, winners)
      }
    }

    return {
      handNumber: hand.handNumber,
      potTotal: hand.potTotal,
      boards: boards.map((board) => ({
        ...board,
        winners: winnersByRunIndex.get(board.runIndex) ?? [],
      })),
      completedAt: hand.completedAt,
    }
  })
}

export function buildHandHistoryDetail(
  hand: HandHistoryDetailRow,
  actions: HandHistoryAction[],
  results: HandHistoryDetailResultRow[],
): HandHistoryDetail {
  return {
    handNumber: hand.handNumber,
    potTotal: hand.potTotal,
    boards: normalizeCompletedHandBoards(hand.boards, hand.communityCards),
    completedAt: hand.completedAt,
    actions,
    results: results.map((result) => ({
      displayName: result.displayName,
      holeCards: Array.isArray(result.holeCards) ? result.holeCards as Card[] : null,
      winnings: result.winnings,
      boardResults: normalizePersistedBoardResults(result.boardResults, {
        handRank: result.handRank,
        handDescription: result.handDescription,
        winnings: result.winnings,
      }),
    })),
  }
}
