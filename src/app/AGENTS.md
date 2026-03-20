# APP ROUTER KNOWLEDGE BASE

## OVERVIEW
`src/app` owns page composition and thin REST endpoints; realtime gameplay still depends on the custom server and socket layer.

## STRUCTURE
```text
src/app/
├── layout.tsx
├── page.tsx
├── create/page.tsx       # Create-game flow; large form
├── game/[id]/page.tsx    # Main game room; large realtime page
└── api/games/...         # REST creation, lookup, ledger, hand history
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Change landing shell | `src/app/layout.tsx`, `src/app/page.tsx` | Standard App Router entry |
| Change create-game UX | `src/app/create/page.tsx` | Validation, presets, submit flow |
| Change game room behavior | `src/app/game/[id]/page.tsx` | REST bootstrap + socket lifecycle + host/player controls |
| Change game creation API | `src/app/api/games/route.ts` | Calls engine + persistence + store |
| Change game fetch/summary API | `src/app/api/games/[id]/route.ts` | Thin route; inherit parent patterns |
| Change ledger/hand history APIs | `src/app/api/games/[id]/ledger/route.ts`, `src/app/api/games/[id]/hands/route.ts` | Historical data endpoints |

## CONVENTIONS
- Keep route handlers thin: validate input, call engine/store/persistence helpers, return serialized result.
- Large page files coordinate many concerns; match existing local state and handler organization rather than scattering logic across ad hoc helpers.
- App code shares types from `src/engine/types.ts` and socket behavior through `src/lib/useGameSocket.ts`.

## ANTI-PATTERNS
- Do not duplicate game-rule logic inside routes or pages; move rule changes into `src/engine`.
- Do not treat `src/app/game/[id]/page.tsx` as a pure fetch-render page; it is the client coordinator for the socket session.
- Do not create deeper `AGENTS.md` files under `src/app/api/games/[id]` or `src/app/game/[id]` unless max depth is intentionally expanded.

## NOTES
- `src/app/game/[id]/page.tsx` is one of the repo's largest files and mixes join flow, banners, chat, rebuy, showdown choices, and host controls.
- API depth under `api/games` is meaningful, but current `/init-deep` depth limits keep documentation at this directory level.
