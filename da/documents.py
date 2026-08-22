"""Validation of analysis documents — the server-side authority.

The document shape (see docs/DESIGN.md §3, §7):

    {
      "schemaVersion": 1,
      "propositions": [
        {"id": str, "label": str,
         "source": {"kind": "corpus", "start": int, "end": int}   # inclusive range
                 | {"kind": "raw", "text": str},
         "color": str?},
        ...
      ],
      "tree": {"kind": "prop", "ref": str}
            | {"kind": "bracket", "rel": str, "prominent": int | None,
               "reversed": bool?, "flag": "review"?, "children": [node, ...]}
    }

Invariants enforced here (mirrored client-side by the editor schema):
  * every bracket has >= 2 children;
  * "prominent" is a valid child index iff the relationship is subordinate,
    and None iff it is coordinate;
  * the tree's in-order leaves reference the propositions exactly once each,
    in list order (this is what makes crossing brackets unrepresentable);
  * relationship codes come from the taxonomy; sources are well-formed.
"""

from .taxonomy import RELATIONSHIPS

SCHEMA_VERSION = 1


class DocumentError(ValueError):
    def __init__(self, problems: list[str]):
        self.problems = problems
        super().__init__("; ".join(problems))


def validate_document(doc, corpus_size: int | None = None) -> None:
    """Raise DocumentError listing every problem found. Passes silently if valid."""
    problems: list[str] = []
    if not isinstance(doc, dict):
        raise DocumentError(["document must be an object"])

    if doc.get("schemaVersion") != SCHEMA_VERSION:
        problems.append(f"schemaVersion must be {SCHEMA_VERSION}")

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

    leaves: list[str] = []
    _walk_tree(doc.get("tree"), "tree", leaves, problems)

    if prop_ids and leaves != prop_ids:
        used = set(leaves)
        declared = set(prop_ids)
        missing = [p for p in prop_ids if p not in used]
        unknown = [l for l in leaves if l not in declared]
        if missing:
            problems.append(f"propositions not in tree: {missing}")
        if unknown:
            problems.append(f"tree references unknown propositions: {unknown}")
        if not missing and not unknown:
            counts_ok = len(leaves) == len(prop_ids)
            problems.append(
                "tree leaves must appear exactly once each, in proposition order"
                if counts_ok else "tree references propositions more than once"
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
    """Proposition ids of the main point: follow stars from the root; at a
    coordinate bracket the whole packet is the point (all its leaves)."""
    node = doc["tree"]
    while node["kind"] == "bracket" and node.get("prominent") is not None:
        node = node["children"][node["prominent"]]
    leaves: list[str] = []
    _collect(node, leaves)
    return leaves


def _collect(node, out: list[str]) -> None:
    if node["kind"] == "prop":
        out.append(node["ref"])
    else:
        for child in node["children"]:
            _collect(child, out)
