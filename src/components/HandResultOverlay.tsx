import { useEffect } from 'react'

import { Card as PlayingCard, ClientPlayerState, HandResult } from '@/engine/types'

import { Card } from '@/components/Card'

type HandResultOverlayProps = {
  results: HandResult[]
  players: (ClientPlayerState | null)[]
  onClose: () => void
}

function formatWinnings(winnings: number): string {
  if (winnings > 0) {
    return `+$${winnings}`
  }

  if (winnings < 0) {
    return `-$${Math.abs(winnings)}`
  }

  return '$0'
}

function renderCards(cards: [PlayingCard, PlayingCard] | null) {
  if (!cards) {
    return <span className="text-sm text-gray-500">Folded before showdown</span>
  }

  return (
    <div className="flex items-center gap-2">
      <Card card={cards[0]} size="sm" />
      <Card card={cards[1]} size="sm" />
    </div>
  )
}

export function HandResultOverlay({ results, players, onClose }: HandResultOverlayProps) {
  useEffect(() => {
    const timeoutId = window.setTimeout(onClose, 8000)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [onClose])

  const playersById = new Map(
    players.filter((player): player is ClientPlayerState => player !== null).map((player) => [player.id, player]),
  )

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 px-4 backdrop-blur-sm">
      <div className="w-full max-w-3xl overflow-hidden rounded-3xl border border-amber-500/20 bg-gray-950 shadow-[0_24px_80px_rgba(0,0,0,0.55)]">
        <div className="border-b border-white/10 bg-[radial-gradient(circle_at_top,rgba(245,158,11,0.2),transparent_60%)] px-6 py-5">
          <p className="text-xs uppercase tracking-[0.35em] text-amber-300/80">Hand Complete</p>
          <h2 className="mt-2 text-3xl font-semibold text-white">Showdown Results</h2>
        </div>

        <div className="max-h-[65vh] space-y-3 overflow-y-auto px-6 py-5">
          {results.map((result) => {
            const player = playersById.get(result.playerId)
            const isWinner = result.winnings > 0

            return (
              <div
                key={result.playerId}
                className="grid gap-4 rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-4 md:grid-cols-[minmax(0,1.4fr)_auto_auto] md:items-center"
              >
                <div>
                  <div className="flex items-center gap-3">
                    <h3 className="text-lg font-medium text-white">{player?.displayName ?? 'Unknown Player'}</h3>
                    {isWinner && (
                      <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold uppercase tracking-[0.22em] text-emerald-300">
                        Winner
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-sm text-gray-300">
                    {result.evaluation?.description ?? 'Folded before showdown'}
                  </p>
                </div>

                <div>{renderCards(result.holeCards)}</div>

                <div className="text-left md:text-right">
                  <p className="text-xs uppercase tracking-[0.28em] text-gray-500">Winnings</p>
                  <p className={`mt-1 text-xl font-semibold ${isWinner ? 'text-emerald-400' : 'text-gray-300'}`}>
                    {formatWinnings(result.winnings)}
                  </p>
                </div>
              </div>
            )
          })}
        </div>

        <div className="flex justify-end border-t border-white/10 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-amber-400/30 bg-amber-400/10 px-5 py-2 text-sm font-semibold uppercase tracking-[0.2em] text-amber-200 transition-colors hover:bg-amber-400/20"
          >
            Next Hand
          </button>
        </div>
      </div>
    </div>
  )
}
