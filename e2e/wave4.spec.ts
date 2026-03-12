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

test('blind schedule config: blind indicator appears on game page after creating with Turbo preset', async ({ browser }) => {
  const ctx1 = await browser.newContext();
  const ctx2 = await browser.newContext();
  const hostPage = await ctx1.newPage();
  const guestPage = await ctx2.newPage();

  try {
    await hostPage.goto('/');
    await hostPage.getByRole('link', { name: /create game/i }).click();
    await hostPage.waitForURL('**/create');

    await hostPage.getByLabel('Your Name').fill('Alice');
    await hostPage.getByLabel(/your seat/i).fill('0');

    const blindScheduleCheckbox = hostPage.locator('input[name="enableBlindSchedule"]');
    await blindScheduleCheckbox.check();
    await expect(blindScheduleCheckbox).toBeChecked();

    const presetSelect = hostPage.locator('select[name="blindSchedulePreset"]');
    await expect(presetSelect).toBeVisible({ timeout: 3000 });
    await presetSelect.selectOption('turbo');

    await hostPage.getByRole('button', { name: /start game/i }).click();
    await hostPage.waitForURL('**/game/**', { timeout: 10000 });

    const url = hostPage.url();
    const match = url.match(/\/game\/([^/?#]+)/);
    if (!match) throw new Error(`Could not extract gameId from URL: ${url}`);
    const gameId = match[1];

    await joinGame(guestPage, gameId, 'Bob', 1);

    await hostPage.getByRole('button', { name: /start game/i }).click();
    await expect(hostPage.getByText(/waiting for host/i)).not.toBeVisible({ timeout: 15000 });

    await hostPage.waitForSelector('button:text("Fold")', { timeout: 20000 });

    await expect(hostPage.getByText(/Blinds:/)).toBeVisible({ timeout: 10000 });

    const blindsText = await hostPage.getByText(/Blinds:/).textContent();
    expect(blindsText).toMatch(/Blinds:\s*\d+\/\d+/);

    await expect(hostPage.getByText(/Next increase in/)).toBeVisible({ timeout: 5000 });
  } finally {
    await ctx1.close();
    await ctx2.close();
  }
});

test('top-up flow: Top Up button appears after player loses chips between hands', async ({ browser }) => {
  const { ctx1, ctx2, hostPage, guestPage } = await startTwoPlayerGame(browser);

  try {
    const activePage = await waitForAnyActionBar(hostPage, guestPage);
    const otherPage = activePage === hostPage ? guestPage : hostPage;

    const foldBtn = activePage.locator('button:text("Fold")').first();
    await expect(foldBtn).toBeEnabled({ timeout: 5000 });
    await foldBtn.click();

    const topUpOrRebuySelector = 'button:text("Top Up"), button:text("Rebuy")';
    const topUpOrRebuyOnActive = activePage.locator(topUpOrRebuySelector);
    const topUpOrRebuyOnOther = otherPage.locator(topUpOrRebuySelector);

    const pageWithButton = await Promise.race([
      topUpOrRebuyOnActive.waitFor({ state: 'visible', timeout: 6000 }).then(() => activePage).catch(() => null),
      topUpOrRebuyOnOther.waitFor({ state: 'visible', timeout: 6000 }).then(() => otherPage).catch(() => null),
    ]);

    if (pageWithButton !== null) {
      const btn = pageWithButton.locator(topUpOrRebuySelector).first();
      await expect(btn).toBeEnabled({ timeout: 3000 });
      await btn.click();
      await expect(btn).not.toBeVisible({ timeout: 5000 });
    } else {
      const topUpOnActive = await activePage.locator('button:text("Top Up"), button:text("Rebuy")').count();
      const topUpOnOther = await otherPage.locator('button:text("Top Up"), button:text("Rebuy")').count();
      expect(topUpOnActive > 0 || topUpOnOther > 0).toBe(true);
    }
  } finally {
    await ctx1.close();
    await ctx2.close();
  }
});

test('chip animation: animate-chip-bet class applied to bet badge after a player places a bet', async ({ browser }) => {
  const { ctx1, ctx2, hostPage, guestPage } = await startTwoPlayerGame(browser);

  try {
    await waitForAnyActionBar(hostPage, guestPage);

    const checkBetBadge = async (page: Page): Promise<boolean> => {
      const count = await page.locator('.animate-chip-bet').count();
      return count > 0;
    };

    const hasBadgeOnHost = await checkBetBadge(hostPage);
    const hasBadgeOnGuest = await checkBetBadge(guestPage);

    if (hasBadgeOnHost || hasBadgeOnGuest) {
      expect(hasBadgeOnHost || hasBadgeOnGuest).toBe(true);
      return;
    }

    const foundOnHost = await hostPage.waitForFunction(
      () => document.querySelectorAll('.animate-chip-bet').length > 0,
      { timeout: 5000 }
    ).then(() => true).catch(() => false);

    const foundOnGuest = await guestPage.waitForFunction(
      () => document.querySelectorAll('.animate-chip-bet').length > 0,
      { timeout: 5000 }
    ).then(() => true).catch(() => false);

    expect(foundOnHost || foundOnGuest).toBe(true);
  } finally {
    await ctx1.close();
    await ctx2.close();
  }
});
