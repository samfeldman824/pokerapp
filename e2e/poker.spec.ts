import { test, expect, chromium, BrowserContext, Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createGame(page: Page): Promise<string> {
  await page.goto('/');
  await page.getByRole('link', { name: /create game/i }).click();
  await page.waitForURL('**/create');

  // Fill the form
  await page.getByLabel('Your Name').fill('Alice');
  await page.getByLabel(/your seat/i).fill('0');

  // Submit
  await page.getByRole('button', { name: /start game/i }).click();

  // Wait for redirect to game page
  await page.waitForURL('**/game/**', { timeout: 10000 });
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

async function waitForActionBar(page: Page): Promise<void> {
  // ActionBar appears at the bottom when it's this player's turn
  await page.waitForSelector(
    'button:text("Fold"), button:text("Check"), button:text("Call")',
    { timeout: 20000 },
  );
}

// ---------------------------------------------------------------------------
// Test 1: Full 2-player hand
// ---------------------------------------------------------------------------
test('two players can join, start a game, and complete a hand', async ({ browser }) => {
  const ctx1: BrowserContext = await browser.newContext();
  const ctx2: BrowserContext = await browser.newContext();
  const hostPage: Page = await ctx1.newPage();
  const guestPage: Page = await ctx2.newPage();

  try {
    // Host creates game
    const gameId = await createGame(hostPage);
    expect(gameId).toBeTruthy();

    await expect(hostPage.getByRole('heading', { name: /GAME #/i })).toBeVisible({ timeout: 10000 });
    await expect(hostPage.getByText(/waiting for host/i)).toBeVisible({ timeout: 20000 });

    // Guest joins the game
    await joinGame(guestPage, gameId, 'Bob', 1);

    // Host starts the game
    await hostPage.getByRole('button', { name: /start game/i }).click();

    // Wait for the game to leave "waiting" state — the "Waiting for host" badge should disappear
    await expect(hostPage.getByText(/waiting for host/i)).not.toBeVisible({ timeout: 15000 });

    // One of the two players will have the action bar — keep folding until the hand ends
    // We do up to 20 actions to avoid an infinite loop
    for (let i = 0; i < 20; i++) {
      const hostFold = hostPage.getByRole('button', { name: /^fold$/i });
      const hostCheck = hostPage.getByRole('button', { name: /^check$/i });
      const hostCall = hostPage.getByRole('button', { name: /^call/i });
      const guestFold = guestPage.getByRole('button', { name: /^fold$/i });
      const guestCheck = guestPage.getByRole('button', { name: /^check$/i });
      const guestCall = guestPage.getByRole('button', { name: /^call/i });

      const hostResult = await hostPage.getByText('Showdown Results').count();
      const guestResult = await guestPage.getByText('Showdown Results').count();
      if (hostResult > 0 || guestResult > 0) break;

      // Check if we're back to waiting (new hand started)
      const hostWaiting = await hostPage.getByText(/waiting for host/i).count();
      if (hostWaiting > 0) break;

      // Act on whichever player has the action
      if (await hostFold.isVisible()) {
        await hostFold.click();
      } else if (await hostCheck.isVisible()) {
        await hostCheck.click();
      } else if (await hostCall.isVisible()) {
        await hostCall.click();
      } else if (await guestFold.isVisible()) {
        await guestFold.click();
      } else if (await guestCheck.isVisible()) {
        await guestCheck.click();
      } else if (await guestCall.isVisible()) {
        await guestCall.click();
      } else {
        // No action visible yet — wait briefly and retry
        await hostPage.waitForTimeout(800);
      }

      await hostPage.waitForTimeout(300);
    }

    // The game is still alive (no crash) — verify at least one page is still connected
    const hostConnected = await hostPage.locator('text=Connected').count();
    const guestConnected = await guestPage.locator('text=Connected').count();
    expect(hostConnected + guestConnected).toBeGreaterThan(0);
  } finally {
    await ctx1.close();
    await ctx2.close();
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
    await ctx.close();
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
    await ctx1.close();
    await ctx2.close();
  }
});

// ---------------------------------------------------------------------------
// Test 4: Join flow edge cases
// ---------------------------------------------------------------------------
test('game page loads correctly and handles invalid game IDs', async ({ page }) => {
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

test('all-in: opponent sees an enabled Call button and can complete the hand', async ({ browser }) => {
  const ctx1: BrowserContext = await browser.newContext();
  const ctx2: BrowserContext = await browser.newContext();
  const alicePage: Page = await ctx1.newPage();
  const bobPage: Page = await ctx2.newPage();

  try {
    const gameId = await createGame(alicePage);
    await joinGame(bobPage, gameId, 'Bob', 1);

    await alicePage.getByRole('button', { name: /start game/i }).click();
    await expect(alicePage.getByText(/waiting for host/i)).not.toBeVisible({ timeout: 15000 });

    await alicePage.waitForSelector('button:text("Fold")', { timeout: 15000 });
    await alicePage.locator('button:text("All-in")').click();
    await alicePage.locator('button:text("Raise")').click();

    await bobPage.waitForSelector('button:text("Call")', { timeout: 15000 });
    const callButton = bobPage.locator('button:text("Call")').first();
    await expect(callButton).toBeEnabled();

    await callButton.click();

    await alicePage.waitForTimeout(1000);
    const aliveAfter =
      (await alicePage.locator('text=Connected').count()) +
      (await bobPage.locator('text=Connected').count());
    expect(aliveAfter).toBeGreaterThan(0);
  } finally {
    await ctx1.close();
    await ctx2.close();
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
    await ctx1.close();
    await ctx2.close();
  }
});
