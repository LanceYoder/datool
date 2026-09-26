// The walkthrough: a dimmed page with a window cut over one control at a time,
// and a card beside it saying what the control is for.
//
// The dim is drawn but never blocks: every click goes through to the page,
// because half the steps ask the reader to DO the thing (type the reference,
// click Create, connect two dots). Open popovers — the relationship menu, a
// word's card — get windows of their own, so a step that opens one can still
// be followed.
//
// Where the reader is in the tour is remembered in localStorage, so a reload
// resumes it; a finished or skipped tour is remembered too, and is never
// offered again on its own (the home page and the "?" panel can start it).

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { TOUR_STEPS } from './steps';
import type { TourPage, TourStep } from './steps';
import './tour.css';

const STORAGE_KEY = 'datool.tour';

/** Padding between a target and the edge of its window. */
const HOLE_PAD = 6;
/** Gap between the window and the card. */
const CARD_GAP = 14;
/** Nearest the card comes to the viewport's edge. */
const EDGE = 12;
/** How long an optional step waits for its target before it is skipped. */
const OPTIONAL_WAIT_MS = 900;
/** How long the reader may be on the wrong page before the tour says so. */
const PAUSE_WAIT_MS = 800;

type Stored = { step: number } | 'done' | null;

function loadStored(): Stored {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    if (raw === 'done') return 'done';
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as { step?: unknown }).step === 'number'
    ) {
      const step = (parsed as { step: number }).step;
      if (step >= 0 && step < TOUR_STEPS.length) return { step };
    }
    return null;
  } catch {
    return null;
  }
}

function saveStored(value: Stored): void {
  try {
    if (value === null) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, value === 'done' ? 'done' : JSON.stringify(value));
  } catch {
    /* a browser that blocks storage simply forgets where the tour was */
  }
}

interface TourApi {
  /** False outside a TourProvider: the controls that start the tour hide. */
  available: boolean;
  /** Start (or restart) the tour, at `fromId` or at the beginning. */
  start: (fromId?: string) => void;
  /** Start the tour only if this browser has never finished or skipped it. */
  offer: () => void;
}

const TourContext = createContext<TourApi>({
  available: false,
  start: () => {},
  offer: () => {},
});

export function useTour(): TourApi {
  return useContext(TourContext);
}

function pageOf(pathname: string): TourPage | null {
  if (pathname === '/') return 'home';
  if (/^\/analysis\/[^/]+\/?$/.test(pathname)) return 'analysis';
  return null;
}

export function TourProvider({ children }: { children: ReactNode }) {
  const [step, setStepState] = useState<number | null>(() => {
    const stored = loadStored();
    return stored !== null && stored !== 'done' ? stored.step : null;
  });

  const setStep = useCallback((next: number | null) => {
    setStepState(next);
    saveStored(next === null ? 'done' : { step: next });
  }, []);

  const api = useMemo<TourApi>(
    () => ({
      available: true,
      start: (fromId) => {
        const at = fromId === undefined ? 0 : TOUR_STEPS.findIndex((s) => s.id === fromId);
        setStep(Math.max(0, at));
      },
      offer: () => {
        if (loadStored() === null) setStep(0);
      },
    }),
    [setStep],
  );

  return (
    <TourContext.Provider value={api}>
      {children}
      {step !== null && <TourOverlay step={step} onStep={setStep} />}
    </TourContext.Provider>
  );
}

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

function boxOf(el: Element): Box {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

function sameBoxes(a: readonly Box[], b: readonly Box[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((box, i) => {
    const o = b[i]!;
    return (
      Math.round(box.left) === Math.round(o.left) &&
      Math.round(box.top) === Math.round(o.top) &&
      Math.round(box.width) === Math.round(o.width) &&
      Math.round(box.height) === Math.round(o.height)
    );
  });
}

/** The target's window: padded, and clipped to what can be seen. */
function holeOf(box: Box, vw: number, vh: number): Box | null {
  const left = Math.max(0, box.left - HOLE_PAD);
  const top = Math.max(0, box.top - HOLE_PAD);
  const right = Math.min(vw, box.left + box.width + HOLE_PAD);
  const bottom = Math.min(vh, box.top + box.height + HOLE_PAD);
  if (right <= left || bottom <= top) return null;
  return { left, top, width: right - left, height: bottom - top };
}

/**
 * Where the card goes: beside the window, on the first side it fits whole —
 * below, above, right, left — and failing all four, on the roomiest side,
 * pulled back inside the viewport.
 */
export function placeCard(
  hole: Box | null,
  card: { width: number; height: number },
  vw: number,
  vh: number,
): { left: number; top: number } {
  const clampX = (x: number) => Math.min(Math.max(EDGE, x), Math.max(EDGE, vw - card.width - EDGE));
  const clampY = (y: number) => Math.min(Math.max(EDGE, y), Math.max(EDGE, vh - card.height - EDGE));
  if (hole === null) {
    return { left: clampX((vw - card.width) / 2), top: clampY((vh - card.height) / 2) };
  }
  const below = vh - (hole.top + hole.height) - CARD_GAP - EDGE;
  const above = hole.top - CARD_GAP - EDGE;
  const right = vw - (hole.left + hole.width) - CARD_GAP - EDGE;
  const left = hole.left - CARD_GAP - EDGE;
  const sides = [
    { room: below, need: card.height, at: () => ({ left: clampX(hole.left), top: hole.top + hole.height + CARD_GAP }) },
    { room: above, need: card.height, at: () => ({ left: clampX(hole.left), top: hole.top - CARD_GAP - card.height }) },
    { room: right, need: card.width, at: () => ({ left: hole.left + hole.width + CARD_GAP, top: clampY(hole.top) }) },
    { room: left, need: card.width, at: () => ({ left: hole.left - CARD_GAP - card.width, top: clampY(hole.top) }) },
  ];
  const fits = sides.find((s) => s.room >= s.need);
  if (fits !== undefined) return fits.at();
  const roomiest = sides.reduce((a, b) => (b.room / b.need > a.room / a.need ? b : a));
  const at = roomiest.at();
  return { left: clampX(at.left), top: clampY(at.top) };
}

/** Bring the target into view: a tall one by its top, anything else centered. */
function reveal(el: Element): void {
  const r = el.getBoundingClientRect();
  const vh = window.innerHeight;
  if (r.height > vh * 0.6) {
    if (r.top < 60 || r.top > vh * 0.4) window.scrollBy({ top: r.top - 80, behavior: 'smooth' });
  } else if (r.top < EDGE || r.bottom > vh - EDGE) {
    // Optional-called: not every DOM has it (jsdom does not).
    el.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }
}

function TourOverlay({ step, onStep }: { step: number; onStep: (next: number | null) => void }) {
  const location = useLocation();
  const page = pageOf(location.pathname);
  const current: TourStep = TOUR_STEPS[step]!;
  const last = step === TOUR_STEPS.length - 1;

  // Which way the reader is going, so an optional step that is skipped is
  // skipped in that direction — Back past a missing control goes further back.
  const direction = useRef<1 | -1>(1);
  const go = useCallback(
    (next: number) => {
      direction.current = next < step ? -1 : 1;
      onStep(next >= TOUR_STEPS.length ? null : Math.max(0, next));
    },
    [onStep, step],
  );

  // Enter in the passage box creates the analysis without the Create step
  // ever being reached: arriving on an analysis mid-way through the home
  // steps goes straight on to the first analysis step.
  useEffect(() => {
    if (page === 'analysis' && current.page === 'home') {
      direction.current = 1;
      onStep(TOUR_STEPS.findIndex((s) => s.page === 'analysis'));
    }
  }, [page, current.page, onStep]);

  const onPage = page === current.page;

  // The measured page: the target's box and every open popover's, re-read
  // continuously — the page scrolls, the tree reflows, a menu opens.
  const [target, setTarget] = useState<Box | null>(null);
  const [popovers, setPopovers] = useState<Box[]>([]);
  const [viewport, setViewport] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [ready, setReady] = useState(current.ready === undefined);
  const targetRef = useRef<Box | null>(null);
  const popoversRef = useRef<Box[]>([]);
  const revealed = useRef(false);

  useEffect(() => {
    revealed.current = false;
    targetRef.current = null;
    setTarget(null);
  }, [step]);

  useEffect(() => {
    if (!onPage) return;
    let frame = 0;
    const measure = () => {
      const el = current.target?.() ?? null;
      if (el !== null && !revealed.current) {
        revealed.current = true;
        reveal(el);
      }
      const box = el === null ? null : boxOf(el);
      const prev = targetRef.current;
      if (box === null ? prev !== null : prev === null || !sameBoxes([box], [prev])) {
        targetRef.current = box;
        setTarget(box);
      }
      const pops = [...document.querySelectorAll('.popover')].map(boxOf);
      if (!sameBoxes(pops, popoversRef.current)) {
        popoversRef.current = pops;
        setPopovers(pops);
      }
      setViewport((v) =>
        v.w === window.innerWidth && v.h === window.innerHeight
          ? v
          : { w: window.innerWidth, h: window.innerHeight },
      );
      setReady(current.ready === undefined || current.ready());
    };
    const loop = () => {
      measure();
      frame = window.requestAnimationFrame(loop);
    };
    loop();
    // A frame loop is paused in a hidden tab; the interval keeps the card
    // honest when the tab comes back before the first frame does.
    const timer = window.setInterval(measure, 250);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearInterval(timer);
    };
  }, [onPage, current]);

  // An optional step whose control is not on the page — a class rule hid the
  // switch, the strip is turned off — is passed over.
  const hasTarget = target !== null;
  useEffect(() => {
    if (!onPage || !current.optional || hasTarget) return;
    const timer = window.setTimeout(() => {
      go(step + direction.current);
    }, OPTIONAL_WAIT_MS);
    return () => window.clearTimeout(timer);
  }, [onPage, current.optional, hasTarget, go, step]);

  // Doing the thing is how some steps are passed: the click reaches the page
  // first, and the tour moves on after it.
  useEffect(() => {
    if (!onPage || current.clickAdvances !== true) return;
    const onClick = (event: MouseEvent) => {
      const el = current.target?.() ?? null;
      if (el === null || !(event.target instanceof Node) || !el.contains(event.target)) return;
      window.setTimeout(() => go(step + 1), 0);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [onPage, current, go, step]);

  // On the wrong page for a moment: the tour waits, and says what it waits for.
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (onPage) {
      setPaused(false);
      return;
    }
    const timer = window.setTimeout(() => setPaused(true), PAUSE_WAIT_MS);
    return () => window.clearTimeout(timer);
  }, [onPage]);

  const cardRef = useRef<HTMLDivElement>(null);
  const [cardSize, setCardSize] = useState({ width: 360, height: 180 });
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (el === null) return;
    const r = el.getBoundingClientRect();
    if (Math.round(r.width) !== cardSize.width || Math.round(r.height) !== cardSize.height) {
      setCardSize({ width: Math.round(r.width), height: Math.round(r.height) });
    }
  });

  const end = () => onStep(null);

  if (!onPage) {
    if (!paused) return null;
    return (
      <div className="tour-card tour-paused" role="dialog" aria-label="Tour paused">
        <p className="tour-body">
          {current.page === 'analysis'
            ? 'The tour continues on an analysis. Create or open one to go on.'
            : 'The tour continues on the home page.'}
        </p>
        <div className="tour-actions">
          <button type="button" className="link-button" onClick={end}>
            End tour
          </button>
        </div>
      </div>
    );
  }

  // A step still waiting for its control shows nothing yet, rather than a
  // card that points at empty space and then jumps.
  if (current.target !== undefined && target === null) return null;

  const hole = target === null ? null : holeOf(target, viewport.w, viewport.h);
  const windows = popovers
    .map((p) => holeOf(p, viewport.w, viewport.h))
    .filter((b): b is Box => b !== null);
  const pos = placeCard(hole, cardSize, viewport.w, viewport.h);
  const shown = TOUR_STEPS.length;

  return (
    <>
      <svg className="tour-dim" width={viewport.w} height={viewport.h} aria-hidden="true">
        <defs>
          <mask id="tour-mask">
            <rect x={0} y={0} width={viewport.w} height={viewport.h} fill="white" />
            {hole !== null && (
              <rect x={hole.left} y={hole.top} width={hole.width} height={hole.height} rx={8} fill="black" />
            )}
            {windows.map((w, i) => (
              <rect key={i} x={w.left} y={w.top} width={w.width} height={w.height} rx={8} fill="black" />
            ))}
          </mask>
        </defs>
        <rect className="tour-shade" x={0} y={0} width={viewport.w} height={viewport.h} mask="url(#tour-mask)" />
        {hole !== null && (
          <rect
            className="tour-ring"
            x={hole.left}
            y={hole.top}
            width={hole.width}
            height={hole.height}
            rx={8}
          />
        )}
      </svg>
      <div
        ref={cardRef}
        className="tour-card"
        role="dialog"
        aria-label={current.title ?? 'Tour'}
        style={{ left: pos.left, top: pos.top }}
      >
        {step > 0 && (
          <div className="tour-count muted">
            {step} of {shown - 1}
          </div>
        )}
        {current.title !== undefined && <h3 className="tour-title">{current.title}</h3>}
        <p className="tour-body">{current.body}</p>
        <div className="tour-actions">
          <button type="button" className="link-button" onClick={end}>
            {step === 0 ? 'Skip tour' : 'End tour'}
          </button>
          <span className="tour-spacer" />
          {/* Back stays on the page: the first analysis step does not lead
              back to a Create that has already been pressed. */}
          {step > 0 && TOUR_STEPS[step - 1]!.page === current.page && (
            <button type="button" onClick={() => go(step - 1)}>
              Back
            </button>
          )}
          {current.waitForAction !== true && (
            <button
              type="button"
              className="primary"
              disabled={!ready}
              onClick={() => go(step + 1)}
            >
              {step === 0 ? 'Start tour' : last ? 'Finish' : 'Next'}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
