import { NextRequest, NextResponse } from 'next/server';
import { getOrLoadGame } from '@/server/gameStore';

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params;
  const game = await getOrLoadGame(id);

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
    occupiedSeats: game.players.map((player) => player.seatIndex),
  });
}
