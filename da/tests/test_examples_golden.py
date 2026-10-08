"""Golden tests against the four worked analyses in examples/.

Each spreadsheet holds a student's completed discourse analysis (NT 003).
The Greek proposition rows are the ground truth for segmentation: pasting
them re-joined must align (the students pasted NA28, which differs from
SBLGNT by occasional one-word insertions/omissions — the gapped aligner must
absorb that), and the first pass's segment boundaries must agree with the
student's clause boundaries up to the DOCUMENTED scope cuts:

  * implicit propositions — phrases without a verb that the method optionally
    splits out (appositions like Eph 1:13 τὸ εὐαγγέλιον…, prepositional
    phrases like Eph 1:14 εἰς ἀπολύτρωσιν / εἰς ἔπαινον, relative-article
    phrases like Phil 1:11 τὸν διὰ Ἰησοῦ Χριστοῦ) are a manual-editor step in
    v1, not a first-pass product;
  * a couple of named heuristic gaps (indirect questions, chained bare
    infinitives) listed per passage below.

The invariant direction is strict: the tool must never split where the
student did not.
"""

import difflib
import re
import unicodedata
from collections import Counter
from pathlib import Path

import pytest

openpyxl = pytest.importorskip("openpyxl")

from da.corpus import align, load_words
from da.corpus.normalize import tokenize
from da.segmentation import segment

EXAMPLES = Path(__file__).resolve().parent.parent.parent / "examples"
GREEK = re.compile(r"[Ͱ-Ͽἀ-῿]")


def student_rows(filename: str) -> list[str]:
    """The Greek proposition lines of one example, in reading order."""
    wb = openpyxl.load_workbook(EXAMPLES / filename)
    ws = wb.active
    counts: Counter[str] = Counter()
    for row in ws.iter_rows():
        for cell in row:
            if isinstance(cell.value, str) and len(GREEK.findall(cell.value)) > 3:
                counts[cell.column_letter] += 1
    column = counts.most_common(1)[0][0]
    rows = []
    for row in ws.iter_rows():
        for cell in row:
            if cell.column_letter != column or not isinstance(cell.value, str):
                continue
            value = cell.value.strip()
            if value and len(GREEK.findall(value)) > len(value) * 0.3:
                rows.append(value)
    return rows


def boundary_positions(rows: list[str], start: int, end: int) -> set[int]:
    """Corpus positions of the student's proposition boundaries, mapped
    through a token-level sequence match (absorbing NA28/SBLGNT word
    insertions on either side)."""
    tokens = [t for row in rows for t in tokenize(row)]
    words = load_words()
    window = [words[i].folded for i in range(start, end + 1)]
    matcher = difflib.SequenceMatcher(None, tokens, window, autojunk=False)
    mapping: dict[int, int] = {}
    for block in matcher.get_matching_blocks():
        for k in range(block.size):
            mapping[block.a + k] = start + block.b + k

    positions: set[int] = set()
    offset = 0
    for row in rows[:-1]:
        offset += len(tokenize(row))
        # The boundary sits before the first mapped token at/after `offset`.
        for probe in range(offset, len(tokens)):
            if probe in mapping:
                positions.add(mapping[probe])
                break
    return positions


CASES = [
    # (file, expected ref, allowed student-only boundary openers (folded))
    (
        "Discourse Analysis 1 - NT 003 - James Jourlait.xlsx",
        "1 John 1:5–7",
        [],
    ),
    (
        "Discourse Analysis 2 - NT 003 - James Jourlait.xlsx",
        "Philippians 1:9–11",
        [],  # τὸν διὰ Ἰησοῦ Χριστοῦ splits via the attributive-article rule
    ),
    (
        "Discourse Analysis 3 - NT 003 - James Jourlait.xlsx",
        "1 Thessalonians 1:6–10",
        # Heuristic gap: bare purpose infinitives (δουλεύειν θεῷ … καὶ
        # ἀναμένειν…) are not first-pass splits — splitting every bare
        # infinitive would misfire on complementary/epexegetical ones.
        ["δουλευειν", "και"],
    ),
    (
        "Discourse Analysis 4 - NT 003 - James Jourlait.xlsx",
        "Ephesians 1:13–14",
        [],  # apposition + trailing-PP rules produce all seven propositions
    ),
]


@pytest.mark.parametrize("filename,ref,allowed", CASES, ids=[c[0][:21] for c in CASES])
def test_example_segmentation_matches_student(filename, ref, allowed):
    rows = student_rows(filename)
    assert len(rows) >= 5, "extraction should find the Greek proposition rows"

    alignment = align(" ".join(rows))
    assert alignment is not None, "the student's pasted text must align"
    assert alignment.ref == ref
    assert alignment.matched_tokens >= 0.95 * alignment.total_tokens

    segments = segment(alignment.start, alignment.end)
    tool_bounds = {s.start for s in segments[1:]}
    student_bounds = boundary_positions(rows, alignment.start, alignment.end)

    words = load_words()
    spurious = tool_bounds - student_bounds
    assert spurious == set(), (
        "tool splits where the student does not: "
        + ", ".join(f"{p}:{words[p].text}" for p in sorted(spurious))
    )

    missed = student_bounds - tool_bounds
    allowed_counter = Counter(allowed)
    unexplained = []
    for p in sorted(missed):
        folded = words[p].folded
        if allowed_counter[folded] > 0:
            allowed_counter[folded] -= 1
        else:
            unexplained.append(f"{p}:{words[p].text}")
    assert unexplained == [], (
        "student boundaries the tool missed beyond the documented allowances: "
        + ", ".join(unexplained)
    )


# --- The students' COLOUR BLOCKS -------------------------------------------
#
# Three of the four spreadsheets fill the Greek column in runs of one colour:
# the student's own blocking of the passage (DA 4 is unfilled). The tool's
# sectioner (docs/sectioning.md) blocks the same passages into runs of whole
# SENTENCES, so it blocks more coarsely than the students, who block by
# clause — Philippians 1:9–11 is one sentence and the student made three
# blocks of it. The direction that is pinned strictly is the segmentation
# tests' own: the tool must never START a block where the student did not.
# The counts are recorded as they are, so a change to the sectioner shows up
# here rather than silently.

BLOCK_CASES = [
    # (file, student block count, tool block count)
    ("Discourse Analysis 1 - NT 003 - James Jourlait.xlsx", 3, 2),  # v5 | v6 | v7 vs v5 | v6–7
    ("Discourse Analysis 2 - NT 003 - James Jourlait.xlsx", 3, 1),  # one sentence, blocked by clause
    ("Discourse Analysis 3 - NT 003 - James Jourlait.xlsx", 3, 1),  # blocks at the two γάρ clauses
]


def student_block_starts(filename: str, start: int) -> list[int]:
    """Corpus index of the first word of each colour run in the Greek column
    (the first run included), by cumulative tokens from ``start``."""
    wb = openpyxl.load_workbook(EXAMPLES / filename)
    ws = wb.active
    counts: Counter[str] = Counter()
    for row in ws.iter_rows():
        for cell in row:
            if isinstance(cell.value, str) and len(GREEK.findall(cell.value)) > 3:
                counts[cell.column_letter] += 1
    column = counts.most_common(1)[0][0]
    starts: list[int] = []
    at = start
    previous = None
    for row in ws.iter_rows():
        for cell in row:
            if cell.column_letter != column or not isinstance(cell.value, str):
                continue
            value = cell.value.strip()
            if not value or len(GREEK.findall(value)) <= len(value) * 0.3:
                continue
            fill = cell.fill.fgColor.rgb if cell.fill.fgColor.type == "rgb" else None
            if fill != previous:
                starts.append(at)
                previous = fill
            at += len(tokenize(value))
    return starts


@pytest.mark.parametrize("filename,student_count,tool_count", BLOCK_CASES,
                         ids=[c[0][:21] for c in BLOCK_CASES])
def test_example_color_blocks_never_exceed_the_students(filename, student_count, tool_count):
    from da.treebuild import build_document

    rows = student_rows(filename)
    alignment = align(" ".join(rows))
    assert alignment is not None
    student_starts = student_block_starts(filename, alignment.start)
    assert len(student_starts) == student_count

    segments = segment(alignment.start, alignment.end)
    document = build_document(segments)
    first = {p["id"]: p["source"]["start"] for p in document["propositions"]}
    tool_starts = sorted([alignment.start] + [first[b["start"]] for b in document.get("sections", [])])
    assert len(tool_starts) == tool_count

    words = load_words()
    # NA28 vs SBLGNT can shift a start by a word (DA 3's αὐτοὶ γάρ): a tool
    # start counts as the student's when it falls within one word of one.
    spurious = [t for t in tool_starts if not any(abs(t - s) <= 1 for s in student_starts)]
    assert spurious == [], (
        "tool starts a block where the student does not: "
        + ", ".join(f"{p}:{words[p].text}" for p in spurious)
    )


def test_da1_matches_exactly():
    """The 1 John example (the design doc's worked passage) must match the
    student's segmentation boundary-for-boundary."""
    rows = student_rows(CASES[0][0])
    alignment = align(" ".join(rows))
    segments = segment(alignment.start, alignment.end)
    assert len(segments) == len(rows) == 14
