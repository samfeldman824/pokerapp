import { useEffect, useState } from 'react'

type InviteShareProps = {
  gameUrl: string
  onClose: () => void
}

export function InviteShare({ gameUrl, onClose }: InviteShareProps) {
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string>('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    async function generateQR() {
      try {
        const { default: QRCode } = await import('qrcode')
        const dataUrl = await QRCode.toDataURL(gameUrl, {
          width: 256,
          margin: 2,
          color: {
            dark: '#FFFFFF',
            light: '#00000000'
          }
        })
        setQrCodeDataUrl(dataUrl)
      } catch (err) {
        console.error('Error generating QR code:', err)
      }
    }
    
    if (gameUrl) {
      generateQR()
    }
  }, [gameUrl])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(gameUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy URL:', err)
    }
  }

  return (
    <div className="fixed inset-0 z-[65] flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm">
      <div className="w-full max-w-md overflow-hidden rounded-3xl border border-white/10 bg-gray-950 shadow-[0_30px_90px_rgba(0,0,0,0.6)]">
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-5">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-gray-500">Invite Players</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">Share Game Link</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/10 px-4 py-2 text-sm font-medium text-gray-300 transition-colors hover:border-white/20 hover:text-white"
          >
            Close
          </button>
        </div>

        <div className="px-6 py-8 flex flex-col items-center">
          {qrCodeDataUrl ? (
            <div className="mb-8 rounded-2xl bg-white/5 p-4 border border-white/10 shadow-[0_0_30px_rgba(255,255,255,0.05)]">
              <img src={qrCodeDataUrl} alt="Game Invite QR Code" className="w-48 h-48" />
            </div>
          ) : (
            <div className="mb-8 h-48 w-48 flex items-center justify-center rounded-2xl bg-white/5 border border-white/10">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-700 border-t-amber-400" />
            </div>
          )}

          <div className="w-full">
            <label className="block text-xs uppercase tracking-[0.2em] text-gray-500 mb-2 font-medium">
              Game URL
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={gameUrl}
                className="flex-1 rounded-lg border border-white/10 bg-black/40 px-4 py-3 text-sm text-gray-300 focus:outline-none focus:border-white/20"
                onClick={(e) => e.currentTarget.select()}
              />
              <button
                onClick={handleCopy}
                className={`flex shrink-0 items-center justify-center rounded-lg px-6 py-3 text-sm font-medium transition-colors ${
                  copied
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    : 'bg-indigo-600 text-white hover:bg-indigo-500 border border-indigo-500'
                }`}
                style={{ minWidth: '110px' }}
              >
                {copied ? 'Copied!' : 'Copy Link'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
