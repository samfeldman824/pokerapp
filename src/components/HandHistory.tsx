import { useEffect, useState } from 'react'

import type { Card } from '@/engine/types'
import type { HandHistoryDetail, HandHistoryPlayerBoardResult, HandHistorySummary } from '@/lib/handHistory'

type HandAction = {
  phase: string
  actionType: string
  amount: number | null
  displayName: string
  ordering: number
}

type HandHistoryProps = {
  gameId: string
  onClose: () => void
}

function formatChips(value: number): string {
  return `$${value.toLocaleString()}`
}

function formatAction(action: HandAction): string {
  const type = action.actionType.toLowerCase()
  switch (type) {
    case 'fold':
    case 'check':
      return type.charAt(0).toUpperCase() + type.slice(1)
    case 'call':
    case 'bet':
    case 'raise':
    case 'post_small_blind':
    case 'post_big_blind':
      const amountStr = action.amount ? ` $${action.amount}` : ''
      const typeStr = type.replace(/_/g, ' ')
      return typeStr.charAt(0).toUpperCase() + typeStr.slice(1) + amountStr
    default:
      return action.actionType
  }
}

function formatCard(card: Card): string {
  const suit = {
    clubs: 'c',
    diamonds: 'd',
    hearts: 'h',
    spades: 's',
  }[card.suit]

  return `${card.rank}${suit}`
}

function formatCards(cards: Card[]): string {
  if (cards.length === 0) {
    return 'No board dealt'
  }

  return cards.map(formatCard).join(' ')
}

function formatBoardResult(boardResult: HandHistoryPlayerBoardResult): string {
  const description = boardResult.handDescription ?? 'No showdown hand'
  const winnings = boardResult.winnings > 0 ? ` (+${formatChips(boardResult.winnings)})` : ''
  return `${description}${winnings}`
}

export function HandHistory({ gameId, onClose }: HandHistoryProps) {
  const [hands, setHands] = useState<HandHistorySummary[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [expandedHand, setExpandedHand] = useState<number | null>(null)
  const [detailsCache, setDetailsCache] = useState<Record<number, HandHistoryDetail>>({})
  const [loadingDetails, setLoadingDetails] = useState<Record<number, boolean>>({})

  useEffect(() => {
    let isMounted = true

    async function fetchHands() {
      try {
        setIsLoading(true)
        setError(null)
        const response = await fetch(`/api/games/${gameId}/hands`)
        if (!response.ok) throw new Error('Failed to load hand history')
        const data: HandHistorySummary[] = await response.json()
        if (isMounted) setHands(data.reverse())
      } catch (err) {
        if (isMounted) setError(err instanceof Error ? err.message : 'Failed to load hand history')
      } finally {
        if (isMounted) setIsLoading(false)
      }
    }

    void fetchHands()
    return () => { isMounted = false }
  }, [gameId])

  const toggleHand = async (handNumber: number) => {
    if (expandedHand === handNumber) {
      setExpandedHand(null)
      return
    }

    setExpandedHand(handNumber)

    if (!detailsCache[handNumber] && !loadingDetails[handNumber]) {
      setLoadingDetails(prev => ({ ...prev, [handNumber]: true }))
      try {
        const response = await fetch(`/api/games/${gameId}/hands/${handNumber}`)
        if (!response.ok) throw new Error('Failed to load hand detail')
          const data: HandHistoryDetail = await response.json()
        setDetailsCache(prev => ({ ...prev, [handNumber]: data }))
      } catch (err) {
        console.error(err)
      } finally {
        setLoadingDetails(prev => ({ ...prev, [handNumber]: false }))
      }
    }
  }

  return (
    <div className="fixed inset-0 z-[65] flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm">
      <div className="w-full max-w-4xl overflow-hidden rounded-3xl border border-white/10 bg-gray-950 shadow-[0_30px_90px_rgba(0,0,0,0.6)] flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-5 shrink-0">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-gray-500">Game Log</p>
            <h2 className="mt-2 text-3xl font-semibold text-white">Hand History</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/10 px-4 py-2 text-sm font-medium text-gray-300 transition-colors hover:border-white/20 hover:text-white"
          >
            Close
          </button>
        </div>

        <div className="px-6 py-5 overflow-y-auto flex-1">
          {isLoading ? (
            <div className="flex min-h-48 items-center justify-center">
              <div className="h-10 w-10 animate-spin rounded-full border-2 border-gray-700 border-t-amber-400" />
            </div>
          ) : error ? (
            <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-6 text-center text-rose-200">
              {error}
            </div>
          ) : hands.length === 0 ? (
            <div className="flex min-h-48 items-center justify-center text-gray-400">
              No hands played yet.
            </div>
          ) : (
            <div className="space-y-3">
              {hands.map((hand) => {
                const isExpanded = expandedHand === hand.handNumber
                const detail = detailsCache[hand.handNumber]
                const isLoadingDetail = loadingDetails[hand.handNumber]

                return (
                  <div key={hand.handNumber} className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02]">
                    <button
                      onClick={() => toggleHand(hand.handNumber)}
                      className="w-full flex items-center justify-between px-5 py-4 transition-colors hover:bg-white/[0.04]"
                    >
                      <div className="flex items-center gap-6">
                        <div className="text-left">
                          <div className="text-sm font-medium text-white">Hand #{hand.handNumber}</div>
                          <div className="text-xs text-gray-500 mt-0.5">
                            Pot: {formatChips(hand.potTotal)}
                          </div>
                        </div>
                        <div className="hidden sm:block text-left border-l border-white/10 pl-6">
                          <div className="text-xs uppercase tracking-wider text-gray-500">Boards</div>
                          <div className="mt-0.5 space-y-1 text-sm text-gray-300">
                            {hand.boards.map((board) => (
                              <div key={board.runIndex}>
                                <span className="text-gray-500">Run {board.runIndex + 1}:</span>{' '}
                                <span>{board.winners.length === 0
                                  ? formatCards(board.communityCards)
                                  : `${formatCards(board.communityCards)} • ${board.winners.map((winner) => `${winner.displayName} (+${formatChips(winner.winnings)})`).join(', ')}`}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                      <div className="text-gray-500 transition-transform duration-200" style={{ transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}>
                        ▼
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="border-t border-white/10 bg-black/40 px-5 py-4">
                        {isLoadingDetail ? (
                          <div className="flex justify-center py-4">
                            <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-700 border-t-amber-400" />
                          </div>
                        ) : detail ? (
                          <div className="space-y-6">
                            <div className="grid gap-3 sm:grid-cols-2">
                              {detail.boards.map((board) => (
                                <div key={board.runIndex} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                                  <div className="text-xs uppercase tracking-[0.2em] text-gray-500">Run {board.runIndex + 1}</div>
                                  <div className="mt-2 text-sm font-medium text-white">{formatCards(board.communityCards)}</div>
                                </div>
                              ))}
                            </div>

                            <div>
                              <h4 className="text-xs uppercase tracking-[0.2em] text-gray-500 mb-3">Action Timeline</h4>
                              <div className="space-y-4">
                                {Object.entries(
                                  detail.actions.reduce((acc, action) => {
                                    if (!acc[action.phase]) acc[action.phase] = []
                                    acc[action.phase].push(action)
                                    return acc
                                  }, {} as Record<string, HandAction[]>)
                                ).map(([phase, actions]) => (
                                  <div key={phase} className="relative pl-3 border-l-2 border-white/10 ml-2">
                                    <div className="absolute -left-1.5 top-0 w-3 h-3 rounded-full bg-gray-800 border-2 border-gray-600" />
                                    <h5 className="text-xs font-semibold text-amber-400/80 uppercase tracking-widest mb-2 ml-2 leading-none">
                                      {phase}
                                    </h5>
                                    <ul className="space-y-1 ml-2">
                                      {actions.map((action, idx) => (
                                        <li key={idx} className="text-sm flex items-baseline gap-2">
                                          <span className="text-white font-medium">{action.displayName}</span>
                                          <span className="text-gray-400">—</span>
                                          <span className="text-gray-300">{formatAction(action)}</span>
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                ))}
                                {detail.actions.length === 0 && (
                                  <div className="text-sm text-gray-500 ml-2">No actions recorded</div>
                                )}
                              </div>
                            </div>

                            <div>
                              <h4 className="text-xs uppercase tracking-[0.2em] text-gray-500 mb-3">Showdown Results</h4>
                              <div className="space-y-3">
                                {detail.results.map((result) => (
                                  <div key={result.displayName} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                                    <div className="flex flex-wrap items-center justify-between gap-3">
                                      <div>
                                        <div className="text-sm font-medium text-white">{result.displayName}</div>
                                        <div className="mt-1 text-xs text-gray-500">
                                          {result.holeCards ? formatCards(result.holeCards) : 'Folded / mucked'}
                                        </div>
                                      </div>
                                      <div className="text-sm font-medium text-emerald-300">
                                        {result.winnings > 0 ? `+${formatChips(result.winnings)}` : formatChips(result.winnings)}
                                      </div>
                                    </div>
                                    <div className="mt-3 space-y-1 text-sm text-gray-300">
                                      {result.boardResults.map((boardResult) => (
                                        <div key={boardResult.runIndex}>
                                          <span className="text-gray-500">Run {boardResult.runIndex + 1}:</span>{' '}
                                          <span>{formatBoardResult(boardResult)}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="text-sm text-rose-400">Failed to load hand details.</div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
