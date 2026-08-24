import { describe, expect, it } from 'vitest';
import { describeParsing, posName } from '../morph';

describe('posName', () => {
  it('names the MorphGNT part-of-speech codes', () => {
    expect(posName('V-')).toBe('verb');
    expect(posName('N-')).toBe('noun');
    expect(posName('RR')).toBe('relative pronoun');
    expect(posName('RA')).toBe('article');
    expect(posName('??')).toBe('??'); // unknown codes pass through
  });
});

describe('describeParsing', () => {
  it('reads a finite verb: tense voice mood, person number', () => {
    // ψευδόμεθα 1- P M I - P - -
    expect(describeParsing('V-', '1PMI-P--')).toBe(
      'verb — present middle indicative, 1st person plural',
    );
    // εἴπωμεν 1 A A S - P - -
    expect(describeParsing('V-', '1AAS-P--')).toBe(
      'verb — aorist active subjunctive, 1st person plural',
    );
  });

  it('reads a participle with its case', () => {
    // λέγων: - P A P N S M -
    expect(describeParsing('V-', '-PAPNSM-')).toBe(
      'verb — present active participle, nominative singular masculine',
    );
  });

  it('reads a noun and an adjective with degree', () => {
    expect(describeParsing('N-', '----NSF-')).toBe('noun — nominative singular feminine');
    expect(describeParsing('A-', '----NSMC')).toBe(
      'adjective — nominative singular masculine, comparative',
    );
  });

  it('degrades to the bare POS name when nothing is parsed', () => {
    expect(describeParsing('C-', '--------')).toBe('conjunction');
    expect(describeParsing('P-', '--------')).toBe('preposition');
  });
});
