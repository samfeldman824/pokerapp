# COMPONENTS KNOWLEDGE BASE

## OVERVIEW
`src/components` contains reusable table, seat, chat, ledger, and history UI used by the game room rather than a generic design system.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Table layout | `src/components/PokerTable.tsx` | Main visual board wrapper |
| Player seat rendering | `src/components/PlayerSeat.tsx` | Seat-specific status and actions |
| Player action controls | `src/components/ActionBar.tsx` | Fold/call/bet/raise affordances |
| Community board | `src/components/CommunityCards.tsx` | Shared card display |
| Chat UI | `src/components/ChatPanel.tsx` | Pairs with server chat throttling |
| Ledger/history UI | `src/components/SessionLedger.tsx`, `src/components/HandHistory.tsx` | Historical views |
| Share/join affordances | `src/components/InviteShare.tsx` | Invite workflow |

## CONVENTIONS
- Component names are PascalCase and are domain-specific to poker play, not abstract primitives.
- Prefer feeding components already-shaped data from page/hooks instead of importing server or persistence details here.
- Behavior-heavy interactions usually originate in `src/app/game/[id]/page.tsx`; components mostly render and emit UI events.

## ANTI-PATTERNS
- Do not smuggle socket or DB logic directly into reusable components.
- Do not over-generalize poker-specific widgets into faux shared primitives unless multiple screens actually need that abstraction.

## NOTES
- There is one colocated component test: `src/components/communityCardReveal.test.ts`.
- If a component change needs new game semantics, update `src/engine/types.ts` and the page/hook wiring, not just the JSX.
