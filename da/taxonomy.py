"""The relationship taxonomy — single source of truth.

Every layer (first-pass classifier, document validator, HTTP API, editor UI)
derives its knowledge of relationship types from this table. The taxonomy follows
the course materials in ``documents/`` (Fuller/Piper/Hafemann bracketing method).

Conventions for two-part labels: ``labels[0]`` describes the bracket end at
``children[0]`` and ``labels[1]`` the end at ``children[1]`` — unless the
bracket's ``reversed`` flag is set, which swaps them (W–Ed ↔ Ed–W). An empty
label means that end shows only its star (e.g. Ground renders ``* → G``).
``starred_label`` is the index into ``labels`` of the end that is semantically
prominent by default; ``None`` for coordinate types, which have no star and
attach from their center.
"""

from dataclasses import dataclass

COORDINATE = "coordinate"
RESTATEMENT = "restatement"  # subordinate: support by restatement
DISTINCT = "distinct"        # subordinate: support by distinct statement
CONTRARY = "contrary"        # subordinate: support by contrary statement


@dataclass(frozen=True, slots=True)
class Relationship:
    code: str
    name: str
    family: str
    symbol: str
    labels: tuple[str, ...]
    starred_label: int | None

    @property
    def coordinate(self) -> bool:
        return self.family == COORDINATE


_TABLE = [
    # Coordinate (no star; connect from center)
    Relationship("Ser", "Series", COORDINATE, "S", ("S",), None),
    Relationship("Prog", "Progression", COORDINATE, "P", ("P",), None),
    Relationship("Alt", "Alternative", COORDINATE, "Alt", ("Alt",), None),
    # Subordinate — support by restatement
    Relationship("WEd", "Way–End", RESTATEMENT, "W/Ed", ("W", "Ed"), 1),
    Relationship("Cmp", "Comparison", RESTATEMENT, "//", ("//", ""), 1),
    Relationship("NegPos", "Negative–Positive", RESTATEMENT, "-/+", ("-", "+"), 1),
    Relationship("GnSp", "General–Specific", RESTATEMENT, "Gn/Sp", ("Gn", "Sp"), 1),
    Relationship("FtIn", "Fact–Interpretation", RESTATEMENT, "Ft/In", ("Ft", "In"), 1),
    # Subordinate — support by distinct statement
    Relationship("Grnd", "Ground", DISTINCT, "G", ("", "G"), 0),
    Relationship("Inf", "Inference", DISTINCT, "∴", ("", "∴"), 1),
    Relationship("CE", "Cause–Effect", DISTINCT, "C/E", ("C", "E"), 1),
    Relationship("CndE", "Conditional", DISTINCT, "C?/E", ("C?", "E"), 1),
    Relationship("MEd", "Means–End", DISTINCT, "M/Ed", ("M", "Ed"), 1),
    Relationship("Tmp", "Temporal", DISTINCT, "T", ("T", ""), 1),
    Relationship("Loc", "Locative", DISTINCT, "L", ("L", ""), 1),
    # Subordinate — support by contrary statement
    Relationship("Adv", "Adversative", CONTRARY, "Adv", ("Adv", ""), 1),
    Relationship("QA", "Question–Answer", CONTRARY, "Q/A", ("Q", "A"), 1),
    Relationship("SR", "Situation–Response", CONTRARY, "S/R", ("S", "R"), 1),
]

RELATIONSHIPS: dict[str, Relationship] = {r.code: r for r in _TABLE}

COORDINATE_CODES = frozenset(r.code for r in _TABLE if r.coordinate)
SUBORDINATE_CODES = frozenset(r.code for r in _TABLE if not r.coordinate)


def as_json() -> list[dict]:
    """The taxonomy as served by ``GET /api/taxonomy`` and consumed by the editor."""
    return [
        {
            "code": r.code,
            "name": r.name,
            "family": r.family,
            "symbol": r.symbol,
            "labels": list(r.labels),
            "starredLabel": r.starred_label,
            "coordinate": r.coordinate,
        }
        for r in _TABLE
    ]
