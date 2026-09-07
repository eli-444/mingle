import { test, expect } from '@playwright/test';

async function start(page) {
  await page.goto('http://localhost:3100');
  await page.getByRole('button', { name: 'Rechercher' }).click();
}
test('one click connects two cameras, then skip starts another search', async ({ browser }) => {
  const aContext = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const bContext = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const a = await aContext.newPage(); const b = await bContext.newPage();
  const errors = []; a.on('pageerror', e => errors.push(e.message)); b.on('pageerror', e => errors.push(e.message));
  await start(a); await start(b);
  await expect(a.locator('#remotePanel')).toHaveAttribute('data-state', 'connected', { timeout: 20000 });
  await expect(b.locator('#remotePanel')).toHaveAttribute('data-state', 'connected', { timeout: 20000 });
  await expect.poll(() => a.locator('#remoteVideo').evaluate(v => v.videoWidth)).toBeGreaterThan(0);
  await expect(a.locator('#remoteCountry')).toBeVisible();
  await expect(a.locator('#start')).toHaveText('skip');
  const stopButton = await a.locator('#stop').boundingBox(); const skipButton = await a.locator('#start').boundingBox();
  expect(stopButton.x + stopButton.width).toBeLessThan(skipButton.x);
  const local = await a.locator('#localPanel').boundingBox(); const remote = await a.locator('#remotePanel').boundingBox();
  expect(local.x + local.width).toBeLessThan(remote.x);
  await a.locator('#message').fill('Salut <img src=x onerror=alert(1)>');
  await a.locator('#message').press('Enter');
  await expect(b.locator('.bubble')).toHaveText('Salut <img src=x onerror=alert(1)>');
  await expect(b.locator('#messages img')).toHaveCount(0);
  await expect(a.locator('.bubble.own')).toHaveCount(1);
  await b.locator('#message').fill('Bonjour !'); await b.locator('#send').click();
  await expect(a.locator('.bubble:not(.own)')).toHaveText('Bonjour !');
  await a.locator('#start').click();
  await expect(a.locator('#remotePanel')).toHaveAttribute('data-state', 'searching');
  await expect(b.locator('#remotePanel')).toHaveAttribute('data-state', 'idle');
  await expect(a.locator('#remoteCountry')).toBeHidden();
  await expect(a.locator('.bubble')).toHaveCount(0);
  await expect(b.locator('.bubble')).toHaveCount(0);
  await expect(a.locator('#message')).toBeDisabled();
  await b.locator('#start').click();
  await expect(a.locator('#remotePanel')).toHaveAttribute('data-state', 'connected', { timeout: 20000 });
  await a.locator('#localVideo').evaluate(v => { window.testTracks = v.srcObject.getTracks(); });
  await a.locator('#stop').click();
  expect(await a.evaluate(() => window.testTracks.every(t => t.readyState === 'ended'))).toBe(true);
  expect(await a.locator('#localVideo').evaluate(v => v.srcObject)).toBe(null);
  await expect(a.locator('#start')).toHaveText('Rechercher');
  await expect(a.locator('#stop')).toBeDisabled();
  await expect(b.locator('#remotePanel')).toHaveAttribute('data-state', 'idle');
  expect(errors).toEqual([]);
  await aContext.close(); await bContext.close();
});
for (const [name, width, height] of [['mobile', 390, 844], ['desktop', 1440, 900]]) {
  test(name + ' shows only the minimal interface with cameras side by side', async ({ page }) => {
    await page.setViewportSize({ width, height }); await page.goto('/');
    await expect(page.locator('#start')).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.locator('#localVideo').evaluate(v => v.srcObject)).toBe(null);
    await expect(page.locator('dialog[open], footer')).toHaveCount(0);
    await expect(page.locator('#chatForm')).toBeVisible();
    await expect(page.locator('#message')).toBeDisabled();
    await expect(page.getByRole('button')).toHaveCount(5);
    const local = await page.locator('#localPanel').boundingBox(); const remote = await page.locator('#remotePanel').boundingBox();
    expect(local.x + local.width).toBeLessThan(remote.x);
    expect(local.y).toBe(remote.y);
    await page.screenshot({ path: 'test-results/' + name + '.png', fullPage: true });
  });
}
test('camera denial permits retry without leaving search stuck', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Denied', 'NotAllowedError'); };
  });
  await start(page);
  await expect(page.locator('#error')).toContainText('Autorise');
  await expect(page.locator('#start')).toBeEnabled();
  await expect(page.locator('#start')).toHaveText('Rechercher');
});
