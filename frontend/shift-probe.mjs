import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const page = await browser.newPage({ viewport: { width: 1440, height: 700 } });
const list = await (await page.request.get('http://127.0.0.1:8000/api/analyses')).json();
await page.goto(`http://127.0.0.1:5173/analysis/${list[0].id}`);
await page.waitForSelector('.section-band');

// Scroll so a mid-passage boundary sits mid-viewport (anchoring active).
await page.evaluate(() => {
  document.querySelectorAll('.prop-row')[8].scrollIntoView({ block: 'center' });
});
await page.waitForTimeout(200);
const before = await page.evaluate(() => window.scrollY);
const scrolls = [];
page.on('console', (m) => { if (m.text().startsWith('scrollY:')) scrolls.push(m.text()); });
await page.evaluate(() => {
  let n = 0;
  const log = () => { console.log('scrollY:', window.scrollY); if (++n < 30) requestAnimationFrame(log); };
  requestAnimationFrame(log);
});
const boundaryY = await page.evaluate(() => document.querySelectorAll('.prop-row')[8].getBoundingClientRect().top);
const stripX = await page.evaluate(() => document.querySelector('.section-strip').getBoundingClientRect().right - 7);
await page.mouse.move(stripX, boundaryY);
await page.waitForSelector('.section-control');
await page.locator('.section-control').click();
await page.waitForTimeout(700);
const after = await page.evaluate(() => window.scrollY);
console.log('scrollY before/after:', before, after);
console.log('frames:', [...new Set(scrolls)].join(' | '));
await browser.close();
