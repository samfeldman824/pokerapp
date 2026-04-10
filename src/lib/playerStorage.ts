/**
 * playerStorage — abstraction over localStorage / sessionStorage for player identity.
 *
 * When "private session" mode is OFF (default), all reads/writes go to localStorage,
 * which is shared across tabs — the current behaviour.
 *
 * When "private session" mode is ON, reads/writes go to sessionStorage, which is
 * scoped to a single tab. This means each new tab that opens the same game URL
 * will not find a saved token and will present the Join Game modal instead of
 * auto-reconnecting.
 *
 * The private-session preference itself (`poker_private_session`) is always stored
 * in localStorage so the toggle state persists across tabs.
 */

const PRIVATE_SESSION_KEY = 'poker_private_session'

function getStorage(): Storage {
  if (typeof window === 'undefined') {
    throw new Error('Storage is not available outside of browser context')
  }
  return isPrivateSession() ? sessionStorage : localStorage
}

export function isPrivateSession(): boolean {
  if (typeof window === 'undefined') return true
  return localStorage.getItem(PRIVATE_SESSION_KEY) !== 'false'
}

export function setPrivateSession(enabled: boolean): void {
  const tokenKey = 'poker_token_'
  const playerKey = 'poker_player_'

  try {
    localStorage.setItem(PRIVATE_SESSION_KEY, enabled ? 'true' : 'false')

    if (enabled) {
      // Migrate any existing game credentials from localStorage into sessionStorage
      // so the current tab keeps working without interruption.
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i)
        if (!key) continue
        if (key.startsWith(tokenKey) || key.startsWith(playerKey)) {
          const value = localStorage.getItem(key)
          if (value) {
            try {
              sessionStorage.setItem(key, value)
              localStorage.removeItem(key)
            } catch {
              // Storage quota exceeded or private browsing mode — continue without migrating
            }
          }
        }
      }
    } else {
      // Migrate any sessionStorage credentials back to localStorage so other tabs
      // can pick them up again.
      for (let i = sessionStorage.length - 1; i >= 0; i--) {
        const key = sessionStorage.key(i)
        if (!key) continue
        if (key.startsWith(tokenKey) || key.startsWith(playerKey)) {
          const value = sessionStorage.getItem(key)
          if (value) {
            try {
              localStorage.setItem(key, value)
              sessionStorage.removeItem(key)
            } catch {
              // Storage quota exceeded or private browsing mode — continue without migrating
            }
          }
        }
      }
    }
  } catch {
    // localStorage unavailable (private browsing, storage quota) — silently fail
  }
}

export function getToken(gameId: string): string | null {
  if (typeof window === 'undefined') return null
  return getStorage().getItem(`poker_token_${gameId}`)
}

export function setToken(gameId: string, token: string): void {
  getStorage().setItem(`poker_token_${gameId}`, token)
}

export function getPlayerId(gameId: string): string | null {
  if (typeof window === 'undefined') return null
  return getStorage().getItem(`poker_player_${gameId}`)
}

export function setPlayerId(gameId: string, id: string): void {
  getStorage().setItem(`poker_player_${gameId}`, id)
}