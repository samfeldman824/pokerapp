import { NextRequest, NextResponse } from 'next/server';
import { createGame } from '@/engine/gameController';
import { addPlayer, findPlayerById } from '@/engine/playerManager';
import { gameStore } from '@/server/gameStore';
import { saveGame, savePlayer } from '@/db/persistence';
import { GameConfig } from '@/engine/types';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { 
      smallBlind, 
      bigBlind, 
      startingStack, 
      timePerAction, 
      maxPlayers, 
      hostDisplayName, 
      hostSeatIndex 
    } = body;

    if (typeof smallBlind !== 'number' || smallBlind < 1) {
      return NextResponse.json({ error: 'smallBlind must be at least 1' }, { status: 400 });
    }
    if (typeof bigBlind !== 'number' || bigBlind < smallBlind * 2) {
      return NextResponse.json({ error: 'bigBlind must be at least smallBlind * 2' }, { status: 400 });
    }
    if (typeof startingStack !== 'number' || startingStack < bigBlind * 10) {
      return NextResponse.json({ error: 'startingStack must be at least bigBlind * 10' }, { status: 400 });
    }
    if (typeof maxPlayers !== 'number' || maxPlayers < 2 || maxPlayers > 9) {
      return NextResponse.json({ error: 'maxPlayers must be between 2 and 9' }, { status: 400 });
    }
    if (typeof timePerAction !== 'number' || timePerAction < 0 || timePerAction > 120) {
      return NextResponse.json({ error: 'timePerAction must be between 0 and 120' }, { status: 400 });
    }
    if (typeof hostDisplayName !== 'string' || !hostDisplayName.trim()) {
      return NextResponse.json({ error: 'hostDisplayName is required' }, { status: 400 });
    }
    if (typeof hostSeatIndex !== 'number' || hostSeatIndex < 0 || hostSeatIndex >= maxPlayers) {
      return NextResponse.json({ error: 'Invalid hostSeatIndex' }, { status: 400 });
    }

    const config: GameConfig = {
      smallBlind,
      bigBlind,
      startingStack,
      timePerAction,
      maxPlayers,
    };

    let game = createGame(config);

    const { game: updatedGame, token, playerId } = addPlayer(game, hostDisplayName, hostSeatIndex);
    game = updatedGame;

    game.hostPlayerId = playerId;

    await saveGame(game);
    const hostPlayer = findPlayerById(game, playerId);
    if (!hostPlayer) {
        return NextResponse.json({ error: 'Failed to create host player' }, { status: 500 });
    }
    await savePlayer(hostPlayer, game.id);

    gameStore.set(game.id, game);

    return NextResponse.json({ 
      gameId: game.id, 
      hostToken: token 
    }, { status: 201 });

  } catch (error) {
    console.error('Error creating game:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
