// The walkthrough, step by step: where each step points and what it says.
// The steps find their targets by the classes the pages already carry, so the
// tour reads the page and never asks a page to know it is being toured.

/** The pages the tour visits. Anything else is "elsewhere" and pauses it. */
export type TourPage = 'home' | 'analysis';

export interface TourStep {
  id: string;
  page: TourPage;
  title?: string;
  body: string;
  /** What the step points at; a step without one is a centered card. */
  target?: () => Element | null;
  /** Skipped when its target is not on the page (a policy hid the control). */
  optional?: boolean;
  /** No Next button: the reader moves on by doing the thing (see `clickAdvances`). */
  waitForAction?: boolean;
  /** Clicking the target is what moves the tour on. */
  clickAdvances?: boolean;
  /** Next stays disabled until this holds. */
  ready?: () => boolean;
}

/** The first of `selector` whose own text is `text`. */
function byText(selector: string, text: string): Element | null {
  for (const el of document.querySelectorAll(selector)) {
    if (el.textContent?.trim() === text) return el;
  }
  return null;
}

/** The toolbar switch labelled `label`. */
function toolbarSwitch(label: string): () => Element | null {
  return () => {
    const name = byText('.editor-toolbar .switch-label', label);
    return name?.closest('.switch') ?? null;
  };
}

/** The passage suggested for the tour: Minimal leaves some of its tree to build. */
export const TOUR_PASSAGE = 'Ephesians 1:13–14';

export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: 'welcome',
    page: 'home',
    title: 'Welcome to DaTool',
    body:
      'DaTool helps analyze Biblical texts in the original Greek. You can create DA trees ' +
      'with logical relationships, color block text by sections, and construct text flows. ' +
      'You can save and export your analyses. DaTool also has built-in logic rules and can ' +
      'give an initial construction of the DA tree. Your access to this may be limited if ' +
      'you have a student account.',
  },
  {
    id: 'passage',
    page: 'home',
    title: 'Choose a passage',
    body: `Paste a section of text or type a reference. Try ${TOUR_PASSAGE}.`,
    target: () => document.querySelector('.paste-area'),
    ready: () => {
      const area = document.querySelector<HTMLTextAreaElement>('.paste-area');
      return area !== null && area.value.trim() !== '';
    },
  },
  {
    id: 'level',
    page: 'home',
    title: 'Auto-analyze',
    body:
      'Select a level for DaTool to Auto-Analyze. Max gives a best guess at completing the ' +
      'tree, and Minimal creates only the relationships that are highly likely. Select ' +
      'Minimal for this passage.',
    target: () => document.querySelector('.level-toggle'),
    optional: true,
  },
  {
    id: 'create',
    page: 'home',
    title: 'Create',
    body: 'Click Create to begin the analysis.',
    target: () => document.querySelector('.home-page .create-button'),
    waitForAction: true,
    clickAdvances: true,
  },
  {
    id: 'text',
    page: 'analysis',
    title: 'The passage',
    body:
      'The passage is automatically broken down into logical propositions. You can click on ' +
      'a Greek word to see information about it. You can right click on a word to split its ' +
      'proposition in two. Right click on the last word in a proposition to merge it with ' +
      'the proposition below it.',
    target: () => document.querySelector('.editor-shell .ProseMirror'),
  },
  {
    id: 'blocks',
    page: 'analysis',
    title: 'Color blocks',
    body: 'Click to add or remove color block boundaries between propositions.',
    target: () => document.querySelector('.editor-shell .section-strip'),
    optional: true,
  },
  {
    id: 'tree',
    page: 'analysis',
    title: 'The tree',
    body:
      'You should see for this passage that initial relationships between propositions have ' +
      'been created. Click the dot for one proposition, then the dot for another to connect ' +
      'the two propositions logically. Select a relationship from the menu or press a key ' +
      'corresponding with a relationship. For subordinate relationships, click the star to ' +
      'change the direction. Right-click a dot to remove the relationship (this only removes ' +
      'the immediate relationship, and will not delete any higher-level relationships).',
    target: () => document.querySelector('.editor-shell .tree-viewport'),
  },
  {
    id: 'english',
    page: 'analysis',
    title: 'English',
    body: 'You can toggle the English translation appearing above the Greek.',
    target: toolbarSwitch('English'),
    optional: true,
  },
  {
    id: 'verses',
    page: 'analysis',
    title: 'Verses',
    body: 'You can display the entire passage in ESV or BSB.',
    target: () => document.querySelector('.editor-toolbar .verses-select'),
    optional: true,
  },
  {
    id: 'verbs',
    page: 'analysis',
    title: 'Verbs',
    body: 'You can toggle verb bolding.',
    target: toolbarSwitch('Verbs'),
    optional: true,
  },
  {
    id: 'blocks-toggle',
    page: 'analysis',
    title: 'Blocks',
    body: 'You can toggle color blocks.',
    target: toolbarSwitch('Blocks'),
    optional: true,
  },
  {
    id: 'color-coding',
    page: 'analysis',
    title: 'Color coding',
    body: 'You can toggle color coding for logical relationships.',
    target: toolbarSwitch('Color coding'),
    optional: true,
  },
  {
    id: 'colors',
    page: 'analysis',
    title: 'Colors',
    body:
      'You can assign custom colors to relationships. Colors… appears while color coding ' +
      'is on.',
    // The button exists only while color coding is on; the switch that brings
    // it is the next best thing to point at.
    target: () =>
      byText('.editor-toolbar button', 'Colors…') ?? toolbarSwitch('Color coding')(),
    optional: true,
  },
  {
    id: 'flow',
    page: 'analysis',
    title: 'Text flow',
    body:
      'Hit Tab or Shift-Tab to change indentation. Use Enter and Delete to split and merge ' +
      'propositions. Changes to propositions are reflected in the relation tree above.',
    target: () => document.querySelector('.textflow-panel'),
    optional: true,
  },
  {
    id: 'save',
    page: 'analysis',
    title: 'Save',
    body: 'Then hit Save to save your analysis.',
    // Save is the toolbar's one primary button.
    target: () => document.querySelector('.analysis-toolbar button.primary'),
    clickAdvances: true,
  },
];
