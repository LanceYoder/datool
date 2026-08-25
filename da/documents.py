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
      "sections": [{"start": str, "color": int}, ...]   # optional color blocks
                                   # (legacy: plain pid strings still load)
    }

    node := {"kind": "prop", "ref": str}
          | {"kind": "bracket", "rel": str, "prominent": int | None,
             "reversed": bool?, "flag": "review"?, "children": [node, ...]}

A document holds an ORDERED FOREST of trees, not a single tree: propositions
the user has not connected yet stand as their own roots, and a fully connected
analysis is a forest of one. Legacy v1 documents ({"schemaVersion": 1,
"tree": node}) are still accepted and read as a forest of one;
:func:`normalize_document` returns the v2 shape of either.

Invariants enforced here (mirrored client-side by the editor schema):
  * the forest is a non-empty, ordered list of roots;
  * every bracket has >= 2 children;
  * "prominent" is a valid child index iff the relationship is subordinate,
    and None iff it is coordinate;
  * the in-order leaves of the WHOLE FOREST (roots in list order) reference
    the propositions exactly once each, in list order (this is what makes
    crossing brackets unrepresentable);
  * relationship codes come from the taxonomy; sources are well-formed;
  * "sections" (the analyst's color blocks) names existing propositions, in
    proposition order, never the first one — every document opens inside its
    first block, so only the LATER starts are recorded.
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

    # In-order leaves of the whole forest, roots in list order.
    leaves: list[str] = []
    for node, where in _roots(doc, legacy, problems):
        _walk_tree(node, where, leaves, problems)

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


def _walk_tree(node, where: str, leaves: list[str], problems: list[str]) -> None:
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
        children = node.get("children")
        if not isinstance(children, list) or len(children) < 2:
            problems.append(f"{where}.children must be a list of >= 2 nodes")
            children = children if isinstance(children, list) else []
        prominent = node.get("prominent")
        if relationship is not None:
            if relationship.coordinate:
                if prominent is not None:
                    problems.append(f"{where}.prominent must be null for coordinate {rel}")
            else:
                if not isinstance(prominent, int) or not (0 <= prominent < len(children)):
                    problems.append(f"{where}.prominent must be a valid child index for {rel}")
        if "reversed" in node and not isinstance(node["reversed"], bool):
            problems.append(f"{where}.reversed must be a boolean")
        if "flag" in node and node["flag"] not in (None, "review"):
            problems.append(f"{where}.flag must be 'review' or absent")
        for i, child in enumerate(children):
            _walk_tree(child, f"{where}.children[{i}]", leaves, problems)
    else:
        problems.append(f"{where}.kind must be 'prop' or 'bracket'")


def main_point(doc) -> list[str]:
    """Proposition ids of the main point: follow the stars from the single
    root. A subordinate bracket walks into its starred child; a coordinate
    bracket fans — the walk CONTINUES into every member (the Mark 4:10-12
    diagram highlights BOTH members of its final Progression, so Progression
    fans like any other coordinate). Mirrors the client's mainPointRefs,
    which paints these rows red.

    A forest with more than one root is a partly connected analysis — nothing
    supports everything else yet, so there is no main point: return []."""
    forest = normalize_document(doc).get("forest")
    if not isinstance(forest, list) or len(forest) != 1:
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
