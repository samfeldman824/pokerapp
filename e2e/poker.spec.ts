import { test, expect, BrowserContext, Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createGame(page: Page, options: { runItTwice?: boolean } = {}): Promise<string> {
  const { runItTwice = false } = options;
  const createResponse = await page.request.post('/api/games', {
    data: {
      hostDisplayName: 'Alice',
      hostSeatIndex: 0,
      smallBlind: 1,
      bigBlind: 2,
      startingStack: 1000,
      timePerAction: 30,
      betweenHandsDelay: 3,
      maxPlayers: 9,
      runItTwice,
    },
  });

  if (!createResponse.ok()) {
    throw new Error(`Failed to create game via API: ${createResponse.status()} ${createResponse.statusText()}`);
  }

  const data = await createResponse.json() as { gameId?: string; hostToken?: string };
  if (!data.gameId || !data.hostToken) {
    throw new Error('Invalid create game response payload');
  }

  await page.goto('/');
  await page.evaluate(
    ({ gameId, hostToken }: { gameId: string; hostToken: string }) => {
      localStorage.setItem(`poker_token_${gameId}`, hostToken);
    },
    { gameId: data.gameId, hostToken: data.hostToken },
  );

  await page.goto(`/game/${data.gameId}`);
  await page.waitForURL('**/game/**', { timeout: 30000 });

  const url = page.url();
  const match = url.match(/\/game\/([^/?#]+)/);
  if (!match) throw new Error(`Could not extract gameId from URL: ${url}`);
  return match[1];
}

async function joinGame(
  page: Page,
  gameId: string,
  name: string,
  seat: number,
): Promise<void> {
  await page.goto(`/game/${gameId}`);
  await expect(page.getByLabel('Display Name')).toBeVisible({ timeout: 10000 });
  await page.getByLabel('Display Name').fill(name);
  const seatBtn = page.getByRole('button', { name: `Seat ${seat + 1}` });
  await seatBtn.click();
  await page.getByRole('button', { name: /join game/i }).click();
  await expect(page.getByRole('heading', { name: /GAME #/i })).toBeVisible({ timeout: 10000 });
  await expect(page.getByLabel('Display Name')).not.toBeVisible({ timeout: 15000 });
}

function communityCardSlotSelector(
  index: number,
  cardState: 'revealed' | 'expected' | 'empty',
  revealState: 'entering' | 'settled' | 'idle',
): string {
  return `[data-testid="community-card-slot-${index}"][data-card-state="${cardState}"][data-reveal-state="${revealState}"]`;
}

function communityCardSlot(page: Page, index: number) {
  return page.getByTestId(`community-card-slot-${index}`);
}

async function waitForCommunityCardState(
  page: Page,
  index: number,
  cardState: 'revealed' | 'expected' | 'empty',
  revealState: 'entering' | 'settled' | 'idle',
  timeout: number,
): Promise<void> {
  await page.waitForSelector(communityCardSlotSelector(index, cardState, revealState), { timeout });
}

async function hasCommunityCardState(
  page: Page,
  index: number,
  cardState: 'revealed' | 'expected' | 'empty',
  revealState: 'entering' | 'settled' | 'idle',
): Promise<boolean> {
  return (await page.locator(communityCardSlotSelector(index, cardState, revealState)).count()) > 0;
}

async function expectCommunityCardState(
  page: Page,
  index: number,
  cardState: 'revealed' | 'expected' | 'empty',
  revealState: 'entering' | 'settled' | 'idle',
): Promise<void> {
  await expect(communityCardSlot(page, index)).toHaveAttribute('data-card-state', cardState);
  await expect(communityCardSlot(page, index)).toHaveAttribute('data-reveal-state', revealState);
}

async function closeContextSafely(context: BrowserContext): Promise<void> {
  try {
    await context.close();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes('ENOENT') ||
      message.includes('unexpected number of bytes') ||
      message.includes('End of central directory record signature not found')
    ) {
      return;
    }

    throw error;
  }
}

// ---------------------------------------------------------------------------
// Test 1: Community board reveal states through river
// ---------------------------------------------------------------------------
test('community board reveal settles through river', async ({ browser }) => {
  test.setTimeout(180000);
  const ctx1: BrowserContext = await browser.newContext();
  const ctx2: BrowserContext = await browser.newContext();
  const hostPage: Page = await ctx1.newPage();
  const guestPage: Page = await ctx2.newPage();
  const flopSettleTimeout = 1000;
  const turnRiverSettleTimeout = 800;

  try {
    const gameId = await createGame(hostPage);
    expect(gameId).toBeTruthy();

    await expect(hostPage.getByRole('heading', { name: /GAME #/i })).toBeVisible({ timeout: 30000 });
    await expect(hostPage.getByText(/waiting for host/i)).toBeVisible({ timeout: 30000 });

    await joinGame(guestPage, gameId, 'Bob', 1);

    await hostPage.getByRole('button', { name: /start game/i }).click();
    await expect(hostPage.getByText(/waiting for host/i)).not.toBeVisible({ timeout: 15000 });

    const communityCards = hostPage.getByTestId('community-cards');
    await expect(communityCards).toBeVisible({ timeout: 5000 });
    for (const slotIndex of [0, 1, 2, 3, 4]) {
      await expectCommunityCardState(hostPage, slotIndex, 'empty', 'idle');
    }

    const actionBarExists = await hostPage.getByRole('button', { name: /fold|check|call|raise|all-in/i }).count();
    expect(actionBarExists).toBeGreaterThan(0);

    await hostPage.screenshot({ path: '.sisyphus/evidence/task-6-preflop.png' });

    let activeHandCaptured = false;
    let sawExpected = false;
    let sawTurnEntering = false;
    let sawRiverEntering = false;
    let flopSettled = false;
    let turnSettled = false;
    let riverSettled = false;

    const actOnce = async (): Promise<boolean> => {
      const actions = [
        hostPage.getByRole('button', { name: /^check/i }),
        hostPage.getByRole('button', { name: /^call/i }),
        guestPage.getByRole('button', { name: /^check/i }),
        guestPage.getByRole('button', { name: /^call/i }),
        hostPage.getByRole('button', { name: /^fold/i }),
        guestPage.getByRole('button', { name: /^fold/i }),
      ];

      for (const action of actions) {
        if (await action.isEnabled()) {
          if (!activeHandCaptured) {
            await hostPage.screenshot({ path: '.sisyphus/evidence/task-6-active-hand.png' });
            activeHandCaptured = true;
          }
          await action.click();
          return true;
        }
      }

      return false;
    };

    const observeBoard = async (): Promise<void> => {
      for (let poll = 0; poll < 16; poll++) {
        if (!sawExpected && await hasCommunityCardState(hostPage, 2, 'expected', 'idle')) {
          sawExpected = true;
          await expectCommunityCardState(hostPage, 2, 'expected', 'idle');
        }

        if (!flopSettled && await hasCommunityCardState(hostPage, 2, 'revealed', 'settled')) {
          await waitForCommunityCardState(hostPage, 0, 'revealed', 'settled', flopSettleTimeout);
          await waitForCommunityCardState(hostPage, 1, 'revealed', 'settled', flopSettleTimeout);
          await waitForCommunityCardState(hostPage, 2, 'revealed', 'settled', flopSettleTimeout);
          await expectCommunityCardState(hostPage, 0, 'revealed', 'settled');
          await expectCommunityCardState(hostPage, 1, 'revealed', 'settled');
          await expectCommunityCardState(hostPage, 2, 'revealed', 'settled');
          await expectCommunityCardState(hostPage, 3, 'empty', 'idle');
          await expectCommunityCardState(hostPage, 4, 'empty', 'idle');
          await hostPage.screenshot({ path: '.sisyphus/evidence/task-4-board-flop-settled.png' });
          flopSettled = true;
        }

        if (!sawTurnEntering && await hasCommunityCardState(hostPage, 3, 'revealed', 'entering')) {
          sawTurnEntering = true;
          await expectCommunityCardState(hostPage, 3, 'revealed', 'entering');
        }

        if (sawTurnEntering && !turnSettled && await hasCommunityCardState(hostPage, 3, 'revealed', 'settled')) {
          await waitForCommunityCardState(hostPage, 3, 'revealed', 'settled', turnRiverSettleTimeout);
          await expectCommunityCardState(hostPage, 0, 'revealed', 'settled');
          await expectCommunityCardState(hostPage, 1, 'revealed', 'settled');
          await expectCommunityCardState(hostPage, 2, 'revealed', 'settled');
          await expectCommunityCardState(hostPage, 3, 'revealed', 'settled');
          await expectCommunityCardState(hostPage, 4, 'empty', 'idle');
          turnSettled = true;
        }

        if (!sawRiverEntering && await hasCommunityCardState(hostPage, 4, 'revealed', 'entering')) {
          sawRiverEntering = true;
          await expectCommunityCardState(hostPage, 4, 'revealed', 'entering');
        }

        if (sawRiverEntering && !riverSettled && await hasCommunityCardState(hostPage, 4, 'revealed', 'settled')) {
          await waitForCommunityCardState(hostPage, 4, 'revealed', 'settled', turnRiverSettleTimeout);
          await expectCommunityCardState(hostPage, 0, 'revealed', 'settled');
          await expectCommunityCardState(hostPage, 1, 'revealed', 'settled');
          await expectCommunityCardState(hostPage, 2, 'revealed', 'settled');
          await expectCommunityCardState(hostPage, 3, 'revealed', 'settled');
          await expectCommunityCardState(hostPage, 4, 'revealed', 'settled');
          await hostPage.screenshot({ path: '.sisyphus/evidence/task-4-board-full-settled.png' });
          riverSettled = true;
        }

        if (riverSettled) {
          return;
        }

        await hostPage.waitForTimeout(25);
      }
    };

    const actionDeadlineMs = 90000;
    const actionStartTime = Date.now();
    let actionsTaken = 0;

    while (!riverSettled && (Date.now() - actionStartTime) < actionDeadlineMs) {
      const acted = await actOnce();
      if (acted) {
        actionsTaken += 1;
      }

      await observeBoard();
      if (!riverSettled) {
        await hostPage.waitForTimeout(acted ? 150 : 250);
      }
    }

    expect(actionsTaken).toBeGreaterThan(0);

    expect(sawExpected).toBeTruthy();
    expect(flopSettled).toBeTruthy();
    expect(sawTurnEntering).toBeTruthy();
    expect(turnSettled).toBeTruthy();
    expect(sawRiverEntering).toBeTruthy();
    expect(riverSettled).toBeTruthy();
    await expect(communityCards).toBeVisible({ timeout: 5000 });

    const hostConnected = await hostPage.locator('text=Connected').count();
    const guestConnected = await guestPage.locator('text=Connected').count();
    expect(hostConnected + guestConnected).toBeGreaterThan(0);
  } finally {
    await closeContextSafely(ctx1);
    await closeContextSafely(ctx2);
  }
});

// ---------------------------------------------------------------------------
// Test 2: Reconnection with stored token
// ---------------------------------------------------------------------------
test('player reconnects to game using stored token after page reload', async ({ browser }) => {
  const ctx: BrowserContext = await browser.newContext();
  const page: Page = await ctx.newPage();

  try {
    // Create a game (which stores hostToken in localStorage)
    const gameId = await createGame(page);

    // Verify the token was stored
    const token = await page.evaluate(
      (id: string) => localStorage.getItem(`poker_token_${id}`),
      gameId,
    );
    expect(token).toBeTruthy();

    // Reload the page to simulate reconnection
    await page.reload();
    await page.waitForURL(`**/game/${gameId}`);

    // Because a token exists in localStorage, the page should NOT show the join modal
    // Instead it should attempt to rejoin automatically. Wait for the table to appear
    // (or stay at the game page without the modal).
    await expect(page.getByLabel('Display Name')).not.toBeVisible({ timeout: 10000 });

    // The game page header should still show the game ID
    await expect(page.getByText(/GAME/)).toBeVisible({ timeout: 5000 });

    // Token should still be in localStorage after reload
    const tokenAfter = await page.evaluate(
      (id: string) => localStorage.getItem(`poker_token_${id}`),
      gameId,
    );
    expect(tokenAfter).toBeTruthy();
    expect(tokenAfter).toEqual(token);
  } finally {
    await closeContextSafely(ctx);
  }
});

// ---------------------------------------------------------------------------
// Test 3: Host controls — pause / resume
// ---------------------------------------------------------------------------
test('host can pause and resume the game', async ({ browser }) => {
  const ctx1: BrowserContext = await browser.newContext();
  const ctx2: BrowserContext = await browser.newContext();
  const hostPage: Page = await ctx1.newPage();
  const guestPage: Page = await ctx2.newPage();

  try {
    const gameId = await createGame(hostPage);
    await joinGame(guestPage, gameId, 'Carol', 1);

    // Host starts the game so it's not in "waiting" state
    await hostPage.getByRole('button', { name: /start game/i }).click();
    await expect(hostPage.getByText(/waiting for host/i)).not.toBeVisible({ timeout: 15000 });

    // The Pause button should now be visible to the host
    const pauseBtn = hostPage.getByRole('button', { name: /^pause$/i });
    await expect(pauseBtn).toBeVisible({ timeout: 5000 });

    // Click Pause
    await pauseBtn.click();

    // Button label should change to "Resume"
    await expect(hostPage.getByRole('button', { name: /^resume$/i })).toBeVisible({
      timeout: 5000,
    });

    // Click Resume
    await hostPage.getByRole('button', { name: /^resume$/i }).click();

    // Button label should change back to "Pause"
    await expect(hostPage.getByRole('button', { name: /^pause$/i })).toBeVisible({
      timeout: 5000,
    });
  } finally {
    await closeContextSafely(ctx1);
    await closeContextSafely(ctx2);
  }
});

// ---------------------------------------------------------------------------
// Test 4: Join flow edge cases
// ---------------------------------------------------------------------------
test('game page loads correctly and rejects invalid game IDs', async ({ page }) => {
  // 4a: Valid game page loads
  const gameId = await createGame(page);
  await page.goto(`/game/${gameId}`);
  await expect(page.getByText(/GAME/)).toBeVisible({ timeout: 5000 });

  // 4b: Invalid game ID shows an error
  await page.goto('/game/nonexistent-game-id-xyz');
  // Should show "Game not found" or redirect to home
  const gameNotFound = await page.getByText(/game not found/i).count();
  const returnHome = await page.getByRole('link', { name: /return home/i }).count();
  expect(gameNotFound + returnHome).toBeGreaterThan(0);
});

test('all-in: opponent sees an enabled Call button and can finish the round', async ({ browser }) => {
  const ctx1: BrowserContext = await browser.newContext();
  const ctx2: BrowserContext = await browser.newContext();
  const alicePage: Page = await ctx1.newPage();
  const bobPage: Page = await ctx2.newPage();

  try {
    const gameId = await createGame(alicePage);
    await joinGame(bobPage, gameId, 'Bob', 1);

    await alicePage.getByRole('button', { name: /start game/i }).click();
    await expect(alicePage.getByText(/waiting for host/i)).not.toBeVisible({ timeout: 15000 });

    const aliceRaise = alicePage.getByRole('button', { name: /^raise/i });
    const aliceAllIn = alicePage.getByRole('button', { name: /^all-in/i });
    await expect(aliceRaise).toBeEnabled({ timeout: 15000 });
    await aliceRaise.click();
    await expect(aliceAllIn).toBeEnabled({ timeout: 5000 });
    await aliceAllIn.click();
    await expect(aliceRaise).toBeEnabled({ timeout: 5000 });
    await aliceRaise.click();

    const callButton = bobPage.getByRole('button', { name: /^call/i }).first();
    await expect(callButton).toBeVisible({ timeout: 15000 });
    await expect(callButton).toBeEnabled();

    await callButton.click();

    await alicePage.waitForTimeout(1000);
    const aliveAfter =
      (await alicePage.locator('text=Connected').count()) +
      (await bobPage.locator('text=Connected').count());
    expect(aliveAfter).toBeGreaterThan(0);
  } finally {
    await closeContextSafely(ctx1);
    await closeContextSafely(ctx2);
  }
});

test('occupied seat is disabled in join modal', async ({ browser }) => {
  const ctx1: BrowserContext = await browser.newContext();
  const ctx2: BrowserContext = await browser.newContext();
  const hostPage: Page = await ctx1.newPage();
  const guestPage: Page = await ctx2.newPage();

  try {
    const gameId = await createGame(hostPage);
    await guestPage.goto(`/game/${gameId}`);
    await guestPage.getByLabel('Display Name').fill('Dave');

    await expect(guestPage.getByText(/players:/i)).toBeVisible({ timeout: 5000 });
    await expect(guestPage.getByText(/1\//)).toBeVisible({ timeout: 8000 });

    const seat1Btn = guestPage.getByRole('button', { name: 'Seat 1' });
    await expect(seat1Btn).toBeDisabled({ timeout: 5000 });
  } finally {
    await closeContextSafely(ctx1);
    await closeContextSafely(ctx2);
  }
});

test('run it twice flow emits board results twice before final hand result', async ({ browser }) => {
  test.setTimeout(180000);

  const ctx1: BrowserContext = await browser.newContext();
  const ctx2: BrowserContext = await browser.newContext();
  const hostPage: Page = await ctx1.newPage();
  const guestPage: Page = await ctx2.newPage();

  const socketTimeline: Array<'runItTwiceStarted' | 'boardResult' | 'hand-result'> = [];
  const seenFramePayloads = new Set<string>();

  const attachSocketCapture = (page: Page) => {
    page.on('websocket', (ws) => {
      ws.on('framereceived', ({ payload }) => {
        if (typeof payload !== 'string') return;

        // De-duplicate retransmitted frames while preserving first-seen order.
        if (seenFramePayloads.has(payload)) return;
        seenFramePayloads.add(payload);

        if (payload.includes('"runItTwiceStarted"')) {
          socketTimeline.push('runItTwiceStarted');
        }
        if (payload.includes('"boardResult"')) {
          socketTimeline.push('boardResult');
        }
        if (payload.includes('"hand-result"')) {
          socketTimeline.push('hand-result');
        }
      });
    });
  };

  try {
    attachSocketCapture(hostPage);

    const gameId = await createGame(hostPage, { runItTwice: true });
    await joinGame(guestPage, gameId, 'Bob', 1);

    await hostPage.getByRole('button', { name: /start game/i }).click();
    await expect(hostPage.getByText(/waiting for host/i)).not.toBeVisible({ timeout: 15000 });

    const hostFold = hostPage.getByRole('button', { name: /^fold$/i }).first();
    const guestFold = guestPage.getByRole('button', { name: /^fold$/i }).first();
    const hostActs = await hostFold.isVisible() && await hostFold.isEnabled();
    const actingPage = hostActs ? hostPage : guestPage;
    const respondingPage = actingPage === hostPage ? guestPage : hostPage;

    const raiseButton = actingPage.getByRole('button', { name: /^raise/i }).first();
    const allInButton = actingPage.getByRole('button', { name: /^all-in/i }).first();
    await expect(raiseButton).toBeEnabled({ timeout: 15000 });
    await raiseButton.click();
    await expect(allInButton).toBeEnabled({ timeout: 10000 });
    await allInButton.click();
    await expect(raiseButton).toBeEnabled({ timeout: 10000 });
    await raiseButton.click();

    const callButton = respondingPage.getByRole('button', { name: /^call/i }).first();
    await expect(callButton).toBeEnabled({ timeout: 15000 });
    await callButton.click();

    await expect(hostPage.getByText('Run 1', { exact: true })).toBeVisible({ timeout: 20000 });
    await expect(hostPage.getByText('Run 2', { exact: true })).toBeVisible({ timeout: 20000 });

    await expect.poll(
      () => socketTimeline.filter((eventName) => eventName === 'boardResult').length,
      { timeout: 45000 }
    ).toBeGreaterThanOrEqual(2);

    await expect.poll(
      () => socketTimeline.includes('hand-result'),
      { timeout: 45000 }
    ).toBeTruthy();

    await expect(hostPage.getByText(/Run 1 Awards/i)).toBeVisible({ timeout: 20000 });
    await expect(hostPage.getByText(/Run 2 Awards/i)).toBeVisible({ timeout: 20000 });

    const runStartedAt = socketTimeline.indexOf('runItTwiceStarted');
    const firstBoardAt = socketTimeline.indexOf('boardResult');
    const handResultAt = socketTimeline.indexOf('hand-result');

    expect(runStartedAt).toBeGreaterThanOrEqual(0);
    expect(firstBoardAt).toBeGreaterThan(runStartedAt);
    expect(handResultAt).toBeGreaterThan(firstBoardAt);
    expect(socketTimeline.slice(0, handResultAt).filter((eventName) => eventName === 'boardResult').length).toBeGreaterThanOrEqual(2);
  } finally {
    await closeContextSafely(ctx1);
    await closeContextSafely(ctx2);
  }
});
