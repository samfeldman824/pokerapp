# SERVER KNOWLEDGE BASE

## OVERVIEW
`src/server` owns realtime orchestration: Socket.IO events, per-game locking, in-memory caching, timers, and broadcast flow around the pure engine.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Wire/review socket events | `src/server/socketHandlers.ts` | Central realtime coordinator |
| Change cache/locking behavior | `src/server/gameStore.ts` | `withLock(...)` is critical |
| Inspect socket regression coverage | `src/server/socketHandlers.test.ts` | Largest test file in repo |

## CONVENTIONS
- Follow the established sequence inside handlers: acquire lock, load state, call engine, persist, broadcast.
- Keep shared mutable state behind `gameStore`; socket handlers should not mutate global maps ad hoc.
- Server code bridges engine, persistence, and sockets; keep those boundaries explicit.

## ANTI-PATTERNS
- Do not mutate a game's state outside the store lock.
- Do not embed poker-rule decisions here when they belong in `src/engine`.
- Do not forget persistence updates after state mutation; server behavior assumes reloadable snapshots.

## NOTES
- `socketHandlers.ts` handles join/start/action/pause/resume/rebuy/disconnect plus timers and chat rate limits.
- This directory is small in file count but very high in behavioral centrality.
