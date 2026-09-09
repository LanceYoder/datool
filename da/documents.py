"""Validation of analysis documents — the server-side authority.

The document shape (see docs/DESIGN.md §3, §7):

    {
      "schemaVersion": 2,
      "propositions": [
        {"id": str, "label": str,
         "source": {"kind": "corpus", "start": int, "end": int}   # inclusive range
                 | {"kind": "raw", "text": str},
         "color": str?},
        ...
      ],
      "forest": [node, ...],       # >= 1 roots, in proposition order
      "sections": [{"start": str, "color": int}, ...],  # optional color blocks
                                   # (legacy: plain pid strings still load)
      "textFlow": {"lines": [line, ...]}                # optional Text Flow
    }

    line := {"start": int, "end": int, "indent": int,
             "embedded": [{"start": int, "end": int,
                           "style": "paren" | "bracket"}, ...]?}

    node := {"kind": "prop", "ref": str}
          | {"kind": "bracket", "rel": str, "prominent": 0 | 1 | None,
             "reversed": bool?, "flag": "review"?, "children": [node, node]}
          | {"kind": "hole", "children": [node, ...]}   # >= 1, and only as a
                                                       # bracket's child

A document holds an ORDERED FOREST of trees, not a single tree: propositions
the user has not connected yet stand as their own roots, and a fully connected
analysis is a forest of one. Legacy v1 documents ({"schemaVersion": 1,
"tree": node}) are still accepted and read as a forest of one;
:func:`normalize_document` returns the v2 shape of either.

A HOLE holds units an edit left unattached — deleting one relationship inside
a tree leaves what it held waiting there, so the structure above it survives
(see frontend/src/editor/commands.ts). A document with a hole in it is an
editing state, sound but unfinished: it validates, it stores, and it has no
main point until the hole is closed. Because a hole is a WAITING ROOM and not
structure, it is only ever a bracket's child — a root is unattached already,
and what waits inside a hole waits together, in one hole, never nested.

THE ANALYST'S RULING (tree-engine-spec.md §10 A4): "only validate the tree
structure when there are no holes remaining". A document with rooms in it is
work in progress and is stored as it stands, so two rules this validator used
to enforce are gone. A hole may hold ONE unit — that is a one-lodger room,
tick and pickup dot, the lone unit waiting, and only the analyst's own gesture
settles it (§10 A1, A2); nothing collapses it into the slot. And a bracket may
carry TWO holes — hanging at both ends is a legal working state (§10 A4), not a
shell to bring down. What is checked of every document, holes or none, is what
holes cannot affect: leaf coverage and order, the binary rule, and rel/star
coherence.

A BRACKET IS BINARY: it relates EXACTLY TWO sides, always (docs/tree-engine-
spec.md §1, §7.6). A longer run of the same relationship is a NESTED CHAIN of
binary brackets, not one wide bracket — Ser[Ser[a, b], c], never Ser[a, b, c].
The three-way bracket was the shape the old editor could silently splice into
existence, and it is now unrepresentable at every layer: the core forbids it,
the loader refuses it, the first pass never builds one, and this validator
rejects it. Documents written before the tightening that carry one are
deletable (spec §9, Q2); there is no binarization path back.

Invariants enforced here (mirrored client-side by the editor schema):
  * the forest is a non-empty, ordered list of roots;
  * every bracket has EXACTLY 2 children;
  * every hole has >= 1 child, holds no hole of its own, and is a bracket's
    child (never a forest root) — a hole is a WAITING ROOM, not a
    relationship, so the binary rule is not its rule, and a bracket may hold
    one at each end while the work is unfinished (spec §10 A4);
  * "prominent" is 0 or 1 iff the relationship is subordinate, and None iff
    it is coordinate;
  * the in-order leaves of the WHOLE FOREST (roots in list order) reference
    the propositions exactly once each, in list order (this is what makes
    crossing brackets unrepresentable);
  * relationship codes come from the taxonomy; sources are well-formed;
  * "sections" (the analyst's color blocks) names existing propositions, in
    proposition order, never the first one — every document opens inside its
    first block, so only the LATER starts are recorded;
  * "textFlow" (the student's Text Flow — the passage broken clause per line,
    dependent clauses indented, embedded clauses marked in place) is one
    gapless, ordered run of corpus words: each line picks up exactly where the
    previous one stopped, and every embedded mark sits inside its own line.
    It is a SEPARATE reading of the passage, so its range is its own — the
    student may flow more or less than the propositions cover, and nothing
    here cross-checks the two.
"""

from .taxonomy import RELATIONSHIPS

SCHEMA_VERSION = 2
LEGACY_SCHEMA_VERSION = 1  # single-tree documents, read as a forest of one


class DocumentError(ValueError):
    def __init__(self, problems: list[str]):
        self.problems = problems
        super().__init__("; ".join(problems))


def _is_legacy(doc: dict) -> bool:
    """True for a v1 single-tree document ({"schemaVersion": 1, "tree": ...})."""
    return doc.get("schemaVersion") == LEGACY_SCHEMA_VERSION and "forest" not in doc


def normalize_document(doc) -> dict:
    """Return ``doc`` in the v2 shape — a legacy ``tree`` becomes a forest of
    one. The input is never mutated: the result is a shallow copy that shares
    the (untouched) proposition and node objects."""
    if not isinstance(doc, dict):
        raise DocumentError(["document must be an object"])
    if not _is_legacy(doc):
        return dict(doc)
    normalized = {k: v for k, v in doc.items() if k != "tree"}
    normalized["schemaVersion"] = SCHEMA_VERSION
    normalized["forest"] = [doc["tree"]]
    return normalized


def _roots(doc: dict, legacy: bool, problems: list[str]) -> list[tuple[object, str]]:
    """The forest's roots as (node, error-path) pairs, for either shape. Paths
    name the document as it was given: ``forest[i]`` for v2, ``tree`` for v1."""
    if legacy:
        return [(doc.get("tree"), "tree")]
    forest = doc.get("forest")
    if not isinstance(forest, list) or not forest:
        problems.append("forest must be a non-empty list of root nodes")
        forest = forest if isinstance(forest, list) else []
    return [(node, f"forest[{i}]") for i, node in enumerate(forest)]


def validate_document(doc, corpus_size: int | None = None) -> None:
    """Raise DocumentError listing every problem found. Passes silently if
    valid. Accepts both the v2 forest shape and legacy v1 single-tree
    documents; the input is never modified."""
    problems: list[str] = []
    if not isinstance(doc, dict):
        raise DocumentError(["document must be an object"])

    # The version says which shape to read: only a v1 document may carry a
    # "tree" instead of a "forest", so version and shape must agree.
    legacy = _is_legacy(doc)
    expected_version = LEGACY_SCHEMA_VERSION if legacy else SCHEMA_VERSION
    if doc.get("schemaVersion") != expected_version:
        problems.append(f"schemaVersion must be {expected_version}")

    props = doc.get("propositions")
    prop_ids: list[str] = []
    if not isinstance(props, list) or not props:
        problems.append("propositions must be a non-empty list")
        props = []
    for i, p in enumerate(props):
        where = f"propositions[{i}]"
        if not isinstance(p, dict):
            problems.append(f"{where} must be an object")
            continue
        pid = p.get("id")
        if not isinstance(pid, str) or not pid:
            problems.append(f"{where}.id must be a non-empty string")
        elif pid in prop_ids:
            problems.append(f"{where}.id duplicates '{pid}'")
        else:
            prop_ids.append(pid)
        if not isinstance(p.get("label"), str):
            problems.append(f"{where}.label must be a string")
        source = p.get("source")
        if not isinstance(source, dict):
            problems.append(f"{where}.source must be an object")
        elif source.get("kind") == "corpus":
            start, end = source.get("start"), source.get("end")
            if not (isinstance(start, int) and isinstance(end, int) and 0 <= start <= end):
                problems.append(f"{where}.source needs ints 0 <= start <= end")
            elif corpus_size is not None and end >= corpus_size:
                problems.append(f"{where}.source range exceeds the corpus")
        elif source.get("kind") == "raw":
            if not isinstance(source.get("text"), str) or not source.get("text").strip():
                problems.append(f"{where}.source.text must be non-empty")
        else:
            problems.append(f"{where}.source.kind must be 'corpus' or 'raw'")
        if "color" in p and not isinstance(p["color"], str):
            problems.append(f"{where}.color must be a string")

    # Color blocks: the pids at which a new block begins, each with the
    # palette color the block KEEPS for as long as it exists. Divisions of the
    # passage the analyst drew, so they are stored with the analysis — but the
    # first proposition never starts one, because the document already does.
    # Documents written before colors were stored carry plain pid strings;
    # both shapes validate.
    sections = doc.get("sections")
    if sections is not None:
        if not isinstance(sections, list):
            problems.append("sections must be a list")
        else:
            order = {pid: i for i, pid in enumerate(prop_ids)}
            seen: set[str] = set()
            previous = -1
            for i, entry in enumerate(sections):
                where = f"sections[{i}]"
                if isinstance(entry, str):
                    pid = entry  # legacy shape: color was derived from position
                elif isinstance(entry, dict):
                    pid = entry.get("start")
                    color = entry.get("color")
                    if (not isinstance(color, int) or isinstance(color, bool)
                            or color < 0):
                        problems.append(
                            f"{where}.color must be a non-negative integer")
                else:
                    problems.append(f"{where} must be a pid or {{start, color}}")
                    continue
                if not isinstance(pid, str) or pid not in order:
                    problems.append(f"{where} must name a proposition")
                    continue
                if order[pid] == 0:
                    problems.append(f"{where} cannot be the first proposition")
                elif pid in seen:
                    problems.append(f"{where} duplicates '{pid}'")
                elif order[pid] <= previous:
                    problems.append(f"{where} is out of proposition order")
                seen.add(pid)
                previous = max(previous, order[pid])

    # The Text Flow: a clause-per-line reading of the Greek, kept alongside
    # the analysis. Its own stretch of corpus, checked on its own terms.
    if doc.get("textFlow") is not None:
        _check_text_flow(doc["textFlow"], corpus_size, problems)

    # In-order leaves of the whole forest, roots in list order.
    leaves: list[str] = []
    for node, where in _roots(doc, legacy, problems):
        _walk_tree(node, where, leaves, problems, "root")

    if prop_ids and leaves != prop_ids:
        used = set(leaves)
        declared = set(prop_ids)
        missing = [p for p in prop_ids if p not in used]
        unknown = [l for l in leaves if l not in declared]
        if missing:
            problems.append(f"propositions not in the forest: {missing}")
        if unknown:
            problems.append(f"forest references unknown propositions: {unknown}")
        if not missing and not unknown:
            counts_ok = len(leaves) == len(prop_ids)
            problems.append(
                "forest leaves must appear exactly once each, in proposition order"
                if counts_ok else "forest references propositions more than once"
            )

    if problems:
        raise DocumentError(problems)


def _has_hole(node) -> bool:
    """Whether anything under ``node`` is still unattached."""
    if not isinstance(node, dict):
        return False
    if node.get("kind") == "hole":
        return True
    return any(_has_hole(child) for child in node.get("children", ()))


def _walk_tree(
    node, where: str, leaves: list[str], problems: list[str], holder: str = "bracket"
) -> None:
    """Collect ``node``'s leaves in order, reporting every problem found.
    ``holder`` is what the node hangs from — "root", "bracket" or "hole" —
    which is what says whether a hole may stand here at all."""
    if not isinstance(node, dict):
        problems.append(f"{where} must be an object")
        return
    kind = node.get("kind")
    if kind == "prop":
        ref = node.get("ref")
        if not isinstance(ref, str):
            problems.append(f"{where}.ref must be a string")
        else:
            leaves.append(ref)
    elif kind == "bracket":
        rel = node.get("rel")
        relationship = RELATIONSHIPS.get(rel) if isinstance(rel, str) else None
        if relationship is None:
            problems.append(f"{where}.rel '{rel}' is not a known relationship")
        # THE BINARY RULE: a bracket relates exactly two sides. A run of three
        # is a nested chain — Ser[Ser[a, b], c] — so a wide bracket is not a
        # long relationship, it is a corrupt one.
        children = node.get("children")
        if not isinstance(children, list) or len(children) != 2:
            problems.append(f"{where}.children must be a list of exactly 2 nodes")
            children = children if isinstance(children, list) else []
        prominent = node.get("prominent")
        if relationship is not None:
            if relationship.coordinate:
                if prominent is not None:
                    problems.append(f"{where}.prominent must be null for coordinate {rel}")
            else:
                # The star names child 0 or child 1 — the domain is FIXED by
                # the binary rule, not read off a children list that may
                # itself be the thing that is wrong.
                if not isinstance(prominent, int) or isinstance(prominent, bool) \
                        or prominent not in (0, 1):
                    problems.append(f"{where}.prominent must be a valid child index for {rel}")
        if "reversed" in node and not isinstance(node["reversed"], bool):
            problems.append(f"{where}.reversed must be a boolean")
        if "flag" in node and node["flag"] not in (None, "review"):
            problems.append(f"{where}.flag must be 'review' or absent")
        # NO WAITING-ROOM COUNT. A bracket hanging at BOTH ends is a legal
        # working state (spec §10 A4) — the analyst assembles in rooms and
        # finishes brackets by hand, so a two-hole bracket is an unfinished
        # claim, not a corrupt one. Full structural validation is what applies
        # to a document with no holes left in it; everything checked here is
        # checked of every document, because holes cannot make it false.
        for i, child in enumerate(children):
            _walk_tree(child, f"{where}.children[{i}]", leaves, problems, "bracket")
    elif kind == "hole":
        # Units left unattached by an edit: no relationship, no star — only a
        # place in the order until they are connected again. A waiting room, so
        # it only makes sense in a bracket's slot. ONE unit in it is a room too
        # (spec §10 A1) — the analyst has assembled the group and has not yet
        # said it is finished — so the only count that is wrong is none at all.
        if holder == "root":
            problems.append(f"{where} cannot be a forest root: roots are unattached")
        elif holder == "hole":
            problems.append(f"{where} cannot hold another hole: what waits, waits together")
        children = node.get("children")
        if not isinstance(children, list) or len(children) < 1:
            problems.append(f"{where}.children must be a list of >= 1 node")
            children = children if isinstance(children, list) else []
        for i, child in enumerate(children):
            _walk_tree(child, f"{where}.children[{i}]", leaves, problems, "hole")
    else:
        problems.append(f"{where}.kind must be 'prop', 'bracket' or 'hole'")


MAX_INDENT = 8  # deeper than any clause a student nests by hand
EMBEDDED_STYLES = ("paren", "bracket")


def _is_index(value) -> bool:
    """True for a plain integer (booleans are not word indexes)."""
    return isinstance(value, int) and not isinstance(value, bool)


def _check_text_flow(flow, corpus_size: int | None, problems: list[str]) -> None:
    """Check the Text Flow: one gapless run of corpus words, line by line,
    each line's embedded marks inside it and in order."""
    if not isinstance(flow, dict):
        problems.append("textFlow must be an object")
        return
    lines = flow.get("lines")
    if not isinstance(lines, list) or not lines:
        problems.append("textFlow.lines must be a non-empty list")
        return

    previous_end = None  # the end of the last line that gave us a usable one
    for i, line in enumerate(lines):
        where = f"textFlow.lines[{i}]"
        if not isinstance(line, dict):
            problems.append(f"{where} must be an object")
            previous_end = None
            continue
        start, end = line.get("start"), line.get("end")
        if not (_is_index(start) and _is_index(end) and 0 <= start <= end):
            problems.append(f"{where} needs ints 0 <= start <= end")
            start = end = None
        elif corpus_size is not None and end >= corpus_size:
            problems.append(f"{where} range exceeds the corpus")

        # Contiguity: every line but the first picks up where the last stopped.
        if start is not None and previous_end is not None and start != previous_end + 1:
            problems.append(f"{where}.start must continue the previous line")
        previous_end = end

        indent = line.get("indent")
        if not _is_index(indent) or not (0 <= indent <= MAX_INDENT):
            problems.append(f"{where}.indent must be an int 0 <= indent <= {MAX_INDENT}")

        if line.get("embedded") is None:
            continue
        embedded = line["embedded"]
        if not isinstance(embedded, list):
            problems.append(f"{where}.embedded must be a list")
            continue
        previous_embedded_end = None
        for j, span in enumerate(embedded):
            spot = f"{where}.embedded[{j}]"
            if not isinstance(span, dict):
                problems.append(f"{spot} must be an object")
                previous_embedded_end = None
                continue
            e_start, e_end = span.get("start"), span.get("end")
            if not (_is_index(e_start) and _is_index(e_end) and e_start <= e_end):
                problems.append(f"{spot} needs ints start <= end")
                e_start = e_end = None
            elif start is not None and not (start <= e_start and e_end <= end):
                problems.append(f"{spot} must lie inside its line")
            if (e_start is not None and previous_embedded_end is not None
                    and e_start <= previous_embedded_end):
                problems.append(f"{spot} overlaps the previous embedded range")
            previous_embedded_end = e_end
            if span.get("style") not in EMBEDDED_STYLES:
                problems.append(f"{spot}.style must be 'paren' or 'bracket'")


def main_point(doc) -> list[str]:
    """Proposition ids of the main point: follow the stars from the single
    root. A subordinate bracket walks into its starred child; a coordinate
    bracket fans — the walk CONTINUES into every member (the Mark 4:10-12
    diagram highlights BOTH members of its final Progression, so Progression
    fans like any other coordinate). Mirrors the client's mainPointRefs,
    which paints these rows red.

    A forest with more than one root is a partly connected analysis — nothing
    supports everything else yet, so there is no main point: return []. Nor is
    there one while a HOLE is open: an edit is half-made, and what the tree
    supports is not yet decided."""
    forest = normalize_document(doc).get("forest")
    if not isinstance(forest, list) or len(forest) != 1:
        return []
    if _has_hole(forest[0]):
        return []
    out: list[str] = []

    def walk(node) -> None:
        if node["kind"] == "prop":
            out.append(node["ref"])
        elif node.get("prominent") is not None:
            walk(node["children"][node["prominent"]])
        else:
            for child in node["children"]:
                walk(child)

    walk(forest[0])
    return out
