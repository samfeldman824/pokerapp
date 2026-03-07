import { NextRequest, NextResponse } from 'next/server';
import { gameStore } from '@/server/gameStore';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params;
  const game = gameStore.get(id);

  if (!game) {
    return NextResponse.json({ error: 'Game not found' }, { status: 404 });
  }

  return NextResponse.json({
    id: game.id,
    config: game.config,
    phase: game.phase,
    playerCount: game.players.length,
    maxPlayers: game.config.maxPlayers,
    isPaused: game.isPaused,
  });
}
