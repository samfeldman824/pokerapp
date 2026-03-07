/**
 * Custom HTTP server entry point — boots Next.js and Socket.IO on the same port.
 *
 * Next.js normally runs on its own internal server, but it doesn't support WebSockets
 * out of the box. This file wraps Next.js in a plain Node.js `http.Server` so that
 * Socket.IO can be attached to the same HTTP server and share port 3000.
 *
 * Flow:
 *   1. `app.prepare()` compiles Next.js pages (or loads the production build).
 *   2. A raw `http.Server` is created with Next.js as the request handler.
 *   3. Socket.IO is attached to the same server.
 *   4. Each new socket connection is handed to `registerSocketHandlers`.
 *   5. The server starts listening on `PORT` (default 3000).
 *
 * This file is the production entry point (`bun start`) and the dev entry point
 * (`bun dev` via `next dev --turbo` with a custom server flag in package.json).
 */

import { createServer } from 'http'
import { parse } from 'url'
import next from 'next'
import { Server as SocketIOServer } from 'socket.io'
import { registerSocketHandlers } from './src/server/socketHandlers'

const dev = process.env.NODE_ENV !== 'production'
const app = next({ dev, dir: '.' })
const handle = app.getRequestHandler()
const PORT = parseInt(process.env.PORT || '3000', 10)

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true)
    handle(req, res, parsedUrl)
  })

  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  })

  io.on('connection', (socket) => {
    console.log('Socket connected:', socket.id)
    registerSocketHandlers(io, socket)
  })

  httpServer.listen(PORT, () => {
    console.log(`> Server listening on http://localhost:${PORT}`)
  })
})
