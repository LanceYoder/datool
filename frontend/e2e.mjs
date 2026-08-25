// End-to-end drive of datool against the REWORKED editor UI.
//
//   home -> first pass -> create -> edit -> save -> reload
//
// The editor has no form controls: every gesture is a click on the SVG margin
// overlay or on a row. The overlay's structure (see BracketLayer.tsx) is
//
//   svg.bracket-layer.interactive
//     g.spine-layer  g.bracket[.selected][data-rel] > line …   (inert)
//     g.dot-layer    g.dot-group[data-dot][.root][.selected]  (every dot is a
//                    live, same-sized handle; .root marks disconnected units)
//     g.glyph-layer  g.label-hit[data-label] > text.bracket-label
//                    g.star-hit > text.bracket-star   (stars paint LAST)
//
// There are no bracket box hit areas: dots, labels and stars are the only
// handles. Brackets carry no state color at all — no amber "review"
// confidence coloring, no blue selected-branch stroke (both removed).
//
// SVG groups overlap, so every overlay gesture is a dispatched event on the
// exact element rather than a center-of-bbox click (except where a REAL
// pointer click is itself the thing under test). Waiting is always
// waitForFunction/waitForSelector.
//
// Run from /home/user/datool/frontend:
//   SHOTS=/tmp/shots CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node e2e.mjs
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

// BASE is the UI origin (Vite dev server by default); API the Django server.
// Point both at :8000 to drive the production single-app shape (gunicorn +
// WhiteNoise serving the built frontend — see docs/DEPLOY.md).
const SHOTS = process.env.SHOTS ?? '/tmp/e2e-shots';
const BASE = process.env.BASE ?? 'http://127.0.0.1:5173';
const API = process.env.API ?? 'http://127.0.0.1:8000';

// Colors that must NOT appear anywhere in the overlay.
const AMBER = '#b45309'; // the removed review/confidence color
const ACCENT = '#1d4ed8'; // allowed on selected DOTS only, never on branches

// Selectors for the parts of the overlay this script drives.
const SEL = {
  row: '.prop-row',
  bracket: 'g.spine-layer g.bracket',
  dot: 'g.dot-group',
  rootDot: 'g.dot-group.root',
  selectedDot: 'g.dot-group.selected',
  star: 'g.star-hit',
  label: 'g.label-hit',
  wordPopover: '.popover.word-popover',
  menu: '.popover.menu-popover',
};

mkdirSync(SHOTS, { recursive: true });

let shot = 0;
const shots = [];
let page;

async function snap(name) {
  shot += 1;
  const file = `${SHOTS}/${String(shot).padStart(2, '0')}-${name}.png`;
  // Park the pointer in dead space and drop focus first: hover-only chrome
  // ("Merge below" is opacity 0 until :hover or :focus-visible) would else show
  // up wherever the last gesture left the pointer or the focus ring. Popovers
  // and selections are state-driven, so this disturbs nothing.
  await page.mouse.move(1430, 980);
  await page.evaluate(() => {
    const el = document.activeElement;
    if (el instanceof HTMLElement && el !== document.body) el.blur();
  });
  // …then let its 90ms opacity transition finish, so it is really gone.
  await page
    .waitForFunction(
      () =>
        [...document.querySelectorAll('.merge-below')].every(
          (el) => Number(getComputedStyle(el).opacity) < 0.01,
        ),
      null,
      { timeout: 3000 },
    )
    .catch(() => {});
  await page.screenshot({ path: file, fullPage: true });
  shots.push(file);
  return file;
}

const problems = [];

async function fail(msg) {
  console.error('E2E FAIL:', msg);
  try {
    await snap('FAILURE');
  } catch {
    /* the page may be gone */
  }
  process.exit(1);
}

function ok(msg) {
  console.log('  ok  ', msg);
}

function step(msg) {
  console.log(`\n== ${msg}`);
}

/** Live count of a CSS selector (":has()" and friends run in the browser). */
function countOf(sel) {
  return page.evaluate((s) => document.querySelectorAll(s).length, sel);
}

/** Wait until `sel` matches exactly `want` nodes, else fail with the actual. */
async function expectCount(sel, want, msg) {
  try {
    await page.waitForFunction(
      ([s, n]) => document.querySelectorAll(s).length === n,
      [sel, want],
      { timeout: 8000 },
    );
  } catch {
    await fail(`${msg}: expected ${want} × "${sel}", got ${await countOf(sel)}`);
  }
  ok(`${msg}: ${want} × ${sel}`);
}

async function expectNone(sel, msg) {
  const n = await countOf(sel);
  if (n !== 0) await fail(`${msg}: "${sel}" still present (${n})`);
  ok(`${msg}: no ${sel}`);
}

/** Wait for an arbitrary browser-side predicate. */
async function waitFor(fn, arg, msg) {
  try {
    await page.waitForFunction(fn, arg, { timeout: 8000 });
  } catch {
    await fail(msg);
  }
  ok(msg);
}

// ---------------------------------------------------------------------------

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH !== undefined
    ? { executablePath: process.env.CHROMIUM_PATH }
    : {},
);
page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on('pageerror', (err) => {
  problems.push(`page error: ${err.message}`);
  console.error('PAGE ERROR:', err.message);
});
page.on('console', (m) => {
  if (m.type() === 'error') {
    problems.push(`console error: ${m.text()}`);
    console.error('CONSOLE ERROR:', m.text());
  }
});

// Build the paste from the corpus itself (1 John 1:5-7 = words 124747..124816).
const wordsRes = await page.request.get(`${API}/api/corpus/words?start=124747&end=124816`);
if (!wordsRes.ok()) await fail(`corpus fetch ${wordsRes.status()}`);
const words = await wordsRes.json();
const paste = words.map((w) => w.text).join(' ');
console.log('paste words:', words.length);

// --- (a) Home: paste, locate, create ---------------------------------------
step('(a) home: paste -> located while typing -> Create');
await page.goto(BASE);
await page.waitForSelector('.paste-area');
await page.fill('.paste-area', paste);
await snap('home-paste');

// Locating runs by itself while you type (debounced): the alignment line
// fills in without any button press, and Create arms.
await waitFor(
  () => document.querySelector('.alignment-line')?.textContent?.includes('1 John 1:5–7') === true,
  null,
  'the passage located itself while typing',
);
const alignment = (await page.textContent('.alignment-line')) ?? '';
console.log('  alignment:', alignment);
if (!alignment.includes('(exact)')) await fail(`alignment not exact: ${alignment}`);
ok('alignment line reads 1 John 1:5–7 (exact)');

await page.click('button:has-text("Create"):not([disabled])');
await page.waitForURL(/\/analysis\//);
const analysisUrl = page.url();
ok(`created ${analysisUrl}`);

// --- (b) Initial entry: the full first pass (pre-split + tree) ---------------
step('(b) initial entry: clause propositions connected into one labeled tree');
await page.waitForSelector(SEL.row);
await expectCount(SEL.row, 14, 'one row per clause segment (1 Jn 1:5–7 = 14)');
// Auto-relationing runs at entry: the exact tree shape is pinned by the
// backend goldens, so here we only require a real proposal, dynamically.
const bracketsEntry = await countOf(SEL.bracket);
console.log(`  entry brackets: ${bracketsEntry}`);
if (bracketsEntry < 5) {
  await fail(`auto-relationing should propose a real tree, got ${bracketsEntry} brackets`);
}
ok(`auto-relationing proposed ${bracketsEntry} brackets`);
await expectCount(SEL.dot, 14 + bracketsEntry, 'one dot per proposition and per bracket');
await expectCount(SEL.rootDot, 1, 'the whole passage arrives as ONE tree');
const blockLabel = (await page.locator(SEL.row).nth(0).locator('.verse-label').textContent()) ?? '';
if (blockLabel !== '5a') await fail(`first row label should be "5a", got "${blockLabel}"`);
ok(`rows carry verse-letter labels (first is ${blockLabel})`);

// A complete tree (one root) means the star walk already paints the
// passage's main point(s) red at entry — coordinate tops may fan to several.
await waitFor(
  () => document.querySelectorAll('.prop-row.main-point').length >= 1,
  null,
  'the completed entry tree shows its main point in red',
);

// Color blocks: the passage arrives as ONE undivided block — every row on
// the same muted background, one saturated band down the right edge, and no
// + / − control until the strip is hovered.
await expectCount('.section-band', 1, 'one color-block band (undivided passage)');
await expectNone('.section-control', 'no block control until the strip is hovered');
const entryBgs = await page.evaluate(() => [
  ...new Set([...document.querySelectorAll('.prop-row')].map((r) => getComputedStyle(r).backgroundColor)),
]);
if (entryBgs.length !== 1 || entryBgs[0] === 'rgba(0, 0, 0, 0)') {
  await fail(`every row should share the first block's background, got ${entryBgs.join(' / ')}`);
}
ok(`every row sits on the first block's background (${entryBgs[0]})`);

// Verbs are bold by default (the reader's toggle starts on).
await waitFor(
  () => document.querySelectorAll('.word.verb').length > 0,
  null,
  'Greek verbs are marked bold by default',
);

// The English reference line — built word-by-word from EACH row's own Greek
// (TAGNT contextual renderings) — loads above the text. Display only.
await page.waitForSelector('.prop-row .english-line');
const english0 = (await page.textContent('.prop-row .english-line')) ?? '';
if (!english0.includes('the message')) {
  await fail(`first English line looks wrong: "${english0.slice(0, 120)}…"`);
}
const englishAll = await page.evaluate(() =>
  [...document.querySelectorAll('.english-line')].map((el) => el.textContent).join(' '),
);
if (!englishAll.includes('fellowship')) await fail('English lines missing verse-6 content');
ok('word-matched English lines show above each row');
await expectCount('.english-line .ev', 3, 'verse markers at each verse start (5, 6, 7)');

// Confidence labeling is gone: nothing in the overlay is amber, and the
// stored first pass carries no review flags.
await expectNone(`[stroke="${AMBER}"], [fill="${AMBER}"]`, 'no amber/confidence coloring');

// Uniform dot geometry: one radius for every dot, and one x for every
// proposition dot — nesting depth must never move or shrink a dot.
const dotRadii = await page.evaluate(() => [
  ...new Set(
    [...document.querySelectorAll('g.dot-group circle.dot')].map((c) => c.getAttribute('r')),
  ),
]);
if (dotRadii.length !== 1) await fail(`dots have mixed radii: ${dotRadii.join(', ')}`);
ok(`every dot has the same radius (${dotRadii[0]})`);
// Distance is measured from the text column's left edge (the shell's
// padding), because the whole margin shifts when the tree gets deeper or
// shallower — the dot-to-row gap is what must never change.
const propDotDistances = () =>
  page.evaluate(() => {
    const shell = document.querySelector('.editor-shell');
    const pad = parseFloat(getComputedStyle(shell).paddingLeft);
    return [
      ...new Set(
        [...document.querySelectorAll('g.dot-group[data-dot^="prop:"] circle.dot')].map(
          (c) => pad - parseFloat(c.getAttribute('cx')),
        ),
      ),
    ];
  });
const propDist0 = await propDotDistances();
if (propDist0.length !== 1) {
  await fail(`proposition dots sit at mixed distances: ${propDist0.join(', ')}`);
}
ok(`every proposition dot sits at the same distance from its row (${propDist0[0]}px)`);

// The removed UI: selects, per-bracket star/confirm buttons, the row-selection
// mode, bracket box hit areas, the selected-branch accent, and the old
// two-tier dot classes (all dots are live handles now).
for (const [sel, what] of [
  ['.rel-select', 'relationship <select>'],
  ['.star-btn', 'star buttons'],
  ['.confirm-btn', 'confirm button'],
  ['.bracket-controls', 'bracket controls bar'],
  ['.prop-row.selected', 'row selection mode'],
  ['rect.bracket-hit', 'bracket box hit areas'],
  ['g.bracket.selected', 'selected-bracket mode'],
  ['g.dot-group.fixed', 'fixed (dead) dots'],
  ['g.dot-group.connectable', 'connectable-only dot class'],
  ['.merge-below', 'the hover Merge button (merging is a right-click now)'],
]) {
  await expectNone(sel, `old UI gone (${what})`);
}

const switchLabels = await page.locator('.editor-toolbar .switch-label').allTextContents();
console.log('  toolbar switches:', JSON.stringify(switchLabels));
if (switchLabels.join('|') !== 'English|Verbs|Blocks|Color coding') {
  await fail(`unexpected toolbar switches: ${JSON.stringify(switchLabels)}`);
}
const toolbarButtons = await page.locator('.editor-toolbar button').allTextContents();
console.log('  toolbar buttons:', JSON.stringify(toolbarButtons));
if (toolbarButtons.join('|') !== 'Undo|Redo|Clear tree|?') {
  await fail(`toolbar should hold Undo, Redo, Clear tree and ?, got ${JSON.stringify(toolbarButtons)}`);
}
ok('toolbar: four reader switches; Undo, Redo, Clear tree and help');
await snap('editor-first-pass');

// --- (c) Split after --------------------------------------------------------
step('(c) split the first proposition');
const splitRow = page.locator(SEL.row).nth(0);
const splitPid = await splitRow.getAttribute('data-pid');
const splitLabel = (await splitRow.locator('.verse-label').textContent()) ?? '';
console.log(`  splitting row 0 (${splitPid}, "${splitLabel}") after its 2nd word`);

// A left click opens the word-info card (lemma, gloss, morphology, and the
// split hint); the split itself is a RIGHT-click on the word.
await splitRow.locator('.word.splittable').nth(1).click();
await page.waitForSelector(SEL.wordPopover);
const gloss = (await page.textContent(`${SEL.wordPopover} .word-gloss`).catch(() => null)) ?? '';
const parse = (await page.textContent(`${SEL.wordPopover} .word-parse`).catch(() => null)) ?? '';
if (gloss.trim() === '') await fail('word popover shows no gloss');
if (parse.trim() === '') await fail('word popover shows no morphology');
const hint = (await page.textContent(`${SEL.wordPopover} .word-hint`).catch(() => null)) ?? '';
if (!hint.includes('Right-click')) await fail(`split hint should name the right-click: "${hint}"`);
ok(`word popover shows info ("${gloss.trim()}" · "${parse.trim()}") and the right-click hint`);
await snap('split-popover');
await page.keyboard.press('Escape');
await expectCount(SEL.wordPopover, 0, 'Escape closed the word popover');

await splitRow.locator('.word.splittable').nth(1).click({ button: 'right' });
await expectCount(SEL.row, 15, 'rows after right-click split');

const newRow = page.locator(SEL.row).nth(1);
const newPid = await newRow.getAttribute('data-pid');
// Labels re-derive from the corpus verses: verse 5 now holds six clauses, so
// the letters re-run a–f (no primes anywhere).
const headLabel = (await page.locator(SEL.row).nth(0).locator('.verse-label').textContent()) ?? '';
const newLabel = (await newRow.locator('.verse-label').textContent()) ?? '';
console.log(`  labels after split: "${headLabel}" / "${newLabel}"`);
if (headLabel !== '5a') await fail(`head label should be "5a", got "${headLabel}"`);
if (newLabel !== '5b') await fail(`second label should be "5b", got "${newLabel}"`);
ok('labels re-lettered from the verses (5a / 5b — no primes)');
// Each half shows exactly ITS OWN words' English (the DA2-example rule:
// the English matches the proposition, not the verse).
const headEnglish = (await page.locator('.prop-row .english-line').nth(0).textContent()) ?? '';
const tailEnglish = (await page.locator('.prop-row .english-line').nth(1).textContent()) ?? '';
// Head = Καὶ ἔστιν → its own two words only; "the message" starts the tail.
if (headEnglish.includes('message')) {
  await fail(`head English should stop at its own words: "${headEnglish}"`);
}
if (!tailEnglish.includes('message')) {
  await fail(`tail English missing its words: "${tailEnglish.slice(0, 100)}…"`);
}
ok('the English is divided exactly at the split point');

// Splitting a NESTED proposition unzips it out of the tree first (its
// ancestor brackets along the path dissolve), so both halves land as
// disconnected roots.
for (const pid of [splitPid, newPid]) {
  await expectCount(
    `g.dot-group.root[data-dot="prop:${pid}"]`,
    1,
    `${pid} is a disconnected root`,
  );
}
const rootsAfterSplit = await countOf(SEL.rootDot);
console.log(`  roots after split: ${rootsAfterSplit}`);
await snap('after-split');

// --- (c2) reconnect an already-connected pair by its nested dots -------------
step('(c2) connect the halves, then RE-connect them by their now-nested dots');
const bracketsBeforeC2 = await countOf(SEL.bracket);
const dotHalfA = page.locator(`g.dot-group[data-dot="prop:${splitPid}"]`);
const dotHalfB = page.locator(`g.dot-group[data-dot="prop:${newPid}"]`);

await dotHalfA.dispatchEvent('click');
await expectCount(`g.dot-group.selected[data-dot="prop:${splitPid}"]`, 1, 'root dot selected');

// Clicking the selected dot again unselects it (no modifier keys anywhere).
await dotHalfA.dispatchEvent('click');
await expectCount(SEL.selectedDot, 0, 'clicking the selected dot unselects it');
await dotHalfA.dispatchEvent('click');
await expectCount(`g.dot-group.selected[data-dot="prop:${splitPid}"]`, 1, 'and re-selects on the next click');

await dotHalfB.dispatchEvent('click');
await page.waitForSelector(SEL.menu);
await expectCount(SEL.bracket, bracketsBeforeC2 + 1, 'the halves connected into a bracket');
await page.keyboard.press('Escape');

// Both prop dots are nested now — no longer roots, but still identical
// handles: same size, same distance, still selectable, still connectable.
await expectCount(`g.dot-group.root[data-dot="prop:${splitPid}"]`, 0, 'first half is nested now');
const nestedRadius = await page
  .locator(`g.dot-group[data-dot="prop:${splitPid}"] circle.dot`)
  .getAttribute('r');
if (nestedRadius !== dotRadii[0]) {
  await fail(`a connected dot changed size: ${nestedRadius} vs ${dotRadii[0]}`);
}
const propDistNow = await propDotDistances();
if (propDistNow.length !== 1 || propDistNow[0] !== propDist0[0]) {
  await fail(
    `a connected dot moved away from its row: ${propDistNow.join(', ')} vs ${propDist0[0]}`,
  );
}
ok('connecting changed neither the dot size nor its distance from the row');

await dotHalfA.dispatchEvent('click');
await expectCount(`g.dot-group.selected[data-dot="prop:${splitPid}"]`, 1, 'a NESTED dot is selectable');
await snap('nested-dot-selected');
await dotHalfB.dispatchEvent('click');
await page.waitForSelector(SEL.menu);
await expectCount(
  SEL.bracket,
  bracketsBeforeC2 + 1,
  'reconnect dissolved the old bracket into the new one (count unchanged)',
);
ok('an already-connected pair reconnected by its dots');
await snap('reconnect-menu');

// Put the halves back on the floor: select the first half's dot and press
// Delete — removing the connections above a unit is a key (or a right-click
// on the dot), not a menu item.
await page.keyboard.press('Escape');
await dotHalfA.dispatchEvent('click');
await expectCount(SEL.selectedDot, 1, 'dot selected for deletion');
await page.keyboard.press('Delete');
await expectCount(SEL.bracket, bracketsBeforeC2, 'Delete dissolved the connection again');
await expectCount(`g.dot-group.root[data-dot="prop:${splitPid}"]`, 1, 'first half is a root again');

// --- (d) Merge -------------------------------------------------------------
step('(d) merge the split back together (right-click the last word)');
// The LAST word of a row cannot split further, so a right-click there joins
// the row with the one below it.
await page.locator(SEL.row).nth(0).locator('.word').last().click({ button: 'right' });
await expectCount(SEL.row, 14, 'back to fourteen rows after merge');
const mergedLabel = await page.locator(SEL.row).nth(0).locator('.verse-label').textContent();
if (mergedLabel !== splitLabel) await fail(`merged row label is "${mergedLabel}"`);
ok(`merged row is ${splitPid} again ("${mergedLabel}")`);

// --- (e) Dot connect --------------------------------------------------------
step('(e) connect two adjacent roots by their dots');
const bracketsBeforeConnect = await countOf(SEL.bracket);
const rootsBeforeConnect = await countOf(SEL.rootDot);
console.log(`  brackets: ${bracketsBeforeConnect}  roots: ${rootsBeforeConnect}`);
// The split/merge round trip above left several loose roots (the unzip
// dissolved the brackets over verse 5); the exact number is the analyzer's
// business — we just need enough of them to drive the connect gestures.
if (rootsBeforeConnect < 3) {
  await fail(`need at least three loose roots for the connect steps, got ${rootsBeforeConnect}`);
}

// Root dots come out in forest-root order, so any two neighbours in this
// list are adjacent roots — the plain (no unzip needed) connect case.
const dotA = page.locator(SEL.rootDot).nth(1);
const dotB = page.locator(SEL.rootDot).nth(2);
const idA = await dotA.getAttribute('data-dot');
const idB = await dotB.getAttribute('data-dot');
console.log(`  connecting ${idA} + ${idB}`);

await dotA.dispatchEvent('click');
await expectCount(SEL.selectedDot, 1, 'first dot is selected');
await expectCount(`g.dot-group.selected[data-dot="${idA}"]`, 1, `selection is on ${idA}`);
await snap('dot-selected');

await dotB.dispatchEvent('click');
await page.waitForSelector(SEL.menu);
ok('clicking the second dot connected the pair and auto-opened the relationship menu');
await expectCount(SEL.bracket, bracketsBeforeConnect + 1, 'a new bracket appeared');
await expectCount(SEL.rootDot, rootsBeforeConnect - 1, 'the two roots became one');
await snap('connect-menu');

await expectCount('g.label-hit[data-label="G"]', 0, 'no Ground bracket yet');
await page.click(`${SEL.menu} .menu-item:has(.menu-name:text-is("Ground"))`);
await expectCount(SEL.menu, 0, 'menu closed after picking a relationship');
await expectCount('g.label-hit[data-label="G"]', 1, 'the new bracket is labeled Ground (G)');
const bracketsAfterConnect = await countOf(SEL.bracket);

// Many roots remain, so the analysis is incomplete: nothing is red yet.
await expectNone('.prop-row.main-point', 'no main point while the forest is loose');

// --- (e2) Complete the tree: the main point turns red ------------------------
step('(e2) connect everything into one tree — the star walk paints the main point red');
// Ground stars child 0, so an all-Ground left-deep tree walks to row 0.
let looseRoots = await countOf(SEL.rootDot);
while (looseRoots > 1) {
  await page.locator(SEL.rootDot).nth(0).dispatchEvent('click');
  await page.locator(SEL.rootDot).nth(1).dispatchEvent('click');
  await page.waitForSelector(SEL.menu);
  await page.click(`${SEL.menu} .menu-item:has(.menu-name:text-is("Ground"))`);
  await page.waitForFunction(
    (n) => document.querySelectorAll('g.dot-group.root').length === n,
    looseRoots - 1,
    { timeout: 8000 },
  );
  looseRoots -= 1;
}
ok('every loose root reconnected into one tree (all Ground)');
await expectCount(SEL.rootDot, 1, 'everything is one tree now');
await expectCount('.prop-row.main-point', 1, 'exactly one proposition is the main point');
await waitFor(
  () => document.querySelectorAll('.prop-row')[0]?.classList.contains('main-point') === true,
  null,
  'the star walk lands on row 0 (child 0 down the Ground chain)',
);
await snap('main-point');

// --- (f) Star flip ----------------------------------------------------------
step('(f) flip a star');
await page.keyboard.press('Escape');
const starCount = await countOf(SEL.star);
if (starCount < 1) await fail('no stars to flip');
// The star is a drawn path; its geometry (the `d` attribute) moves with it.
const starBefore = await page
  .locator(`${SEL.star} path.bracket-star`)
  .first()
  .getAttribute('d');
console.log(`  ${starCount} stars; first star at ${String(starBefore).slice(0, 24)}…`);
// A REAL pointer click on the star glyph itself (not a dispatched event):
// stars paint above every label hit, so this must flip the star — a mis-hit
// that opened the relationship menu here is the regression this guards.
// (Scroll to the top first: the connect loop's menu clicks scrolled the page,
// and mouse.click works in viewport coordinates.)
await page.evaluate(() => window.scrollTo(0, 0));
const starPoint = await page.evaluate(() => {
  const t = document.querySelector('g.star-hit path.bracket-star');
  const r = t.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
await page.mouse.click(starPoint.x, starPoint.y);
await waitFor(
  (before) => {
    const t = document.querySelector('g.star-hit path.bracket-star');
    return t !== null && t.getAttribute('d') !== before;
  },
  starBefore,
  'the star moved to the other end of its bracket',
);
await expectNone(SEL.menu, 'the star click did NOT open the relationship menu');
// The red main point follows the star: the top bracket's prominence moved to
// its other side — the last-connected packet. That packet keeps its own
// entry-tree structure, so its star walk may fan across several rows;
// assert the landing row, not a count.
await waitFor(
  () => {
    const rows = document.querySelectorAll('.prop-row');
    return rows[rows.length - 1]?.classList.contains('main-point') === true;
  },
  null,
  'the main point followed the star to the other side (ends at the last row)',
);
const starAfter = await page
  .locator(`${SEL.star} path.bracket-star`)
  .first()
  .getAttribute('d');
console.log(`  star moved: ${String(starBefore).slice(0, 20)}… -> ${String(starAfter).slice(0, 20)}…`);
await expectCount(SEL.star, starCount, 'star count unchanged by the flip');

// --- (g) Label menu ---------------------------------------------------------
step('(g) label menu opens and closes; no Confirm, no branch highlight');
await page.keyboard.press('Escape');
await page.locator(SEL.label).first().dispatchEvent('click');
await page.waitForSelector(SEL.menu);
ok('clicking a label opened the relationship menu');
// Confidence labeling is gone: no Confirm item, and opening a menu paints no
// branch blue (the accent belongs to selected dots only).
await expectNone(`${SEL.menu} .menu-item.confirm`, 'no Confirm item in the menu');
await expectNone(
  `g.spine-layer line[stroke="${ACCENT}"]`,
  'no blue selected-branch stroke while a menu is open',
);
await page.keyboard.press('Escape');
await expectCount(SEL.menu, 0, 'Escape closed the menu');

// --- (h) Disconnect ---------------------------------------------------------
step('(h) right-click the outermost bracket dot to disconnect it');
const rootsBeforeDisconnect = await countOf(SEL.rootDot);
const bracketsBeforeDisconnect = await countOf(SEL.bracket);
const mainBeforeDisconnect = await countOf('.prop-row.main-point');
// Bracket dots are numbered in document pre-order, so bracket:0 is the first
// bracket — necessarily a ROOT bracket (its ancestors would precede it).
// A right-click on its dot removes the connection it names.
await page.locator('g.dot-group[data-dot="bracket:0"]').dispatchEvent('contextmenu');
await expectCount(SEL.bracket, bracketsBeforeDisconnect - 1, 'the bracket is gone');
await expectCount(SEL.rootDot, rootsBeforeDisconnect + 1, 'its children became roots');
await expectNone('.prop-row.main-point', 'the main point cleared when the tree came apart');

// --- (i) Undo / redo --------------------------------------------------------
step('(i) undo / redo the disconnect');
await page.click('.editor-toolbar button:has-text("Undo")');
await expectCount(SEL.bracket, bracketsBeforeDisconnect, 'undo restored the bracket');
await expectCount(SEL.rootDot, rootsBeforeDisconnect, 'undo restored the root count');
await expectCount(
  '.prop-row.main-point',
  mainBeforeDisconnect,
  'undo brought the main point back',
);
await page.click('.editor-toolbar button:has-text("Redo")');
await expectCount(SEL.bracket, bracketsBeforeDisconnect - 1, 'redo removed it again');
await expectCount(SEL.rootDot, rootsBeforeDisconnect + 1, 'redo restored the root count');

// --- (i2) Color blocks ------------------------------------------------------
step('(i2) color blocks: + and − on the right-edge strip, one undo step each');
await page.keyboard.press('Escape');
await page.evaluate(() => window.scrollTo(0, 0));
await expectCount('.section-band', 1, 'still one band before dividing');

// Hover the strip level with the boundary above row 2: the "+" control
// appears there (nearest boundary to the pointer).
const boundaryY = await page.evaluate(() => {
  const row = document.querySelectorAll('.prop-row')[2];
  return row.getBoundingClientRect().top;
});
const stripX = await page.evaluate(() => {
  const r = document.querySelector('.section-strip').getBoundingClientRect();
  return r.right - 7;
});
await page.mouse.move(stripX, boundaryY);
await page.waitForSelector('.section-control.add');
const plus = (await page.textContent('.section-control.add')) ?? '';
if (plus.trim() !== '+') await fail(`the add control should read "+", got "${plus}"`);
// Screenshot WITHOUT snap(): snap parks the pointer, which would dismiss the
// hover-only control this shot exists to show.
shot += 1;
const plusFile = `${SHOTS}/${String(shot).padStart(2, '0')}-strip-plus.png`;
await page.screenshot({ path: plusFile });
shots.push(plusFile);
// A REAL pointer click: the control sits inside the strip's hover surface,
// so travelling from the band to the button must keep it alive.
await page.locator('.section-control.add').click();
await expectCount('.section-band', 2, 'a second block began at the boundary');
const bandColors = await page.evaluate(() =>
  [...document.querySelectorAll('.section-band')].map((b) => getComputedStyle(b).backgroundColor),
);
if (new Set(bandColors).size !== 2) await fail(`bands share a color: ${bandColors.join(' / ')}`);
const blockBgs = await page.evaluate(() => [
  ...new Set([...document.querySelectorAll('.prop-row')].map((r) => getComputedStyle(r).backgroundColor)),
]);
if (blockBgs.length !== 2) await fail(`rows should paint two block colors, got ${blockBgs.length}`);
ok(`two blocks, two colors (bands ${bandColors.join(' / ')})`);
await snap('two-blocks');

// The same boundary now offers "−": remove the break, then UNDO restores it
// — block gestures share the history with everything else.
await page.mouse.move(stripX, boundaryY);
await page.waitForSelector('.section-control.remove');
const minus = (await page.textContent('.section-control.remove')) ?? '';
if (minus.trim() !== '−') await fail(`the remove control should read "−", got "${minus}"`);
await page.locator('.section-control.remove').click();
await expectCount('.section-band', 1, 'the blocks joined back into one');
await page.click('.editor-toolbar button:has-text("Undo")');
await expectCount('.section-band', 2, 'undo restored the block break');
ok('block gestures are single undo steps in the shared history');

// Sticky colors: divide again lower down, then remove the FIRST division —
// the bottom block must KEEP its own color, not shift to the freed one.
const boundaryY6 = await page.evaluate(() => {
  const row = document.querySelectorAll('.prop-row')[6];
  return row.getBoundingClientRect().top;
});
await page.mouse.move(stripX, boundaryY6);
await page.waitForSelector('.section-control.add');
await page.locator('.section-control.add').click();
await expectCount('.section-band', 3, 'a third block began lower down');
await page.mouse.move(stripX, boundaryY);
await page.waitForSelector('.section-control.remove');
await page.locator('.section-control.remove').click();
await expectCount('.section-band', 2, 'the first division removed again');
const stickyColors = await page.evaluate(() =>
  [...document.querySelectorAll('.section-band')].map((b) => getComputedStyle(b).backgroundColor),
);
// Dusty blue is the THIRD palette color: the lower block took it as the
// third block on screen and keeps it after the removal above — a
// position-derived scheme would repaint it sage.
if (stickyColors[1] !== 'rgb(129, 153, 180)') {
  await fail(`the lower block should keep dusty blue, got ${stickyColors.join(' / ')}`);
}
ok(`blocks keep their colors when others are removed (${stickyColors.join(' / ')})`);

const rowsFinal = await countOf(SEL.row);
const bracketsFinal = await countOf(SEL.bracket);
const rootsFinal = await countOf(SEL.rootDot);
console.log(
  `  final: rows ${rowsFinal}, brackets ${bracketsFinal}, roots ${rootsFinal}` +
    ` (connect made ${bracketsAfterConnect} brackets)`,
);
await snap('after-edits');

// --- (j) Save and reload ----------------------------------------------------
step('(j) save, reload, and check persistence');
await page.click('.analysis-toolbar button:has-text("Save")');
await page.waitForSelector('.analysis-toolbar >> text=/^Saved /', { timeout: 10_000 });
ok('"Saved" indicator shown');

await page.reload();
await page.waitForSelector(SEL.row);
await expectCount(SEL.row, rowsFinal, 'rows survived the reload');
await expectCount(SEL.bracket, bracketsFinal, 'brackets survived the reload');
await expectCount(SEL.rootDot, rootsFinal, 'roots survived the reload');
await expectNone(`[stroke="${AMBER}"], [fill="${AMBER}"]`, 'still no amber after the reload');
await expectCount('.section-band', 2, 'the color blocks survived the reload');
const reloadColors = await page.evaluate(() =>
  [...document.querySelectorAll('.section-band')].map((b) => getComputedStyle(b).backgroundColor),
);
if (reloadColors[1] !== 'rgb(129, 153, 180)') {
  await fail(`the reloaded lower block lost its stored color: ${reloadColors.join(' / ')}`);
}

const stored = await page.request.get(`${API}/api/analyses/${analysisUrl.split('/').pop()}`);
const storedDoc = (await stored.json()).document;
console.log(
  `  stored document: schemaVersion ${storedDoc.schemaVersion},` +
    ` ${storedDoc.propositions.length} propositions, ${storedDoc.forest.length} roots`,
);
if (storedDoc.schemaVersion !== 2) await fail('server did not store schemaVersion 2');
if (storedDoc.forest.length !== rootsFinal) {
  await fail(`stored forest has ${storedDoc.forest.length} roots, editor shows ${rootsFinal}`);
}
if (!Array.isArray(storedDoc.sections) || storedDoc.sections.length !== 1) {
  await fail(`stored document should carry ONE block break, got ${JSON.stringify(storedDoc.sections)}`);
}
if (storedDoc.sections[0].color !== 2) {
  await fail(`the stored break should keep color 2, got ${JSON.stringify(storedDoc.sections[0])}`);
}
ok('schemaVersion 2 forest and the block break round-tripped through the server');
await snap('after-reload');

// Home still lists it.
await page.goto(BASE);
await page.waitForSelector('.analysis-link');
ok('analysis listed on home');

await browser.close();

if (problems.length > 0) {
  console.error('\nE2E FAIL: page/console errors:');
  for (const p of problems) console.error('  -', p);
  process.exit(1);
}

console.log('\nscreenshots:');
for (const f of shots) console.log('  ', f);
console.log('\nE2E OK');
