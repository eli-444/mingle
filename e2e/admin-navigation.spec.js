import { test, expect } from '@playwright/test';
const adminPath = '/gestion-tests-12345678901234567890';
function dashboard() {
  return {
    online: { connected: 4, waiting: 2, conversations: 1 }, visits30m: 321, visitsToday: 12345, visitsMonth: 1234567, reportsTotal: 1,
    visitSeries: Array.from({ length: 30 }, (_, i) => ({ minute: new Date(2026, 8, 10, 12, i).toISOString(), visits: i + 1 })),
    countries: [{ country: 'United Kingdom', visits: 500 }, { country: 'France', visits: 250 }],
    monthly: [{ month: '2026-09', pageviews: 12345, connections: 456, visitors: 230, peak: 45, matches: 67, reports: 1 }],
    daily: [{ date: '2026-09-10', pageviews: 123, connections: 56, peak: 12, matches: 20, reports: 1 }],
    reports: [{ id: 'test-report', reason: 'Autre', status: 'pending', details: 'A reported message '.repeat(12), notes: '', country: 'GB', ip: '2001:db8:1234:5678:1234:5678:1234:5678', created: '2026-09-10T12:00:00Z' }],
    contacts: [{ id: 'test-mail', firstName: 'Visitor', lastName: 'Example', email: 'a-very-long-address-for-mobile-layout@example.com', message: 'A contact message', notes: '', status: 'new', created: '2026-09-10T12:00:00Z' }],
    bans: [{ ip: '2001:db8:1234:5678:1234:5678:1234:5678', expires: '2026-10-10T12:00:00Z' }],
    totalReports: 1, policy: { operator: 'Mingle TV', contact: 'contact@example.com', address: '', hosting: '', retentionDays: 30 },
    audit: [{ created: '2026-09-10T12:00:00Z', action: 'Review report test-report' }]
  };
}
async function mockApi(page, loggedIn = true) {
  await page.route('**' + adminPath + '/api/**', async route => {
    const endpoint = new URL(route.request().url()).pathname.split('/').at(-1);
    if (endpoint === 'session' && !loggedIn) return route.fulfill({ status: 401, json: { error: 'Sign-in required' } });
    if (endpoint === 'login') loggedIn = true;
    if (endpoint === 'logout') loggedIn = false;
    await route.fulfill({ json: ['session', 'login'].includes(endpoint) ? { csrf: 'test-csrf' } : ['dashboard', 'metrics'].includes(endpoint) ? dashboard() : { ok: true } });
  });
}
async function navigate(page, name) {
  if (await page.locator('#menuToggle').isVisible()) await page.locator('#menuToggle').click();
  await page.getByRole('link', { name, exact: true }).click();
}
for (const width of [320, 390, 768, 1024, 1440]) {
  test('admin navigation and content fit a ' + width + 'px viewport', async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockApi(page);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(adminPath);
    await expect(page.locator('#dashboard')).toBeVisible();
    for (const name of ['Overview', 'Analytics', 'Reports', 'Mail', 'IP bans', 'Settings', 'Audit log']) {
      await navigate(page, name);
      await expect(page.locator('#viewTitle')).toHaveText(name);
      await expect(page.locator('[data-view]:visible')).toHaveCount(1);
      await expect(page.locator('.side-link[aria-current="page"]')).toContainText(name);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (name === 'Analytics') {
        const table = page.locator('#analytics .table-wrap').first();
        expect(await table.evaluate(el => el.scrollWidth >= el.clientWidth)).toBe(true);
      }
    }
    await navigate(page, 'Reports');
    await page.getByLabel('Internal notes', { exact: true }).fill('Keep this unsaved note');
    await navigate(page, 'Settings');
    await page.locator('#operator').fill('Unsaved operator');
    await navigate(page, 'Reports');
    await expect(page.getByLabel('Internal notes', { exact: true })).toHaveValue('Keep this unsaved note');
    await navigate(page, 'Settings');
    await expect(page.locator('#operator')).toHaveValue('Unsaved operator');
    if ([390, 1440].includes(width)) {
      await page.screenshot({ path: 'test-results/admin-settings-' + width + '.png', fullPage: true });
      await navigate(page, 'Overview');
      await page.screenshot({ path: 'test-results/admin-overview-' + width + '.png', fullPage: true });
    }
    expect(errors).toEqual([]);
  });
}
test('admin routes restore on reload, follow back/forward and recover from unknown routes', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 }); await mockApi(page);
  await page.goto(adminPath + '#mail-section');
  await expect(page.locator('#mail-section')).toBeVisible();
  await navigate(page, 'Settings'); await page.reload();
  await expect(page.locator('#settings-section')).toBeVisible();
  await navigate(page, 'Reports'); await page.goBack();
  await expect(page.locator('#settings-section')).toBeVisible();
  await page.goForward(); await expect(page.locator('#reports-section')).toBeVisible();
  await page.goto(adminPath + '#unknown');
  await expect(page.locator('#overview')).toBeVisible();
  await expect(page).toHaveURL(new RegExp('#overview$'));
});
test('mobile menu traps focus, closes with Escape and backdrop, and resets on desktop', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await mockApi(page); await page.goto(adminPath);
  await expect(page.locator('#dashboard')).toBeVisible();
  await page.locator('#menuToggle').click();
  await expect(page.locator('#menuToggle')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#menuClose')).toBeFocused();
  expect(await page.locator('#workspace').evaluate(el => el.inert)).toBe(true);
  await page.keyboard.press('Shift+Tab'); await expect(page.locator('#logout')).toBeFocused();
  await page.keyboard.press('Tab'); await expect(page.locator('#menuClose')).toBeFocused();
  await page.keyboard.press('Escape'); await expect(page.locator('#menuToggle')).toBeFocused();
  await expect(page.locator('#sidebar')).toBeHidden();
  await page.locator('#menuToggle').click(); await page.mouse.click(380, 400);
  await expect(page.locator('#menuToggle')).toHaveAttribute('aria-expanded', 'false');
  await page.locator('#menuToggle').click();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator('#sidebar')).toBeVisible();
  expect(await page.locator('#workspace').evaluate(el => el.inert)).toBe(false);
  await page.getByRole('link', { name: 'Mail', exact: true }).click();
  await expect(page.locator('#mail-section')).toBeVisible();
});
test('mobile login and logout remain usable', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 }); await mockApi(page, false); await page.goto(adminPath);
  await expect(page.locator('#login')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('#password').fill('test-password'); await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('#overview')).toBeVisible();
  await page.locator('#menuToggle').click(); await page.locator('#logout').click();
  await expect(page.locator('#login')).toBeVisible();
  await expect(page.locator('#dashboard')).toBeHidden();
  await expect(page.locator('#menuBackdrop')).toBeHidden();
});

 test('charts handle empty data and confirmation can be cancelled safely', async ({page}) => {
 await mockApi(page); await page.goto(adminPath);
 await expect(page.locator('#trafficChart svg')).toBeVisible();
 await navigate(page,'Analytics'); await expect(page.locator('#dailyChart svg circle')).toHaveCount(2);
 await navigate(page,'Reports');
 const mutations=[]; page.on('request',r=>{if(r.method()==='POST')mutations.push(r.url());});
 await page.getByRole('button',{name:'Delete',exact:true}).click();
 await expect(page.getByRole('dialog')).toBeVisible();
 await expect(page.getByRole('button',{name:'Cancel',exact:true})).toBeFocused();
 await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toBeHidden();
 expect(mutations).toEqual([]); await expect(page.locator('#reports .report')).toHaveCount(1);
 await page.route('**'+adminPath+'/api/metrics',r=>r.fulfill({json:{...dashboard(),visitSeries:[],daily:[],monthly:[],countries:[]}}));
 await navigate(page,'Overview'); await expect(page.locator('#trafficChart')).toContainText('No activity recorded yet.',{timeout:10000});
 });
