// End-to-end drive of datool: paste -> first pass -> create -> edit -> save -> reload.
// Run from /home/user/datool/frontend (playwright resolves from its node_modules).
import { chromium } from 'playwright';

const SHOTS = process.env.SHOTS ?? '/tmp/e2e-shots';
const BASE = 'http://127.0.0.1:5173';

function fail(msg) {
  console.error('E2E FAIL:', msg);
  process.exit(1);
}

// In sandboxed environments Chromium is preinstalled; CHROMIUM_PATH overrides
// (e.g. /opt/pw-browsers/chromium-*/chrome-linux/chrome).
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH !== undefined
    ? { executablePath: process.env.CHROMIUM_PATH }
    : {},
);
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', (err) => console.error('PAGE ERROR:', err.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.error('CONSOLE ERROR:', m.text());
});

// Build the paste from the corpus itself (1 John 1:5-7 = words 124747..124816).
const wordsRes = await page.request.get(
  'http://127.0.0.1:8000/api/corpus/words?start=124747&end=124816',
);
if (!wordsRes.ok()) fail(`corpus fetch ${wordsRes.status()}`);
const words = await wordsRes.json();
const paste = words.map((w) => w.text).join(' ');
console.log('paste words:', words.length);

// --- Home: paste and run the first pass -----------------------------------
await page.goto(BASE);
await page.waitForSelector('.paste-area');
await page.fill('.paste-area', paste);
await page.screenshot({ path: `${SHOTS}/1-home-paste.png` });

await page.click('button:has-text("Analyze")');
await page.waitForSelector('.alignment-line');
const alignment = await page.textContent('.alignment-line');
console.log('alignment:', alignment);
if (!alignment.includes('1 John 1:5–7')) fail(`unexpected alignment: ${alignment}`);
if (!alignment.includes('(exact)')) fail('alignment not exact');

await page.click('button:has-text("Create")');
await page.waitForURL(/\/analysis\//);

// --- Editor: first-pass render --------------------------------------------
await page.waitForSelector('.prop-row');
const rowCount = await page.locator('.prop-row').count();
console.log('proposition rows:', rowCount);
if (rowCount !== 14) fail(`expected 14 rows, got ${rowCount}`);
await page.waitForSelector('.bracket-hit');
const bracketCount0 = await page.locator('.bracket-hit').count();
const reviewCount0 = await page.locator('.bracket-hit:has(circle)').count();
console.log('brackets:', bracketCount0, 'review-flagged:', reviewCount0);
await page.screenshot({ path: `${SHOTS}/2-editor-first-pass.png`, fullPage: true });

// --- Interactions ----------------------------------------------------------
// (a) Confirm a review-flagged bracket.
await page.locator('.bracket-hit:has(circle)').first().dispatchEvent('mousedown');
await page.waitForSelector('.confirm-btn');
await page.click('.confirm-btn');
const reviewCount1 = await page.locator('.bracket-hit:has(circle)').count();
console.log('review-flagged after confirm:', reviewCount1);
if (reviewCount1 !== reviewCount0 - 1) fail('confirm did not clear the flag');

// (b) Re-label a review bracket to Alternative (the interpretive override).
await page.locator('.bracket-hit:has(circle)').first().dispatchEvent('mousedown');
await page.waitForSelector('.bracket-controls .rel-select');
await page.selectOption('.bracket-controls .rel-select', 'Alt');
console.log('re-labeled a bracket to Alt');

// (c) Wrap: select 5a (row 0) through 6e (row 9) -> two of the root's
// three sentence packets -> wrap as Ground.
await page.locator('.prop-row').nth(0).click();
await page.locator('.prop-row').nth(9).click({ modifiers: ['Shift'] });
const selectedRows = await page.locator('.prop-row.selected').count();
console.log('selected rows:', selectedRows);
if (selectedRows !== 10) fail(`expected 10 selected rows, got ${selectedRows}`);
await page.selectOption('.editor-toolbar > .rel-select', 'Grnd');
const bracketCount1 = await page.locator('.bracket-hit').count();
console.log('brackets after wrap:', bracketCount1);
if (bracketCount1 !== bracketCount0 + 1) fail('wrap did not add a bracket');

// (d) Undo / redo round-trip.
await page.click('button:has-text("Undo")');
if ((await page.locator('.bracket-hit').count()) !== bracketCount0) fail('undo failed');
await page.click('button:has-text("Redo")');
if ((await page.locator('.bracket-hit').count()) !== bracketCount1) fail('redo failed');

// (e) Move a star on a subordinate bracket.
await page.locator('.bracket-hit').first().dispatchEvent('mousedown');
await page.waitForSelector('.bracket-controls');
const starButtons = await page.locator('.star-btn').count();
if (starButtons > 0) {
  await page.locator('.star-btn').first().click();
  console.log('moved a star');
}
await page.screenshot({ path: `${SHOTS}/3-editor-after-edits.png`, fullPage: true });

// --- Save and reload --------------------------------------------------------
await page.click('button:has-text("Save")');
await page.waitForSelector('text=Saved', { timeout: 10_000 });
console.log('saved');

await page.reload();
await page.waitForSelector('.prop-row');
const rowsAfter = await page.locator('.prop-row').count();
const bracketsAfter = await page.locator('.bracket-hit').count();
console.log('after reload: rows', rowsAfter, 'brackets', bracketsAfter);
if (rowsAfter !== 14) fail('rows lost after reload');
if (bracketsAfter !== bracketCount1) fail('edited structure not persisted');
await page.screenshot({ path: `${SHOTS}/4-reloaded.png`, fullPage: true });

// Home list shows the analysis.
await page.goto(BASE);
await page.waitForSelector('.analysis-link');
console.log('analysis listed on home');

await browser.close();
console.log('E2E OK');
