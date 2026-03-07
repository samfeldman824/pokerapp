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
