import { test, expect } from '@playwright/test';

async function start(page) {
  await page.goto('http://localhost:3100');
  await page.locator('#adultConfirmed').check(); await page.locator('#ageContinue').click();
  await page.getByRole('button', { name: 'Search' }).click();
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
  expect(skipButton.x + skipButton.width).toBeLessThan(stopButton.x);
  const local = await a.locator('#localPanel').boundingBox(); const remote = await a.locator('#remotePanel').boundingBox();
  expect(local.x + local.width).toBeLessThan(remote.x);
  await a.locator('#message').fill('Salut <img src=x onerror=alert(1)>');
  await a.locator('#message').press('Enter');
  await expect(b.locator('.bubble')).toHaveText('Salut <img src=x onerror=alert(1)>');
  await expect(b.locator('#messages img')).toHaveCount(0);
  await expect(a.locator('.bubble.own')).toHaveCount(1);
  await b.locator('#message').fill('Bonjour !'); await b.locator('#send').click();
  await expect(a.locator('.bubble:not(.own)')).toHaveText('Bonjour !');
  await a.locator('#remoteVideo').evaluate(video => { window.previousRemoteStream = video.srcObject; });
  await a.locator('#start').click();
  // Both participants search automatically now; with two visitors they can match again.
  await expect.poll(() => a.locator('#remoteVideo').evaluate(video => video.srcObject !== null && video.srcObject !== window.previousRemoteStream)).toBe(true);
  await expect(a.locator('#remotePanel')).toHaveAttribute('data-state', 'connected', { timeout: 20000 });
  await expect(b.locator('#remotePanel')).toHaveAttribute('data-state', 'connected', { timeout: 20000 });
  await expect(a.locator('.bubble')).toHaveCount(0);
  await expect(b.locator('.bubble')).toHaveCount(0);
  await a.locator('#localVideo').evaluate(v => { window.testTracks = v.srcObject.getTracks(); });
  await a.locator('#stop').click();
  expect(await a.evaluate(() => window.testTracks.every(t => t.readyState === 'ended'))).toBe(true);
  expect(await a.locator('#localVideo').evaluate(v => v.srcObject)).toBe(null);
  await expect(a.locator('#start')).toHaveText('Search');
  await expect(a.locator('#stop')).toBeDisabled();
  await expect(b.locator('#remotePanel')).toHaveAttribute('data-state', 'searching');
  expect(errors).toEqual([]);
  await aContext.close(); await bContext.close();
});
for (const [name, width, height] of [['mobile', 390, 844], ['small-mobile', 320, 568], ['landscape', 844, 390], ['laptop', 1366, 768], ['desktop', 1920, 1080]]) {
  test(name + ' fits cameras, controls and chat in one screen with the footer below', async ({ page }) => {
    await page.setViewportSize({ width, height }); await page.goto('/');
    await page.locator('#adultConfirmed').check(); await page.locator('#ageContinue').click();
    await expect(page.locator('#start')).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.locator('#localVideo').evaluate(v => v.srcObject)).toBe(null);
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await expect(page.locator('#chatForm')).toBeVisible();
    await expect(page.locator('#message')).toBeDisabled();
    await expect(page.locator('main button')).toHaveCount(4);
    const local = await page.locator('#localPanel').boundingBox(); const remote = await page.locator('#remotePanel').boundingBox();
    expect(local.x + local.width).toBeLessThan(remote.x);
    expect(local.y).toBe(remote.y);
    const controls = await page.locator('.controls-panel').boundingBox();
    const chat = await page.locator('.chat').boundingBox();
    const footer = await page.locator('footer').boundingBox();
    expect(footer.y).toBeCloseTo(height, 0);
    for (const box of [local, remote, controls, chat]) expect(box.y + box.height).toBeLessThanOrEqual(height);
    if (width > 650) {
      expect(controls.x).toBe(local.x); expect(chat.x).toBe(remote.x);
      expect(controls.y).toBe(chat.y); expect(chat.width).toBe(remote.width);
    }
    await page.screenshot({ path: 'test-results/' + name + '.png' });
    // A busy conversation must scroll its history, without moving the composer or footer.
    await page.locator('#messages').evaluate(log => {
      for (let i = 0; i < 60; i++) { const bubble = document.createElement('div'); bubble.className = 'bubble'; bubble.textContent = 'Long message '.repeat(12); log.append(bubble); }
      log.scrollTop = log.scrollHeight;
    });
    expect(await page.locator('#messages').evaluate(log => log.scrollHeight > log.clientHeight)).toBe(true);
    const composer = await page.locator('#chatForm').boundingBox();
    expect(composer.y + composer.height).toBeLessThanOrEqual(height);
    expect((await page.locator('footer').boundingBox()).y).toBeCloseTo(height, 0);
    await page.locator('.contact-box summary').click();
    await expect(page.locator('#contactEmail')).toBeVisible();
  });
}
test('camera denial permits retry without leaving search stuck', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Denied', 'NotAllowedError'); };
  });
  await start(page);
  await expect(page.locator('#error')).toContainText('Allow');
  await expect(page.locator('#start')).toBeEnabled();
  await expect(page.locator('#start')).toHaveText('Search');
});

test('age declaration is required before asking for the camera', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#ageDialog')).toBeVisible();
  await expect(page.locator('#ageContinue')).toBeDisabled();
  expect(await page.locator('#localVideo').evaluate(video => video.srcObject)).toBe(null);
  await page.locator('#adultConfirmed').check(); await page.locator('#ageContinue').click();
  await page.getByRole('link', { name: 'Terms of Use', exact: true }).click();
  await expect(page).toHaveTitle('Terms of Use — Mingle TV');
  await expect(page.locator('[data-policy="operator"]')).toHaveText('Aurora Web & Security');
});
