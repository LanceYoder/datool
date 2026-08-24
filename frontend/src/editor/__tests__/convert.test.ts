// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import type { Editor } from '@tiptap/core';
import type { Document as AnalysisDocument } from '../../types';
import {
  buildTextById,
  documentToNode,
  nodeToDocument,
  normalizeDocument,
  withoutConnections,
} from '../convert';
import { buildEditor, getDocument, setDocument } from '../editor';
import {
  CORPUS_WORDS,
  RAW_1JOHN_1_6E,
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
    const json = documentToNode(doc, buildTextById(doc, CORPUS_WORDS));
    editor = buildEditor([], json);

    // The schema accepted it verbatim…
    expect(editor.getJSON()).toEqual(json);
    // …and converting back is the identity.
    expect(nodeToDocument(editor.state.doc, doc)).toEqual(doc);
  });

  it('round-trips a disconnected forest: one doc child per root', () => {
    const doc = disconnectedDoc(); // [ a, Ser[b,c], d, e ]
    const json = documentToNode(doc, buildTextById(doc, CORPUS_WORDS));
    editor = buildEditor([], json);

    expect(editor.state.doc.childCount).toBe(4);
    expect(editor.state.doc.child(0).type.name).toBe('proposition');
    expect(editor.state.doc.child(1).type.name).toBe('bracket');
    expect(nodeToDocument(editor.state.doc, doc)).toEqual(doc);
  });

  it('round-trips a forest of nothing but loose propositions', () => {
    const doc = looseDoc();
    editor = buildEditor([], documentToNode(doc, buildTextById(doc)));
    expect(editor.state.doc.childCount).toBe(3);
    expect(nodeToDocument(editor.state.doc, doc)).toEqual(doc);
  });

  it('loads a legacy v1 document and writes it back as v2', () => {
    const v1 = firstJohn16V1();
    editor = buildEditor([], documentToNode(v1, buildTextById(v1, CORPUS_WORDS)));
    expect(editor.state.doc.childCount).toBe(1);

    const out = nodeToDocument(editor.state.doc, v1);
    expect(out.schemaVersion).toBe(2);
    expect(out).not.toHaveProperty('tree');
    expect(out).toEqual(firstJohn16()); // same analysis, v2 shape
  });

  it('falls back to raw source text when textById lacks an id', () => {
    const doc = firstJohn16();
    const json = documentToNode(doc, new Map());
    expect(JSON.stringify(json)).toContain(RAW_1JOHN_1_6E);
  });

  it('throws when the forest references an unknown proposition', () => {
    const doc = firstJohn16();
    doc.forest = [{ kind: 'prop', ref: 'nope' }];
    expect(() => documentToNode(doc, new Map())).toThrow(/unknown proposition/);
  });

  it('throws when the forest is empty (the schema requires a root)', () => {
    const doc = firstJohn16();
    doc.forest = [];
    expect(() => documentToNode(doc, new Map())).toThrow(/no forest roots/);
  });

  it('setDocument/getDocument round-trip on a live editor without polluting history', () => {
    const first = firstJohn16();
    editor = buildEditor();
    setDocument(editor, first, buildTextById(first, CORPUS_WORDS));
    expect(getDocument(editor, first)).toEqual(first);
    // Loading a document is not an undoable step.
    expect(editor.can().undo()).toBe(false);
  });

  it('preserves sources, labels, and colors by pid in leaf order across the forest', () => {
    const doc = firstJohn16();
    const json = documentToNode(doc, buildTextById(doc, CORPUS_WORDS));
    editor = buildEditor([], json);
    const out = nodeToDocument(editor.state.doc, doc);
    expect(out.propositions).toEqual(doc.propositions);
    expect(out.propositions.map((p) => p.id)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5']);
    expect(out.propositions[2]?.color).toBe('#1d4ed8');
    expect(out.propositions[4]?.source).toEqual({ kind: 'raw', text: RAW_1JOHN_1_6E });
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
