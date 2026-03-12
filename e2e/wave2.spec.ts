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

test('action confirmation: confirmation text appears after fold', async ({ browser }) => {
  const { ctx1, ctx2, hostPage, guestPage } = await startTwoPlayerGame(browser);

  try {
    const activePage = await waitForAnyActionBar(hostPage, guestPage);

    const foldBtn = activePage.locator('button:text("Fold")').first();
    await expect(foldBtn).toBeEnabled({ timeout: 5000 });
    await foldBtn.click();

    await expect(activePage.getByText(/you folded/i)).toBeVisible({ timeout: 5000 });
  } finally {
    await ctx1.close();
    await ctx2.close();
  }
});

test('pot odds display: shows percentage when facing a bet', async ({ browser }) => {
  const { ctx1, ctx2, hostPage, guestPage } = await startTwoPlayerGame(browser);

  try {
    const activePage = await waitForAnyActionBar(hostPage, guestPage);
    const otherPage = activePage === hostPage ? guestPage : hostPage;

    const callBtn = activePage.getByRole('button', { name: /^call/i });
    const otherCallBtn = otherPage.getByRole('button', { name: /^call/i });

    let pageWithCall: Page | null = null;
    if (await callBtn.isVisible() && await callBtn.isEnabled()) {
      pageWithCall = activePage;
    } else if (await otherCallBtn.isVisible() && await otherCallBtn.isEnabled()) {
      pageWithCall = otherPage;
    }

    if (pageWithCall) {
      const potOddsEl = pageWithCall.getByText(/pot odds:/i);
      await expect(potOddsEl).toBeVisible({ timeout: 5000 });
      const text = await potOddsEl.textContent();
      expect(text).toMatch(/\d+%/);
    } else {
      const checkBtn = activePage.getByRole('button', { name: /^check$/i });
      const canCheck = await checkBtn.isVisible() && await checkBtn.isEnabled();
      expect(canCheck).toBe(true);
    }
  } finally {
    await ctx1.close();
    await ctx2.close();
  }
});

test('hand history modal: opens, shows content, and closes', async ({ browser }) => {
  const { ctx1, ctx2, hostPage, guestPage } = await startTwoPlayerGame(browser);

  try {
    const activePage = await waitForAnyActionBar(hostPage, guestPage);

    const foldBtn = activePage.locator('button:text("Fold")').first();
    await expect(foldBtn).toBeEnabled({ timeout: 5000 });
    await foldBtn.click();

    await hostPage.waitForTimeout(4000);

    const handHistoryBtn = hostPage.getByRole('button', { name: /hand history/i });
    await expect(handHistoryBtn).toBeVisible({ timeout: 5000 });
    await handHistoryBtn.click();

    await expect(hostPage.getByRole('heading', { name: /hand history/i })).toBeVisible({ timeout: 5000 });

    await expect(hostPage.locator('.animate-spin')).not.toBeVisible({ timeout: 10000 });

    const handEntry = hostPage.getByText(/hand #\d+/i);
    const noHandsText = hostPage.getByText(/no hands played yet/i);

    const hasHandEntry = await handEntry.count() > 0;
    const hasNoHandsText = await noHandsText.count() > 0;
    expect(hasHandEntry || hasNoHandsText).toBe(true);

    if (hasHandEntry) {
      await handEntry.first().click();
      const actionTimeline = hostPage.getByText(/action timeline/i);
      const loadingSpinner = hostPage.locator('.animate-spin');
      await expect(actionTimeline.or(loadingSpinner)).toBeVisible({ timeout: 5000 });
    }

    await hostPage.getByRole('button', { name: /close/i }).click();
    await expect(hostPage.getByRole('heading', { name: /hand history/i })).not.toBeVisible({ timeout: 3000 });
  } finally {
    await ctx1.close();
    await ctx2.close();
  }
});

test('invite modal: shows game URL and Copied! after clicking Copy Link', async ({ browser }) => {
  const ctx = await browser.newContext({
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const page = await ctx.newPage();

  try {
    const gameId = await createGame(page);

    const inviteBtn = page.getByRole('button', { name: /^invite$/i });
    await expect(inviteBtn).toBeVisible({ timeout: 5000 });
    await inviteBtn.click();

    await expect(page.getByRole('heading', { name: /share game link/i })).toBeVisible({ timeout: 5000 });

    const urlInput = page.getByRole('textbox');
    await expect(urlInput).toBeVisible({ timeout: 5000 });
    const urlValue = await urlInput.inputValue();
    expect(urlValue).toContain(gameId);

    const copyBtn = page.getByRole('button', { name: /copy link/i });
    await expect(copyBtn).toBeVisible({ timeout: 5000 });
    await copyBtn.click();

    await expect(page.getByRole('button', { name: /copied!/i })).toBeVisible({ timeout: 3000 });

    await page.getByRole('button', { name: /close/i }).click();
    await expect(page.getByRole('heading', { name: /share game link/i })).not.toBeVisible({ timeout: 3000 });
  } finally {
    await ctx.close();
  }
});
