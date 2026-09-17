// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Editor } from '@tiptap/core';
import type { Document as AnalysisDocument } from '../../types';
import type { Forest } from '../../tree/core';
import { formatForest } from '../../tree/core';
import {
  buildTextById,
  documentToNode,
  nodeToDocument,
  normalizeDocument,
  trySnapshot,
  withoutConnections,
} from '../convert';
import { buildEditor, getDocument, setDocument } from '../editor';
import { TREE_POS, readTree } from '../schema';
import {
  CORPUS_WORDS,
  RAW_1JOHN_1_6E,
  TAXONOMY,
  disconnectedDoc,
  firstJohn16,
  firstJohn16V1,
  looseDoc,
} from './fixtures';

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe('buildTextById', () => {
  it('joins corpus word text with spaces over inclusive ranges and passes raw through', () => {
    const doc = firstJohn16();
    const text = buildTextById(doc, CORPUS_WORDS);
    expect(text.get('p1')).toBe('ἐὰν εἴπωμεν');
    expect(text.get('p2')).toBe('ὅτι κοινωνίαν ἔχομεν μετ’ αὐτοῦ');
    expect(text.get('p3')).toBe('καὶ ἐν τῷ σκότει περιπατῶμεν,');
    expect(text.get('p4')).toBe('ψευδόμεθα'); // single-word inclusive range
    expect(text.get('p5')).toBe(RAW_1JOHN_1_6E);
  });

  it('resolves corpus props to empty text when no words are supplied', () => {
    const doc = firstJohn16();
    const text = buildTextById(doc);
    expect(text.get('p1')).toBe('');
    expect(text.get('p5')).toBe(RAW_1JOHN_1_6E); // raw needs no corpus
  });
});

describe('normalizeDocument', () => {
  it('lifts a legacy v1 tree into a forest of one', () => {
    const v1 = firstJohn16V1();
    const out = normalizeDocument(v1);
    expect(out.schemaVersion).toBe(2);
    expect(out.forest).toEqual([v1.tree]);
    expect(out.propositions).toBe(v1.propositions);
    expect(out).not.toHaveProperty('tree');
  });

  it('passes a v2 forest through unchanged', () => {
    const v2 = disconnectedDoc();
    const out = normalizeDocument(v2);
    expect(out.schemaVersion).toBe(2);
    expect(out.forest).toEqual(v2.forest);
  });

  it('degrades a document with neither tree nor forest to one root per proposition', () => {
    const bare: AnalysisDocument = {
      schemaVersion: 2,
      propositions: looseDoc().propositions,
    };
    expect(normalizeDocument(bare).forest).toEqual([
      { kind: 'prop', ref: 'a' },
      { kind: 'prop', ref: 'b' },
      { kind: 'prop', ref: 'c' },
    ]);
  });
});

describe('documentToNode / nodeToDocument', () => {
  it('round-trips the worked 1 John 1:6 document through the editor', () => {
    const doc = firstJohn16();
    const json = documentToNode(doc, buildTextById(doc, CORPUS_WORDS), TAXONOMY);
    editor = buildEditor([], json);

    // The schema accepted it verbatim…
    expect(editor.getJSON()).toEqual(json);
    // …and converting back is the identity.
    expect(nodeToDocument(editor.state.doc, doc, TAXONOMY)).toEqual(doc);
  });

  it('round-trips a disconnected forest through a FLAT doc and its tree attr', () => {
    const doc = disconnectedDoc(); // [ a, Ser[b,c], d, e ]
    const json = documentToNode(doc, buildTextById(doc, CORPUS_WORDS), TAXONOMY);
    editor = buildEditor([], json);

    // The document is the tree's carrier and then the PROPOSITIONS, one child
    // each, in reading order — whatever the tree over them says (§7.7). There
    // is no bracket node left to find, and no way to write one.
    const live = editor.state.doc;
    expect(live.childCount).toBe(6);
    expect([...Array(live.childCount).keys()].map((i) => live.child(i).type.name)).toEqual(
      ['treeState', ...Array(5).fill('proposition')],
    );
    expect(live.type.schema.nodes.bracket).toBeUndefined();
    expect(live.type.schema.nodes.hole).toBeUndefined();
    // ...and the structure is the core Forest on the treeState node.
    expect(formatForest(readTree(live))).toBe('[a, Ser[b, c], d, e]');
    expect(nodeToDocument(live, doc, TAXONOMY)).toEqual(doc);
  });

  it('round-trips a forest of nothing but loose propositions', () => {
    const doc = looseDoc();
    editor = buildEditor([], documentToNode(doc, buildTextById(doc), TAXONOMY));
    expect(editor.state.doc.childCount).toBe(4); // the carrier, then three
    expect(nodeToDocument(editor.state.doc, doc, TAXONOMY)).toEqual(doc);
  });

  it('loads a legacy v1 document and writes it back as v2', () => {
    const v1 = firstJohn16V1();
    editor = buildEditor([], documentToNode(v1, buildTextById(v1, CORPUS_WORDS), TAXONOMY));
    expect(editor.state.doc.childCount).toBe(6); // the carrier + the propositions, flat

    const out = nodeToDocument(editor.state.doc, v1, TAXONOMY);
    expect(out.schemaVersion).toBe(2);
    expect(out).not.toHaveProperty('tree');
    expect(out).toEqual(firstJohn16()); // same analysis, v2 shape
  });

  it('falls back to raw source text when textById lacks an id', () => {
    const doc = firstJohn16();
    const json = documentToNode(doc, new Map(), TAXONOMY);
    expect(JSON.stringify(json)).toContain(RAW_1JOHN_1_6E);
  });

  // §7.5, ruling Q2: a forest the MODEL cannot hold is not repaired and not
  // refused — the propositions open without it, and the analyst is warned. No
  // binarizer, no legacy path, and never a thrown load.
  it.each([
    ['a forest that drops propositions', [{ kind: 'prop' as const, ref: 'p1' }]],
    ['an empty forest', []],
    [
      'an N-ARY bracket (deletable per Q2)',
      [{
        kind: 'bracket' as const,
        rel: 'Ser',
        prominent: null,
        children: ['p1', 'p2', 'p3', 'p4', 'p5'].map((ref) => ({ kind: 'prop' as const, ref })),
      }],
    ],
    [
      'a room where the model forbids one',
      [{
        kind: 'bracket' as const,
        rel: 'Ser',
        prominent: 0, // I7: a coordinate relationship may not carry a star
        children: [{ kind: 'prop' as const, ref: 'p1' }, { kind: 'prop' as const, ref: 'p2' }],
      }],
    ],
  ])('opens %s without connections, and warns', (_what, forest) => {
    const doc = firstJohn16();
    doc.forest = forest;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      editor = buildEditor([], documentToNode(doc, new Map(), TAXONOMY));
      expect(warn).toHaveBeenCalledOnce();
    } finally {
      warn.mockRestore();
    }
    // Every proposition survived, each a root of its own.
    expect(editor.state.doc.childCount).toBe(6);
    expect(formatForest(readTree(editor.state.doc))).toBe('[p1, p2, p3, p4, p5]');
    expect(nodeToDocument(editor.state.doc, doc, TAXONOMY).forest).toEqual(
      doc.propositions.map((prop) => ({ kind: 'prop', ref: prop.id })),
    );
  });

  it('throws only when there are no propositions at all', () => {
    const doc: AnalysisDocument = { schemaVersion: 2, propositions: [], forest: [] };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => documentToNode(doc, new Map(), TAXONOMY)).toThrow(/no propositions/);
    warn.mockRestore();
  });

  it('setDocument/getDocument round-trip on a live editor without polluting history', () => {
    const first = firstJohn16();
    editor = buildEditor();
    setDocument(editor, first, buildTextById(first, CORPUS_WORDS), TAXONOMY);
    expect(getDocument(editor, first, TAXONOMY)).toEqual(first);
    // Loading a document is not an undoable step.
    expect(editor.can().undo()).toBe(false);
  });

  it('preserves sources, labels, and colors by pid in leaf order across the forest', () => {
    const doc = firstJohn16();
    const json = documentToNode(doc, buildTextById(doc, CORPUS_WORDS), TAXONOMY);
    editor = buildEditor([], json);
    const out = nodeToDocument(editor.state.doc, doc, TAXONOMY);
    expect(out.propositions).toEqual(doc.propositions);
    expect(out.propositions.map((p) => p.id)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5']);
    expect(out.propositions[2]?.color).toBe('#1d4ed8');
    expect(out.propositions[4]?.source).toEqual({ kind: 'raw', text: RAW_1JOHN_1_6E });
  });

  it('normalizes legacy pid-string breaks in and rides them on their propositions', () => {
    const doc = disconnectedDoc();
    doc.sections = ['c', 'ghost', 'e']; // legacy shape; 'ghost' names no proposition
    editor = buildEditor([], documentToNode(doc, buildTextById(doc, CORPUS_WORDS), TAXONOMY));
    // Colors are derived from position at load and frozen there. 'ghost' has
    // no proposition to ride, so it simply does not arrive.
    expect(nodeToDocument(editor.state.doc, doc, TAXONOMY).sections).toEqual([
      { start: 'c', color: 1 },
      { start: 'e', color: 3 },
    ]);
  });

  it('omits sections from the emitted document when there are no breaks', () => {
    const doc = disconnectedDoc();
    editor = buildEditor([], documentToNode(doc, buildTextById(doc, CORPUS_WORDS), TAXONOMY));
    expect('sections' in nodeToDocument(editor.state.doc, doc, TAXONOMY)).toBe(false);
  });
});

describe('holes', () => {
  /** What deleting one relationship leaves: Ser[a, hole[b, c]]. */
  const withHole = (): AnalysisDocument => {
    const doc = looseDoc();
    doc.forest = [{
      kind: 'bracket',
      rel: 'Ser',
      prominent: null,
      children: [
        { kind: 'prop', ref: 'a' },
        { kind: 'hole', children: [{ kind: 'prop', ref: 'b' }, { kind: 'prop', ref: 'c' }] },
      ],
    }];
    return doc;
  };

  it('round-trips an analysis with an edit half-made', () => {
    // A room is CURRENT model, not legacy (§1), and a real state worth
    // storing: it loads as a HANGING SIDE of the bracket above it, and the
    // wire adapter writes that side back out as the same `hole` node.
    const doc = withHole();
    editor = buildEditor([], documentToNode(doc, buildTextById(doc), TAXONOMY));
    expect(formatForest(readTree(editor.state.doc))).toBe('[Ser[a, ⟨b c⟩]]');
    expect(nodeToDocument(editor.state.doc, doc, TAXONOMY)).toEqual(doc);
  });

  it('reads a stored tree only when the MINT is there too, and opens flat otherwise', () => {
    // The attribute carries `{roots, nextId}` (§7.2) and the two halves are
    // not optional: `nextId` is the id mint (§7.3). A value with roots but no
    // mint would cast cleanly and then hand every op an undefined counter —
    // the next connect mints NaN, and the failure surfaces as a broken
    // invariant rather than as its cause — so the shape is refused at the door
    // and the propositions open as roots of their own instead.
    const doc = looseDoc();
    editor = buildEditor([], documentToNode(doc, buildTextById(doc), TAXONOMY));
    const stored = readTree(editor.state.doc);
    expect(stored.nextId).toBe(0); // three leaves, no bracket ever minted

    const ed = editor;
    const put = (value: unknown): Forest => {
      ed.view.dispatch(ed.state.tr.setNodeAttribute(TREE_POS, 'tree', value));
      return readTree(ed.state.doc);
    };
    const flat = '[a, b, c]';
    expect(formatForest(put({ roots: stored.roots }))).toBe(flat); // no mint
    expect(formatForest(put({ roots: stored.roots, nextId: '4' }))).toBe(flat);
    expect(formatForest(put({ nextId: 4 }))).toBe(flat); // no roots
    expect(formatForest(put(null))).toBe(flat);
    // …and a whole one is passed straight through, mint included.
    expect(put({ roots: stored.roots, nextId: 7 }).nextId).toBe(7);
  });

  it('has no wire snapshot at all while a join is UNLABELED (§7.4, Q6)', () => {
    // The state the connect actually mints: legal in the core, unstorable on
    // the wire, and a docTick fires on it. The snapshot says so by name rather
    // than inventing a spelling, and the save path throws instead of writing
    // a document the server would reject.
    const doc = looseDoc();
    editor = buildEditor([], documentToNode(doc, buildTextById(doc), TAXONOMY));
    const forest = readTree(editor.state.doc);
    const joined = {
      roots: [
        { kind: 'bracket' as const, id: 9, rel: null, star: null,
          left: [forest.roots[0]!], right: [forest.roots[1]!] },
        forest.roots[2]!,
      ],
      nextId: 10,
    };
    editor.view.dispatch(editor.state.tr.setNodeAttribute(TREE_POS, 'tree', joined));

    const snapshot = trySnapshot(editor.state.doc, doc, TAXONOMY);
    expect(snapshot.ok).toBe(false);
    if (!snapshot.ok) {
      expect(snapshot.reason.code).toBe('unlabeled');
      expect(snapshot.reason.bracketId).toBe(9);
    }
    expect(() => nodeToDocument(editor!.state.doc, doc, TAXONOMY)).toThrow(/no relationship/);
  });

  it('opens a hole where one cannot stand, and leaves every other one alone', () => {
    // A waiting room is never a root and never holds another waiting room —
    // whatever a document from elsewhere says. What it MAY do, since §10 A1:
    // hold a single lodger. Nothing collapses that back into the slot.
    const doc = looseDoc();
    doc.forest = [
      { kind: 'hole', children: [{ kind: 'prop', ref: 'a' }] },
      {
        kind: 'bracket',
        rel: 'Ser',
        prominent: null,
        children: [
          { kind: 'prop', ref: 'b' },
          { kind: 'hole', children: [{ kind: 'hole', children: [{ kind: 'prop', ref: 'c' }] }] },
        ],
      },
    ];
    const settled = normalizeDocument(doc).forest;
    expect(settled).toEqual([
      { kind: 'prop', ref: 'a' }, // a root waits for nothing
      {
        kind: 'bracket',
        rel: 'Ser',
        prominent: null,
        // the nested hole flattens — and STAYS a hole, holding its one lodger
        children: [{ kind: 'prop', ref: 'b' }, { kind: 'hole', children: [
          { kind: 'prop', ref: 'c' },
        ] }],
      },
    ]);

    // And the same on the way out: the editor's schema is looser than the
    // model, so nothing the server would refuse is written.
    editor = buildEditor([], documentToNode(doc, buildTextById(doc), TAXONOMY));
    expect(nodeToDocument(editor.state.doc, doc, TAXONOMY).forest).toEqual(settled);
  });

  it('KEEPS a bracket that hangs at both ends (§10 A4)', () => {
    // v3 dissolved this shape on the way in. The analyst's ruling — "only
    // validate the tree structure when there are no holes remaining" — makes
    // it an ordinary work-in-progress: it loads as it stands, and the analyst
    // finishes it when they choose.
    const doc = looseDoc(); // props a, b, c
    doc.propositions.push(
      { id: 'd', label: '6d', source: { kind: 'raw', text: 'd' } },
      { id: 'e', label: '6e', source: { kind: 'raw', text: 'e' } },
    );
    const room = (...refs: string[]) => ({
      kind: 'hole' as const,
      children: refs.map((ref) => ({ kind: 'prop' as const, ref })),
    });
    doc.forest = [{
      kind: 'bracket',
      rel: 'Ser',
      prominent: null,
      children: [
        // Both members are rooms, so this Alt says nothing…
        { kind: 'bracket', rel: 'Alt', prominent: null, children: [room('a', 'b'), room('c', 'd')] },
        { kind: 'prop', ref: 'e' },
      ],
    }];

    expect(normalizeDocument(doc).forest).toEqual(doc.forest); // untouched
    // …and it survives the whole load/save trip, holes and all.
    editor = buildEditor([], documentToNode(doc, buildTextById(doc), TAXONOMY));
    expect(nodeToDocument(editor.state.doc, doc, TAXONOMY).forest).toEqual(doc.forest);

    // At the forest FLOOR a hole still cannot stand: a root is unattached
    // already, so what it held becomes roots.
    doc.forest = [
      { kind: 'bracket', rel: 'Alt', prominent: null, children: [room('a', 'b'), room('c', 'd')] },
      { kind: 'prop', ref: 'e' },
    ];
    expect(normalizeDocument(doc).forest).toEqual([
      { kind: 'bracket', rel: 'Alt', prominent: null, children: [room('a', 'b'), room('c', 'd')] },
      { kind: 'prop', ref: 'e' },
    ]);
    doc.forest = [room('a', 'b'), { kind: 'prop', ref: 'c' }];
    expect(normalizeDocument(doc).forest).toEqual(
      ['a', 'b', 'c'].map((ref) => ({ kind: 'prop', ref })),
    );
  });

  it('keeps the leaves in order while settling', () => {
    const doc = withHole();
    doc.forest = [{
      kind: 'hole',
      children: [
        { kind: 'prop', ref: 'a' },
        { kind: 'hole', children: [{ kind: 'prop', ref: 'b' }, { kind: 'prop', ref: 'c' }] },
      ],
    }];
    expect(normalizeDocument(doc).forest).toEqual([
      { kind: 'prop', ref: 'a' },
      { kind: 'prop', ref: 'b' },
      { kind: 'prop', ref: 'c' },
    ]);
  });
});

describe('withoutConnections', () => {
  it('leaves every proposition a root, in document order', () => {
    const doc = firstJohn16();
    const flat = withoutConnections(doc);
    expect(flat.forest).toEqual(doc.propositions.map((p) => ({ kind: 'prop', ref: p.id })));
    expect(flat.propositions).toEqual(doc.propositions);
    expect(flat.schemaVersion).toBe(2);
  });

  it('flattens a legacy v1 tree too, and never mutates its input', () => {
    const v1 = firstJohn16V1();
    const before = JSON.stringify(v1);
    const flat = withoutConnections(v1);
    expect(flat.forest.every((node) => node.kind === 'prop')).toBe(true);
    expect(flat.forest).toHaveLength(v1.propositions.length);
    expect(JSON.stringify(v1)).toBe(before);
  });
});
