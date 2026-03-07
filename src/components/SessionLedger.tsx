import { useEffect, useState } from 'react'

type LedgerEntry = {
  playerId: string
  displayName: string
  chipsBroughtIn: number
  chipsCarriedOut: number | null
  netResult: number | null
}

type SessionLedgerProps = {
  gameId: string
  onClose: () => void
}

function formatChips(value: number | null): string {
  if (value === null) {
    return '--'
  }

  return value.toLocaleString()
}

function netResultClass(value: number | null): string {
  if (value === null) {
    return 'text-gray-400'
  }

  if (value > 0) {
    return 'text-emerald-400'
  }

  if (value < 0) {
    return 'text-rose-400'
  }

  return 'text-gray-200'
}

export function SessionLedger({ gameId, onClose }: SessionLedgerProps) {
  const [entries, setEntries] = useState<LedgerEntry[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let isMounted = true

    async function fetchLedger() {
      try {
        setIsLoading(true)
        setError(null)

        const response = await fetch(`/api/games/${gameId}/ledger`)

        if (!response.ok) {
          throw new Error('Failed to load ledger')
        }

        const data: LedgerEntry[] = await response.json()

        if (isMounted) {
          setEntries(data)
        }
      } catch (fetchError) {
        if (isMounted) {
          setError(fetchError instanceof Error ? fetchError.message : 'Failed to load ledger')
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    void fetchLedger()

    return () => {
      isMounted = false
    }
  }, [gameId])

  return (
    <div className="fixed inset-0 z-[65] flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm">
      <div className="w-full max-w-4xl overflow-hidden rounded-3xl border border-white/10 bg-gray-950 shadow-[0_30px_90px_rgba(0,0,0,0.6)]">
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-5">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-gray-500">Session Ledger</p>
            <h2 className="mt-2 text-3xl font-semibold text-white">Chip Accounting</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/10 px-4 py-2 text-sm font-medium text-gray-300 transition-colors hover:border-white/20 hover:text-white"
          >
            Close
          </button>
        </div>

        <div className="px-6 py-5">
          {isLoading ? (
            <div className="flex min-h-48 items-center justify-center">
              <div className="h-10 w-10 animate-spin rounded-full border-2 border-gray-700 border-t-amber-400" />
            </div>
          ) : error ? (
            <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-6 text-center text-rose-200">
              {error}
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-white/10">
              <table className="min-w-full divide-y divide-white/10">
                <thead className="bg-white/[0.04] text-left text-xs uppercase tracking-[0.25em] text-gray-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Player Name</th>
                    <th className="px-4 py-3 font-medium">Chips Brought In</th>
                    <th className="px-4 py-3 font-medium">Chips Now</th>
                    <th className="px-4 py-3 font-medium">Net Result</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10 bg-black/20 text-sm text-gray-200">
                  {entries.map((entry) => (
                    <tr key={entry.playerId} className="transition-colors hover:bg-white/[0.03]">
                      <td className="px-4 py-3 font-medium text-white">{entry.displayName}</td>
                      <td className="px-4 py-3">{formatChips(entry.chipsBroughtIn)}</td>
                      <td className="px-4 py-3">{formatChips(entry.chipsCarriedOut)}</td>
                      <td className={`px-4 py-3 font-semibold ${netResultClass(entry.netResult)}`}>
                        {entry.netResult === null
                          ? '--'
                          : `${entry.netResult > 0 ? '+' : ''}${entry.netResult.toLocaleString()}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
