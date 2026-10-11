/**
 * Fetch qavanin.ir TreeText BorderText via Playwright (Edge channel preferred).
 * No DB access.
 */
const { chromium } = require('playwright');

async function fetchBorderText(url, options = {}) {
  const minTextLength = options.minTextLength ?? 500;
  const headless = process.env.PW_HEADLESS === '1';
  const launchOpts = {
    headless,
    args: ['--disable-blink-features=AutomationControlled']
  };
  if (process.env.PW_CHANNEL !== 'none') {
    launchOpts.channel = 'msedge';
  }

  let browser;
  try {
    browser = await chromium.launch(launchOpts);
  } catch (err) {
    if (launchOpts.channel) {
      delete launchOpts.channel;
      browser = await chromium.launch(launchOpts);
    } else {
      throw err;
    }
  }

  const page = await browser.newPage();
  page.setDefaultTimeout(180_000);
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'fa-IR,fa;q=0.9,en;q=0.8' });

  await page.goto(url, { waitUntil: 'networkidle', timeout: 180_000 });
  await page.waitForSelector('div.BorderText.treeTextView', { timeout: 120_000 });
  await page.waitForFunction(
    (minLen) => {
      const el = document.querySelector('div.BorderText.treeTextView');
      return el && el.innerText && el.innerText.length >= minLen;
    },
    minTextLength,
    { timeout: 120_000 }
  );
  await page.waitForTimeout(2_000);

  const html = await page.locator('div.BorderText.treeTextView').innerHTML();
  const text = await page.locator('div.BorderText.treeTextView').innerText();

  await browser.close();

  if (!html || html.length < 200) {
    throw new Error('BorderText HTML too short — fetch may have failed');
  }
  return { html, text, fetchedAt: new Date().toISOString() };
}

function minTextLengthForLaw(catalogEntry) {
  const est = Number(catalogEntry?.estimatedUnits) || 0;
  if (est > 0 && est < 200) {
    return Math.max(800, est * 25);
  }
  if (est >= 200) {
    return Math.min(10_000, Math.max(3000, est * 15));
  }
  return 1500;
}

module.exports = { fetchBorderText, minTextLengthForLaw };
