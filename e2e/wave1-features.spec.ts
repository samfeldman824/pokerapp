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

test('keyboard shortcuts badges appear on action buttons', async ({ browser }) => {
  const ctx1: BrowserContext = await browser.newContext();
  const ctx2: BrowserContext = await browser.newContext();
  const hostPage: Page = await ctx1.newPage();
  const guestPage: Page = await ctx2.newPage();

  try {
    const gameId = await createGame(hostPage);
    await joinGame(guestPage, gameId, 'Carol', 1);

    await hostPage.getByRole('button', { name: /start game/i }).click();
    await expect(hostPage.getByText(/waiting for host/i)).not.toBeVisible({ timeout: 15000 });

    await hostPage.getByRole('button', { name: /^call/i }).waitFor({ state: 'visible', timeout: 10000 });
    
    const foldBadge = hostPage.locator('kbd', { hasText: 'F' });
    await expect(foldBadge).toBeVisible();
    
    const callBadge = hostPage.locator('kbd', { hasText: 'C' });
    await expect(callBadge).toBeVisible();
  } finally {
    await ctx1.close();
    await ctx2.close();
  }
});

test('pre-action checkboxes render when not active player', async ({ browser }) => {
  const ctx1: BrowserContext = await browser.newContext();
  const ctx2: BrowserContext = await browser.newContext();
  const hostPage: Page = await ctx1.newPage();
  const guestPage: Page = await ctx2.newPage();

  try {
    const gameId = await createGame(hostPage);
    await joinGame(guestPage, gameId, 'Dave', 1);

    await hostPage.getByRole('button', { name: /start game/i }).click();
    await expect(hostPage.getByText(/waiting for host/i)).not.toBeVisible({ timeout: 15000 });

    await guestPage.getByText(/pre-actions/i).waitFor({ state: 'visible', timeout: 10000 });
    
    const foldCheckbox = guestPage.getByRole('checkbox', { name: 'Fold', exact: true });
    await expect(foldCheckbox).toBeVisible();
    
    const checkFoldCheckbox = guestPage.getByRole('checkbox', { name: /check\/fold/i });
    await expect(checkFoldCheckbox).toBeVisible();
  } finally {
    await ctx1.close();
    await ctx2.close();
  }
});

test('show/muck buttons appear for uncontested winner', async ({ browser }) => {
  const ctx1: BrowserContext = await browser.newContext();
  const ctx2: BrowserContext = await browser.newContext();
  const hostPage: Page = await ctx1.newPage();
  const guestPage: Page = await ctx2.newPage();

  try {
    const gameId = await createGame(hostPage);
    await joinGame(guestPage, gameId, 'Eve', 1);

    await hostPage.getByRole('button', { name: /start game/i }).click();
    await expect(hostPage.getByText(/waiting for host/i)).not.toBeVisible({ timeout: 15000 });

    for (let i = 0; i < 20; i++) {
      const hostFold = hostPage.getByRole('button', { name: /^fold$/i });
      const hostCheck = hostPage.getByRole('button', { name: /^check$/i });
      const hostCall = hostPage.getByRole('button', { name: /^call/i });

      const showMuckVisible = await guestPage.getByText(/you won/i).count();
      if (showMuckVisible > 0) {
        await expect(guestPage.getByRole('button', { name: /show cards/i })).toBeVisible();
        await expect(guestPage.getByRole('button', { name: /muck/i })).toBeVisible();
        break;
      }

      if (await hostFold.isVisible()) {
        await hostFold.click();
        break;
      } else if (await hostCheck.isVisible()) {
        await hostCheck.click();
      } else if (await hostCall.isVisible()) {
        await hostCall.click();
      } else {
        await hostPage.waitForTimeout(500);
      }
    }

    await expect(guestPage.getByRole('button', { name: /show cards/i })).toBeVisible({ timeout: 5000 });
  } finally {
    await ctx1.close();
    await ctx2.close();
  }
});
