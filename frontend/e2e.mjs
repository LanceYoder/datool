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
// handles.
//
// Review state is carried by COLOR only (no marker): a bracket flagged for
// review strokes its spine/labels amber (#b45309), a selected bracket strokes
// them accent blue (#1d4ed8). So "amber brackets" are counted with :has().
//
// SVG groups overlap heavily (an outer bracket's hit rect spans its children),
// so every overlay gesture is a dispatched event on the exact element rather
// than a center-of-bbox click. Waiting is always waitForFunction/waitForSelector.
//
// Run from /home/user/datool/frontend:
//   SHOTS=/tmp/shots CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node e2e.mjs
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const SHOTS = process.env.SHOTS ?? '/tmp/e2e-shots';
const BASE = 'http://127.0.0.1:5173';
const API = 'http://127.0.0.1:8000';

// Colors from layout.ts / BracketLayer.tsx.
const AMBER = '#b45309'; // REVIEW_COLOR

// Selectors for the parts of the overlay this script drives.
const SEL = {
  row: '.prop-row',
  bracket: 'g.spine-layer g.bracket',
  dot: 'g.dot-group',
  rootDot: 'g.dot-group.root',
  selectedDot: 'g.dot-group.selected',
  star: 'g.star-hit',
  label: 'g.label-hit',
  amberBracket: `g.bracket:has(line[stroke="${AMBER}"])`,
  amberLabel: `g.label-hit:has(text[fill="${AMBER}"])`,
  splitPopover: '.popover.split-popover',
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

// --- (a) Home: paste, first pass, create -----------------------------------
step('(a) home: paste -> Analyze -> Create');
await page.goto(BASE);
await page.waitForSelector('.paste-area');
await page.fill('.paste-area', paste);
await snap('home-paste');

await page.click('button:has-text("Analyze")');
await page.waitForSelector('.alignment-line');
const alignment = (await page.textContent('.alignment-line')) ?? '';
console.log('  alignment:', alignment);
if (!alignment.includes('1 John 1:5–7')) await fail(`unexpected alignment: ${alignment}`);
if (!alignment.includes('(exact)')) await fail(`alignment not exact: ${alignment}`);
ok('alignment line reads 1 John 1:5–7 (exact)');

await page.click('button:has-text("Create")');
await page.waitForURL(/\/analysis\//);
const analysisUrl = page.url();
ok(`created ${analysisUrl}`);

// --- (b) First-pass render --------------------------------------------------
step('(b) first-pass render');
await page.waitForSelector(SEL.row);
await page.waitForSelector(SEL.bracket);
await expectCount(SEL.row, 14, 'proposition rows');

const brackets0 = await countOf(SEL.bracket);
const dots0 = await countOf(SEL.dot);
const amber0 = await countOf(SEL.amberBracket);
console.log(`  brackets: ${brackets0}  dots: ${dots0}  amber: ${amber0}`);
if (brackets0 < 1) await fail('no brackets rendered');
if (dots0 !== 14 + brackets0) {
  await fail(`expected one dot per proposition and bracket (${14 + brackets0}), got ${dots0}`);
}
if (amber0 < 1) await fail('no review-flagged (amber) brackets in the first pass');
ok(`brackets and dots present (${brackets0} brackets, ${dots0} dots, ${amber0} amber)`);
await expectCount(SEL.rootDot, 1, 'first pass is one connected tree: one root dot');

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

// "Merge below" flows inline inside the text span, on every row but the last.
const rows0 = await countOf(SEL.row);
await expectCount(
  '.prop-row .prop-text .merge-below',
  rows0 - 1,
  'Merge below sits inline after the last word',
);

// The removed UI: selects, per-bracket star/confirm buttons, the row-selection
// mode, the amber review circle that used to sit above a flagged bracket, and
// the old two-tier dot classes (all dots are live handles now).
for (const [sel, what] of [
  ['.rel-select', 'relationship <select>'],
  ['.star-btn', 'star buttons'],
  ['.confirm-btn', 'confirm button'],
  ['.bracket-controls', 'bracket controls bar'],
  ['.prop-row.selected', 'row selection mode'],
  ['rect.bracket-hit', 'bracket box hit areas'],
  [`circle[fill="${AMBER}"]`, 'amber marker circle'],
  ['g.dot-group.fixed', 'fixed (dead) dots'],
  ['g.dot-group.connectable', 'connectable-only dot class'],
]) {
  await expectNone(sel, `old UI gone (${what})`);
}

const toolbarButtons = await page.locator('.editor-toolbar button').allTextContents();
console.log('  toolbar buttons:', JSON.stringify(toolbarButtons));
if (toolbarButtons.join('|') !== 'Undo|Redo') {
  await fail(`toolbar should hold Undo and Redo only, got ${JSON.stringify(toolbarButtons)}`);
}
ok('toolbar has Undo and Redo only');
await snap('editor-first-pass');

// --- (c) Split after --------------------------------------------------------
step('(c) split a proposition');
const splitRow = page.locator(SEL.row).nth(6);
const splitPid = await splitRow.getAttribute('data-pid');
const splitLabel = (await splitRow.locator('.verse-label').textContent()) ?? '';
console.log(`  splitting row 6 (${splitPid}, "${splitLabel}") after its 2nd word`);

await splitRow.locator('.word.splittable').nth(1).click();
await page.waitForSelector(SEL.splitPopover);
const splitText = (await page.textContent(`${SEL.splitPopover} .popover-item`)) ?? '';
if (splitText.trim() !== 'Split after') await fail(`unexpected popover: "${splitText}"`);
ok('"Split after" popover appeared beside the word');
await snap('split-popover');

await page.click(`${SEL.splitPopover} .popover-item`);
await expectCount(SEL.row, 15, 'rows after split');

const newRow = page.locator(SEL.row).nth(7);
const newPid = await newRow.getAttribute('data-pid');
const newLabel = (await newRow.locator('.verse-label').textContent()) ?? '';
console.log(`  new row: ${newPid} "${newLabel}"`);
if (newLabel !== `${splitLabel}′`) {
  await fail(`new row label should be "${splitLabel}′", got "${newLabel}"`);
}
ok(`new row carries the prime mark (${newLabel})`);

// Both halves are now disconnected roots.
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

// The fresh bracket is a root, so its open menu offers Disconnect — use it to
// put the two halves back on the floor for the merge step.
await page.click(`${SEL.menu} .menu-item.action:text-is("Disconnect")`);
await expectCount(SEL.bracket, bracketsBeforeC2, 'Disconnect dissolved the bracket again');
await expectCount(`g.dot-group.root[data-dot="prop:${splitPid}"]`, 1, 'first half is a root again');

// --- (d) Merge below --------------------------------------------------------
step('(d) merge the split back together');
await page.locator(SEL.row).nth(6).hover();
const mergeBtn = page.locator(SEL.row).nth(6).locator('.merge-below');
await waitFor(
  () => {
    const el = document.querySelectorAll('.prop-row')[6]?.querySelector('.merge-below');
    return el !== null && el !== undefined && getComputedStyle(el).opacity === '1';
  },
  null,
  '"Merge below" revealed on row hover',
);
if ((await mergeBtn.textContent()) !== 'Merge below') await fail('merge button text changed');
await mergeBtn.click();
await expectCount(SEL.row, 14, 'rows after merge');
const mergedLabel = await page.locator(SEL.row).nth(6).locator('.verse-label').textContent();
if (mergedLabel !== splitLabel) await fail(`merged row label is "${mergedLabel}"`);
ok(`merged row is ${splitPid} again ("${mergedLabel}")`);

// --- (e) Dot connect --------------------------------------------------------
step('(e) connect two adjacent roots by their dots');
const bracketsBeforeConnect = await countOf(SEL.bracket);
const rootsBeforeConnect = await countOf(SEL.rootDot);
console.log(`  brackets: ${bracketsBeforeConnect}  roots: ${rootsBeforeConnect}`);
if (rootsBeforeConnect < 3) await fail('split/merge did not leave enough disconnected roots');

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

// --- (f) Star flip ----------------------------------------------------------
step('(f) flip a star');
await page.keyboard.press('Escape');
const starCount = await countOf(SEL.star);
if (starCount < 1) await fail('no stars to flip');
const starBefore = await page
  .locator(`${SEL.star} text.bracket-star`)
  .first()
  .getAttribute('y');
console.log(`  ${starCount} stars; first star y=${starBefore}`);
// A REAL pointer click on the star glyph itself (not a dispatched event):
// stars paint above every label hit, so this must flip the star — a mis-hit
// that opened the relationship menu here is the regression this guards.
const starPoint = await page.evaluate(() => {
  const t = document.querySelector('g.star-hit text.bracket-star');
  const r = t.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
await page.mouse.click(starPoint.x, starPoint.y);
await waitFor(
  (before) => {
    const t = document.querySelector('g.star-hit text.bracket-star');
    return t !== null && t.getAttribute('y') !== before;
  },
  starBefore,
  'the star moved to the other end of its bracket',
);
await expectNone(SEL.menu, 'the star click did NOT open the relationship menu');
const starAfter = await page
  .locator(`${SEL.star} text.bracket-star`)
  .first()
  .getAttribute('y');
console.log(`  star y: ${starBefore} -> ${starAfter}`);
await expectCount(SEL.star, starCount, 'star count unchanged by the flip');

// --- (g) Label menu + Confirm ----------------------------------------------
step('(g) label menu opens and closes; Confirm clears a review flag');
await page.keyboard.press('Escape');
await page.locator(SEL.label).first().dispatchEvent('click');
await page.waitForSelector(SEL.menu);
ok('clicking a label opened the relationship menu');
await page.keyboard.press('Escape');
await expectCount(SEL.menu, 0, 'Escape closed the menu');

const amberBefore = await countOf(SEL.amberBracket);
console.log(`  amber (review-flagged) brackets: ${amberBefore}`);
if (amberBefore < 1) await fail('no amber brackets left to confirm');
await page.locator(SEL.amberLabel).first().dispatchEvent('click');
await page.waitForSelector(`${SEL.menu} .menu-item.confirm`);
ok('a review-flagged bracket offers Confirm');
await page.click(`${SEL.menu} .menu-item.confirm`);
await page.keyboard.press('Escape'); // drop the selection so colors read true
await expectCount(SEL.amberBracket, amberBefore - 1, 'Confirm cleared one review flag');

// --- (h) Disconnect ---------------------------------------------------------
step('(h) disconnect the outermost bracket');
const rootsBeforeDisconnect = await countOf(SEL.rootDot);
const bracketsBeforeDisconnect = await countOf(SEL.bracket);
// Label groups render in document pre-order, so the FIRST label in the DOM
// belongs to the first bracket — necessarily a ROOT bracket (its ancestors
// would precede it). A root bracket's menu offers Disconnect.
await page.locator(SEL.label).first().dispatchEvent('click');
await page.waitForSelector(`${SEL.menu} .menu-item.action`);
const actions = await page.locator(`${SEL.menu} .menu-item.action`).allTextContents();
console.log('  menu actions:', JSON.stringify(actions));
if (!actions.includes('Disconnect')) await fail('a root bracket did not offer Disconnect');
await page.click(`${SEL.menu} .menu-item.action:text-is("Disconnect")`);
await expectCount(SEL.bracket, bracketsBeforeDisconnect - 1, 'the bracket is gone');
await expectCount(SEL.rootDot, rootsBeforeDisconnect + 1, 'its children became roots');

// --- (i) Undo / redo --------------------------------------------------------
step('(i) undo / redo the disconnect');
await page.click('.editor-toolbar button:has-text("Undo")');
await expectCount(SEL.bracket, bracketsBeforeDisconnect, 'undo restored the bracket');
await expectCount(SEL.rootDot, rootsBeforeDisconnect, 'undo restored the root count');
await page.click('.editor-toolbar button:has-text("Redo")');
await expectCount(SEL.bracket, bracketsBeforeDisconnect - 1, 'redo removed it again');
await expectCount(SEL.rootDot, rootsBeforeDisconnect + 1, 'redo restored the root count');

const rowsFinal = await countOf(SEL.row);
const bracketsFinal = await countOf(SEL.bracket);
const rootsFinal = await countOf(SEL.rootDot);
const amberFinal = await countOf(SEL.amberBracket);
console.log(
  `  final: rows ${rowsFinal}, brackets ${bracketsFinal}, roots ${rootsFinal}, amber ${amberFinal}` +
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
await page.waitForSelector(SEL.bracket);
await expectCount(SEL.row, rowsFinal, 'rows survived the reload');
await expectCount(SEL.bracket, bracketsFinal, 'brackets survived the reload');
await expectCount(SEL.rootDot, rootsFinal, 'roots survived the reload');
await expectCount(SEL.amberBracket, amberFinal, 'review flags survived the reload');

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
ok('schemaVersion 2 forest round-tripped through the server');
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
