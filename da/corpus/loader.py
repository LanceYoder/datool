"""Load the MorphGNT SBLGNT data files into an in-memory corpus.

The 27 ``*-morphgnt.txt`` files in ``data/`` are the corpus of record (see
``data/ATTRIBUTION.md``). One word per line, seven space-separated columns:

    010102 V- 3AAI-S-- ἐγέννησεν ἐγέννησεν ἐγέννησε(ν) γεννάω
    ref    pos parsing text       word      norm         lemma

``ref`` is BBCCVV (book 01–27, chapter, verse). ``parsing`` is eight positions:
person, tense, voice, mood, case, number, gender, degree ('-' = n/a).
A word's index into ``load_words()`` is its stable ID; analysis documents
reference corpus text as [start, end] index ranges (inclusive).
"""

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from .normalize import fold

DATA_DIR = Path(__file__).resolve().parent / "data"

BOOK_NAMES = [
    "Matthew", "Mark", "Luke", "John", "Acts", "Romans", "1 Corinthians",
    "2 Corinthians", "Galatians", "Ephesians", "Philippians", "Colossians",
    "1 Thessalonians", "2 Thessalonians", "1 Timothy", "2 Timothy", "Titus",
    "Philemon", "Hebrews", "James", "1 Peter", "2 Peter", "1 John", "2 John",
    "3 John", "Jude", "Revelation",
]

# Sentence-final punctuation in SBLGNT: period, Greek question mark,
# raised dot (high stop). The raised dot marks a major break; the method's
# instructions treat it as a sentence-level boundary.
SENTENCE_FINAL = (".", ";", "·")

# Closing apparatus sigla / brackets / dashes that can trail the final
# punctuation in the text column (e.g. "λαλῆσαι.⸃", "ἀμήν.⟧", "Κυρηνίου·)",
# "ἀνθρώπων;—") — stripped before the sentence-end check.
_TRAILING_CLOSERS = "⸃⸅⸊⟧)]»›—–"


@dataclass(frozen=True, slots=True)
class Word:
    index: int
    book: int      # 1–27
    chapter: int
    verse: int
    pos: str       # part-of-speech code, e.g. "V-", "N-", "RA", "C-", "RR"
    parsing: str   # 8 chars: person tense voice mood case number gender degree
    text: str      # as printed, punctuation attached
    word: str      # punctuation stripped
    norm: str      # normalized form
    lemma: str

    @property
    def person(self) -> str: return self.parsing[0]
    @property
    def tense(self) -> str: return self.parsing[1]
    @property
    def voice(self) -> str: return self.parsing[2]
    @property
    def mood(self) -> str: return self.parsing[3]
    @property
    def case(self) -> str: return self.parsing[4]
    @property
    def number(self) -> str: return self.parsing[5]
    @property
    def gender(self) -> str: return self.parsing[6]
    @property
    def degree(self) -> str: return self.parsing[7]

    @property
    def is_verb(self) -> bool:
        return self.pos == "V-"

    @property
    def is_finite_verb(self) -> bool:
        # Indicative, imperative (D), subjunctive, optative.
        return self.is_verb and self.mood in "IDSO"

    @property
    def is_participle(self) -> bool:
        return self.is_verb and self.mood == "P"

    @property
    def is_infinitive(self) -> bool:
        return self.is_verb and self.mood == "N"

    @property
    def ends_sentence(self) -> bool:
        return self.text.rstrip().rstrip(_TRAILING_CLOSERS).endswith(SENTENCE_FINAL)

    @property
    def book_name(self) -> str:
        return BOOK_NAMES[self.book - 1]

    @property
    def folded(self) -> str:
        return fold(self.word)


@lru_cache(maxsize=1)
def load_words() -> tuple[Word, ...]:
    words: list[Word] = []
    for path in sorted(DATA_DIR.glob("*-morphgnt.txt")):
        with open(path, encoding="utf-8") as f:
            for line in f:
                parts = line.split()
                if len(parts) != 7:
                    continue
                ref, pos, parsing, text, word, norm, lemma = parts
                words.append(Word(
                    index=len(words),
                    book=int(ref[0:2]),
                    chapter=int(ref[2:4]),
                    verse=int(ref[4:6]),
                    pos=pos,
                    parsing=parsing,
                    text=text,
                    word=word,
                    norm=norm,
                    lemma=lemma,
                ))
    return tuple(words)


def format_ref(start: int, end: int) -> str:
    """Human reference for an inclusive word-index range, e.g. '1 John 1:5–7'."""
    words = load_words()
    a, b = words[start], words[end]
    if (a.book, a.chapter, a.verse) == (b.book, b.chapter, b.verse):
        return f"{a.book_name} {a.chapter}:{a.verse}"
    if a.book == b.book and a.chapter == b.chapter:
        return f"{a.book_name} {a.chapter}:{a.verse}–{b.verse}"
    if a.book == b.book:
        return f"{a.book_name} {a.chapter}:{a.verse}–{b.chapter}:{b.verse}"
    return f"{a.book_name} {a.chapter}:{a.verse}–{b.book_name} {b.chapter}:{b.verse}"
