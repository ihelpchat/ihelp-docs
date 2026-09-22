import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const baseUrl = process.env.BASE_URL ?? 'http://127.0.0.1:4173';
const executablePath = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const checks = [];

function near(name, actual, expected, tolerance) {
  checks.push({ name, pass: Math.abs(actual - expected) <= tolerance, actual, expected, tolerance });
}

function exact(name, pass, actual) {
  checks.push({ name, pass, actual });
}

async function rect(page, selector) {
  return page.locator(selector).first().evaluate((element) => {
    const value = element.getBoundingClientRect();
    return { left: value.left, top: value.top, width: value.width, height: value.height, bottom: value.bottom };
  });
}

const browser = await chromium.launch({ executablePath, headless: true });
try {
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await desktop.goto(baseUrl, { waitUntil: 'networkidle' });
  const desktopHero = await rect(desktop, '.design-hero');
  const desktopBadge = await rect(desktop, '.design-badge');
  const desktopTitle = await rect(desktop, '.design-hero h1');
  const desktopSearch = await rect(desktop, '.design-home .home-search');
  const desktopPortal = await rect(desktop, '.design-portal-card');
  near('desktop hero top', desktopHero.top, 60, 5);
  near('desktop hero bottom', desktopHero.bottom, 598, 12);
  near('desktop badge left', desktopBadge.left, 158, 8);
  near('desktop badge top', desktopBadge.top, 130, 8);
  near('desktop title left', desktopTitle.left, 158, 8);
  near('desktop title top', desktopTitle.top, 191, 10);
  near('desktop search left', desktopSearch.left, 158, 8);
  near('desktop search width', desktopSearch.width, 660, 12);
  near('desktop portals top', desktopPortal.top, 638, 14);
  near('desktop portal width', desktopPortal.width, 554, 14);
  exact('desktop two portals', await desktop.locator('.design-portal-card').count() === 2, await desktop.locator('.design-portal-card').count());
  exact('desktop exact headline', await desktop.locator('.design-hero h1').textContent() === 'Tire sua dúvida sobre o iHelp em uma pergunta.', await desktop.locator('.design-hero h1').textContent());
  await desktop.close();

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
  await mobile.goto(baseUrl, { waitUntil: 'networkidle' });
  const mobileHero = await rect(mobile, '.design-hero');
  const mobileBadge = await rect(mobile, '.design-badge');
  const mobileTitle = await rect(mobile, '.design-hero h1');
  const mobileSearch = await rect(mobile, '.design-home .home-search');
  const mobilePortal = await rect(mobile, '.design-portal-card');
  near('mobile hero top', mobileHero.top, 60, 6);
  near('mobile hero bottom', mobileHero.bottom, 598, 14);
  near('mobile badge left', mobileBadge.left, 20, 5);
  near('mobile badge top', mobileBadge.top, 101, 8);
  near('mobile title left', mobileTitle.left, 20, 5);
  near('mobile title top', mobileTitle.top, 161, 10);
  near('mobile search left', mobileSearch.left, 20, 5);
  near('mobile search top', mobileSearch.top, 331, 12);
  near('mobile portal left', mobilePortal.left, 28, 5);
  near('mobile portal width', mobilePortal.width, 334, 10);
  exact('mobile four suggestions', await mobile.locator('.search-suggestions button').count() === 4, await mobile.locator('.search-suggestions button').count());
  const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  exact('mobile without horizontal overflow', overflow <= 0, overflow);
  await mobile.close();
} finally {
  await browser.close();
}

const passed = checks.filter((check) => check.pass).length;
const score = Math.round((passed / checks.length) * 100);
for (const check of checks.filter((item) => !item.pass)) console.error('FALHOU', check);
console.log(`Fidelidade visual: ${score}% (${passed}/${checks.length} checkpoints).`);
assert.ok(score >= 90, `Fidelidade visual abaixo de 90%: ${score}%`);
