// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import type { Editor } from '@tiptap/core';
import { buildTextById, documentToNode, nodeToDocument } from '../convert';
import { buildEditor, getDocument, setDocument } from '../editor';
import { CORPUS_WORDS, RAW_1JOHN_1_6E, firstJohn16 } from './fixtures';

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe('buildTextById', () => {
  it('joins corpus word text with spaces over half-open ranges and passes raw through', () => {
    const doc = firstJohn16();
    const text = buildTextById(doc, CORPUS_WORDS);
    expect(text.get('p1')).toBe('Ἐὰν εἴπωμεν');
    expect(text.get('p2')).toBe('ὅτι κοινωνίαν ἔχομεν μετʼ αὐτοῦ');
    expect(text.get('p3')).toBe('καὶ ἐν τῷ σκότει περιπατῶμεν,');
    expect(text.get('p4')).toBe('ψευδόμεθα');
    expect(text.get('p5')).toBe(RAW_1JOHN_1_6E);
  });

  it('resolves corpus props to empty text when no words are supplied', () => {
    const doc = firstJohn16();
    const text = buildTextById(doc);
    expect(text.get('p1')).toBe('');
    expect(text.get('p5')).toBe(RAW_1JOHN_1_6E); // raw needs no corpus
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

  it('falls back to raw source text when textById lacks an id', () => {
    const doc = firstJohn16();
    const json = documentToNode(doc, new Map());
    const p5 = JSON.stringify(json);
    expect(p5).toContain(RAW_1JOHN_1_6E);
  });

  it('throws when the tree references an unknown proposition', () => {
    const doc = firstJohn16();
    doc.tree = { kind: 'prop', ref: 'nope' };
    expect(() => documentToNode(doc, new Map())).toThrow(/unknown proposition/);
  });

  it('setDocument/getDocument round-trip on a live editor without polluting history', () => {
    const first = firstJohn16();
    editor = buildEditor();
    setDocument(editor, first, buildTextById(first, CORPUS_WORDS));
    expect(getDocument(editor, first)).toEqual(first);
    // Loading a document is not an undoable step.
    expect(editor.can().undo()).toBe(false);
  });

  it('preserves sources, labels, and colors by pid in leaf order', () => {
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
