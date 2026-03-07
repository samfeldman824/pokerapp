# Poker App

A real-time multiplayer Texas Hold'em poker application built with Next.js, Socket.IO, and PostgreSQL.

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Real-time**: Socket.IO
- **Database**: PostgreSQL via Drizzle ORM
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **Testing**: Vitest (unit), Playwright (e2e)
- **Runtime**: Bun / Node.js

---

## Prerequisites

- [Bun](https://bun.sh) or Node.js 20+
- [Docker](https://www.docker.com/) (for the database)

---

## Setup

### 1. Install dependencies

```bash
bun install
```

### 2. Configure environment

```bash
cp .env.example .env
```

The defaults in `.env.example` work out of the box with the Docker Compose database:

```
DATABASE_URL=postgresql://poker:poker@localhost:5433/pokerapp
PORT=3000
NODE_ENV=development
```

### 3. Start the database

```bash
docker compose up -d
```

### 4. Run database migrations

```bash
bunx drizzle-kit push:pg
```

---

## Development

Start the dev server (Next.js + Socket.IO, with hot reload):

```bash
bun dev
```

App will be available at [http://localhost:3000](http://localhost:3000).

---

## Production

Build, then start:

```bash
bun run build
bun start
```

---

## Restarting the Server

**Dev** — just kill the process (`Ctrl+C`) and re-run `bun dev`. Hot reload handles most changes automatically.

**Production** — rebuild if code changed, then restart:

```bash
bun run build && bun start
```

**Database only** — restart without rebuilding:

```bash
docker compose restart postgres
```

---

## Available Scripts

| Command | Description |
|---|---|
| `bun dev` | Start dev server with hot reload |
| `bun run build` | Build for production |
| `bun start` | Start production server |
| `bun test` | Run unit tests (Vitest) |
| `bun run test:watch` | Run unit tests in watch mode |
| `bun run type-check` | TypeScript type check (no emit) |
| `bun run lint` | ESLint |
| `bunx playwright test` | Run e2e tests |

---

## Database

| Command | Description |
|---|---|
| `docker compose up -d` | Start Postgres in background |
| `docker compose down` | Stop Postgres |
| `docker compose down -v` | Stop Postgres and wipe all data |
| `bunx drizzle-kit push:pg` | Push schema changes to DB |
| `bunx drizzle-kit studio` | Open Drizzle Studio (DB GUI) |

Postgres is exposed on **port 5433** (not the default 5432) to avoid conflicts with a local install.

---

## Project Structure

```
src/
├── app/          # Next.js App Router pages and layouts
├── components/   # React components
├── db/           # Drizzle schema, migrations, and DB client
├── engine/       # Core poker game logic (deck, betting, hand evaluation)
├── lib/          # Shared utilities
└── server/       # Socket.IO event handlers
server.ts         # Custom HTTP server entry point (Next.js + Socket.IO)
```

### Key Concepts

- **`server.ts`** — Single entry point that boots Next.js and attaches the Socket.IO server to the same HTTP server.
- **`src/engine/`** — Pure game logic with no framework dependencies. Fully unit tested.
- **`src/server/socketHandlers.ts`** — Maps Socket.IO events to game engine calls and persists state via Drizzle.
- **Database tables**: `games`, `players`, `hands`, `hand_actions`, `hand_results`

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `postgresql://poker:poker@localhost:5433/pokerapp` | Postgres connection string |
| `PORT` | `3000` | HTTP server port |
| `NODE_ENV` | `development` | `development` or `production` |
