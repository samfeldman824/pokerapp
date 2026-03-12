import { test, expect, BrowserContext, Page } from '@playwright/test';

async function createGame(page: Page): Promise<string> {
  await page.goto('/');
  await page.getByRole('link', { name: /create game/i }).click();
  await page.waitForURL('**/create');

  await page.getByLabel('Your Name').fill('Alice');
  await page.getByLabel(/your seat/i).fill('0');
  await page.getByRole('button', { name: /start game/i }).click();

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

async function watchGame(page: Page, gameId: string, name: string): Promise<void> {
  await page.goto(`/game/${gameId}`);
  await expect(page.getByLabel('Display Name')).toBeVisible({ timeout: 10000 });
  await page.getByLabel('Display Name').fill(name);
  await page.getByRole('button', { name: /^watch$/i }).click();
  const watchingBadge = page.locator('header').getByText('Watching', { exact: true });
  await expect(watchingBadge).toBeVisible({ timeout: 15000 });
}

async function startTwoPlayerGame(browser: import('@playwright/test').Browser): Promise<{
  ctx1: BrowserContext;
  ctx2: BrowserContext;
  hostPage: Page;
  guestPage: Page;
  gameId: string;
}> {
  const ctx1 = await browser.newContext();
  const ctx2 = await browser.newContext();
  const hostPage = await ctx1.newPage();
  const guestPage = await ctx2.newPage();

  const gameId = await createGame(hostPage);
  await joinGame(guestPage, gameId, 'Bob', 1);

  await hostPage.getByRole('button', { name: /start game/i }).click();
  await expect(hostPage.getByText(/waiting for host/i)).not.toBeVisible({ timeout: 15000 });

  return { ctx1, ctx2, hostPage, guestPage, gameId };
}

async function waitForAnyActionBar(hostPage: Page, guestPage: Page): Promise<Page> {
  const selector = 'button:text("Fold")';
  const result = await Promise.race([
    hostPage.waitForSelector(selector, { timeout: 20000 }).then(() => hostPage),
    guestPage.waitForSelector(selector, { timeout: 20000 }).then(() => guestPage),
  ]);
  return result;
}

test('spectator: Watch button joins as spectator without seat', async ({ browser }) => {
  const ctx1 = await browser.newContext();
  const ctxSpectator = await browser.newContext();

  const hostPage = await ctx1.newPage();
  const spectatorPage = await ctxSpectator.newPage();

  try {
    const gameId = await createGame(hostPage);
    await watchGame(spectatorPage, gameId, 'Watcher');

    await expect(spectatorPage.locator('header').getByText('Watching', { exact: true })).toBeVisible({ timeout: 5000 });

    const foldButton = spectatorPage.locator('button:text("Fold")');
    const checkButton = spectatorPage.locator('button:text("Check")');
    const callButton = spectatorPage.locator('button:text("Call")');

    await expect(foldButton).not.toBeVisible();
    await expect(checkButton).not.toBeVisible();
    await expect(callButton).not.toBeVisible();
  } finally {
    await ctx1.close();
    await ctxSpectator.close();
  }
});

test('spectator: spectator sees table but no action buttons during an active game', async ({ browser }) => {
  const { ctx1, ctx2, hostPage, guestPage, gameId } = await startTwoPlayerGame(browser);
  const ctxSpectator = await browser.newContext();
  const spectatorPage = await ctxSpectator.newPage();

  try {
    await watchGame(spectatorPage, gameId, 'Watcher');

    await expect(spectatorPage.locator('header').getByText('Watching', { exact: true })).toBeVisible({ timeout: 5000 });

    await expect(spectatorPage.locator('button:text("Fold")')).not.toBeVisible();
    await expect(spectatorPage.locator('button:text("Check")')).not.toBeVisible();
    await expect(spectatorPage.locator('button:text("Call")')).not.toBeVisible();

    await expect(spectatorPage.getByRole('heading', { name: /GAME #/i })).toBeVisible();
  } finally {
    await ctx1.close();
    await ctx2.close();
    await ctxSpectator.close();
  }
});

test('spectator: spectator count appears in header for all users', async ({ browser }) => {
  const ctx1 = await browser.newContext();
  const ctxSpectator = await browser.newContext();

  const hostPage = await ctx1.newPage();
  const spectatorPage = await ctxSpectator.newPage();

  try {
    const gameId = await createGame(hostPage);
    await watchGame(spectatorPage, gameId, 'Watcher');

    await expect(hostPage.locator('header').getByText(/watching:/i)).toBeVisible({ timeout: 5000 });
  } finally {
    await ctx1.close();
    await ctxSpectator.close();
  }
});

test('chat: player 1 sends a message and player 2 sees it', async ({ browser }) => {
  const { ctx1, ctx2, hostPage, guestPage } = await startTwoPlayerGame(browser);

  try {
    const chatToggleHost = hostPage.getByRole('button', { name: /open chat/i });
    await expect(chatToggleHost).toBeVisible({ timeout: 5000 });
    await chatToggleHost.click();

    await expect(hostPage.getByText(/table chat/i)).toBeVisible({ timeout: 3000 });

    const chatInput = hostPage.locator('textarea[placeholder*="message"]');
    await expect(chatInput).toBeVisible({ timeout: 3000 });
    await chatInput.fill('Hello everyone');
    await chatInput.press('Enter');

    const chatToggleGuest = guestPage.getByRole('button', { name: /open chat/i });
    await expect(chatToggleGuest).toBeVisible({ timeout: 5000 });
    await chatToggleGuest.click();

    await expect(guestPage.getByText('Hello everyone')).toBeVisible({ timeout: 5000 });
  } finally {
    await ctx1.close();
    await ctx2.close();
  }
});

test('chat: player 2 sends a reaction and player 1 sees it', async ({ browser }) => {
  const { ctx1, ctx2, hostPage, guestPage } = await startTwoPlayerGame(browser);

  try {
    const chatToggleGuest = guestPage.getByRole('button', { name: /open chat/i });
    await expect(chatToggleGuest).toBeVisible({ timeout: 5000 });
    await chatToggleGuest.click();

    await expect(guestPage.getByText(/table chat/i)).toBeVisible({ timeout: 3000 });

    const ggButton = guestPage.getByRole('button', { name: 'GG' });
    await expect(ggButton).toBeVisible({ timeout: 3000 });
    await ggButton.click();

    const chatToggleHost = hostPage.getByRole('button', { name: /open chat/i });
    await expect(chatToggleHost).toBeVisible({ timeout: 5000 });
    await chatToggleHost.click();

    await expect(hostPage.locator('.overflow-y-auto').getByText('GG', { exact: true })).toBeVisible({ timeout: 5000 });
  } finally {
    await ctx1.close();
    await ctx2.close();
  }
});

test('chat: unread badge appears on chat toggle when chat is collapsed and a message arrives', async ({ browser }) => {
  const { ctx1, ctx2, hostPage, guestPage } = await startTwoPlayerGame(browser);

  try {
    const chatToggleGuest = guestPage.getByRole('button', { name: /open chat/i });
    await expect(chatToggleGuest).toBeVisible({ timeout: 5000 });
    await chatToggleGuest.click();

    await expect(guestPage.getByText(/table chat/i)).toBeVisible({ timeout: 3000 });

    const chatInput = guestPage.locator('textarea[placeholder*="message"]');
    await chatInput.fill('Unread test message');
    await chatInput.press('Enter');

    const unreadBadge = hostPage.locator('[aria-label="Open chat"] span, button[aria-label="Open chat"] ~ span').first();

    const hostChatButton = hostPage.getByRole('button', { name: /open chat/i });
    await expect(hostChatButton).toBeVisible({ timeout: 5000 });

    await expect(async () => {
      const badgeEl = hostPage.locator('button[aria-label="Open chat"] span');
      const count = await badgeEl.count();
      expect(count).toBeGreaterThan(0);
      const text = await badgeEl.first().textContent();
      const num = parseInt(text ?? '0', 10);
      expect(num).toBeGreaterThan(0);
    }).toPass({ timeout: 5000 });

    void unreadBadge;
  } finally {
    await ctx1.close();
    await ctx2.close();
  }
});

test('chat: two-way message exchange between two players', async ({ browser }) => {
  const { ctx1, ctx2, hostPage, guestPage } = await startTwoPlayerGame(browser);

  try {
    const chatToggleHost = hostPage.getByRole('button', { name: /open chat/i });
    await expect(chatToggleHost).toBeVisible({ timeout: 5000 });
    await chatToggleHost.click();

    const hostChatInput = hostPage.locator('textarea[placeholder*="message"]');
    await expect(hostChatInput).toBeVisible({ timeout: 3000 });
    await hostChatInput.fill('Hello everyone');
    await hostChatInput.press('Enter');

    const chatToggleGuest = guestPage.getByRole('button', { name: /open chat/i });
    await expect(chatToggleGuest).toBeVisible({ timeout: 5000 });
    await chatToggleGuest.click();

    await expect(guestPage.getByText('Hello everyone')).toBeVisible({ timeout: 5000 });

    const ggButton = guestPage.getByRole('button', { name: 'GG' });
    await expect(ggButton).toBeVisible({ timeout: 3000 });
    await ggButton.click();

    await expect(hostPage.locator('.overflow-y-auto').getByText('GG', { exact: true })).toBeVisible({ timeout: 5000 });
  } finally {
    await ctx1.close();
    await ctx2.close();
  }
});
