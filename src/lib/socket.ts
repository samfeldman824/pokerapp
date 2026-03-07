/**
 * Singleton Socket.IO client instance shared across the entire browser session.
 *
 * `autoConnect: false` means the socket does NOT connect on import. The game page
 * (`useGameSocket`) controls the connection lifecycle — it calls `socket.connect()`
 * on mount and `socket.disconnect()` on unmount. This prevents stale connections
 * when Next.js renders or hot-reloads multiple times during development.
 */

import { io, type Socket } from 'socket.io-client'

export const socket: Socket = io({ autoConnect: false })

export default socket
