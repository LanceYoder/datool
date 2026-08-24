// Human-readable morphology from MorphGNT's part-of-speech and 8-slot parsing
// codes (person tense voice mood case number gender degree). Pure data — used
// by the word-info popover.

const POS: Record<string, string> = {
  'A-': 'adjective',
  'C-': 'conjunction',
  'D-': 'adverb',
  'I-': 'interjection',
  'N-': 'noun',
  'P-': 'preposition',
  RA: 'article',
  RD: 'demonstrative pronoun',
  RI: 'interrogative/indefinite pronoun',
  RP: 'personal pronoun',
  RR: 'relative pronoun',
  'V-': 'verb',
  'X-': 'particle',
};

const PERSON: Record<string, string> = { 1: '1st person', 2: '2nd person', 3: '3rd person' };
const TENSE: Record<string, string> = {
  P: 'present', I: 'imperfect', F: 'future', A: 'aorist', X: 'perfect', Y: 'pluperfect',
};
const VOICE: Record<string, string> = { A: 'active', M: 'middle', P: 'passive' };
const MOOD: Record<string, string> = {
  I: 'indicative', D: 'imperative', S: 'subjunctive', O: 'optative',
  N: 'infinitive', P: 'participle',
};
const CASE: Record<string, string> = {
  N: 'nominative', G: 'genitive', D: 'dative', A: 'accusative', V: 'vocative',
};
const NUMBER: Record<string, string> = { S: 'singular', P: 'plural' };
const GENDER: Record<string, string> = { M: 'masculine', F: 'feminine', N: 'neuter' };
const DEGREE: Record<string, string> = { C: 'comparative', S: 'superlative' };

/** The part of speech as a word ('verb', 'relative pronoun', …). */
export function posName(pos: string): string {
  return POS[pos] ?? pos;
}

/**
 * One readable line for a word's morphology, e.g.
 * "verb — present middle indicative, 1st person plural" or
 * "noun — nominative singular feminine". Empty slots are skipped; a word
 * with no parsed slots (particles, conjunctions) yields just the POS name.
 */
export function describeParsing(pos: string, parsing: string): string {
  const slot = (i: number, table: Record<string, string>): string | null =>
    table[parsing[i] ?? '-'] ?? null;

  const verbal = [slot(1, TENSE), slot(2, VOICE), slot(3, MOOD)]
    .filter((s) => s !== null)
    .join(' ');
  const person = slot(0, PERSON);
  const number = slot(5, NUMBER);
  const nominal = [slot(4, CASE), slot(5, NUMBER), slot(6, GENDER)]
    .filter((s) => s !== null)
    .join(' ');
  const degree = slot(7, DEGREE);

  const clauses: string[] = [];
  if (verbal !== '') clauses.push(verbal);
  if (person !== null && number !== null) clauses.push(`${person} ${number}`);
  // Nominal slots stand alone unless number was already spoken for above.
  if (nominal !== '' && !(person !== null && number !== null)) clauses.push(nominal);
  if (degree !== null) clauses.push(degree);

  const name = posName(pos);
  return clauses.length > 0 ? `${name} — ${clauses.join(', ')}` : name;
}
