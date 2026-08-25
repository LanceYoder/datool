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
    #: What the relationship IS, in the course's own terms (Discourse Analysis
    #: Resources, Greek III), with the conjunctions that typically mark it.
    #: Shown behind the "i" in the relationship menu.
    description: str

    @property
    def coordinate(self) -> bool:
        return self.family == COORDINATE


_TABLE = [
    # Coordinate (no star; connect from center)
    Relationship("Ser", "Series", COORDINATE, "S", ("S",), None,
                 "Propositions that each make their own independent contribution to the whole. Marked by: and, moreover, furthermore, likewise."),
    Relationship("Prog", "Progression", COORDINATE, "P", ("P",), None,
                 "Like a series, but each proposition is a further step toward a climax. Marked by: then — and the conjunctions of a series."),
    Relationship("Alt", "Alternative", COORDINATE, "Alt", ("Alt",), None,
                 "Each proposition expresses an opposite possibility arising from one situation. Marked by: but, on the other hand, while."),
    # Subordinate — support by restatement
    Relationship("WEd", "Way–End", RESTATEMENT, "W/Ed", ("W", "Ed"), 1,
                 "A statement of an action — the END — supported by one spelling out what carrying it out involves: the WAY. Marked by: in that, by."),
    Relationship("Cmp", "Comparison", RESTATEMENT, "//", ("//", ""), 1,
                 "An action made clearer by a statement showing what it is like. Marked by: even as, as … so."),
    Relationship("NegPos", "Negative–Positive", RESTATEMENT, "-/+", ("-", "+"), 1,
                 "Two alternatives, one denied so that the other is enforced. Also the relationship implicit in contrasting statements. Marked by: not … but."),
    Relationship("GnSp", "General–Specific", RESTATEMENT, "Gn/Sp", ("Gn", "Sp"), 1,
                 "A proposition stating a whole, supported by one or more setting forth its parts."),
    Relationship("FtIn", "Fact–Interpretation", RESTATEMENT, "Ft/In", ("Ft", "In"), 1,
                 "An original statement clarified by one giving its meaning — it may define a single word. Unlike General–Specific, the interpreting proposition is not a distinguishable part of the whole."),
    # Subordinate — support by distinct statement
    Relationship("Grnd", "Ground", DISTINCT, "G", ("", "G"), 0,
                 "A statement and the argument or basis on which it stands. The support FOLLOWS what it supports. Marked by: for, because, since."),
    Relationship("Inf", "Inference", DISTINCT, "∴", ("", "∴"), 1,
                 "The same relationship as Ground, with the support PRECEDING what it supports. Marked by: therefore, wherefore, consequently, accordingly."),
    Relationship("CE", "Cause–Effect", DISTINCT, "C/E", ("C", "E"), 1,
                 "An action and one automatically consequent upon it. Marked by: so … that, so that, that."),
    Relationship("CndE", "Conditional", DISTINCT, "C?/E", ("C?", "E"), 1,
                 "Like Cause–Effect, except that the cause is only potential. Marked by: if … then, provided that, except."),
    Relationship("MEd", "Means–End", DISTINCT, "M/Ed", ("M", "Ed"), 1,
                 "An action and the one it is intended to bring about. Marked by: in order that, that, lest, to the end that, with a view to."),
    Relationship("Tmp", "Temporal", DISTINCT, "T", ("T", ""), 1,
                 "A proposition and the occasion — not quite the cause — when it can occur. Marked by: when, whenever."),
    Relationship("Loc", "Locative", DISTINCT, "L", ("L", ""), 1,
                 "A proposition and the place where it can be true. Marked by: where, wherever."),
    # Subordinate — support by contrary statement
    Relationship("Adv", "Adversative", CONTRARY, "Adv", ("Adv", ""), 1,
                 "A main clause that stands despite a contrary statement. The concessive clause supports it by showing the obstacle it stands against. Marked by: although … yet, though, nevertheless."),
    Relationship("QA", "Question–Answer", CONTRARY, "Q/A", ("Q", "A"), 1,
                 "An answer opposite to the one the question implies: the question then behaves like a concessive clause, and the relationship is in truth adversative. An answer holding no surprise restates the question instead."),
    Relationship("SR", "Situation–Response", CONTRARY, "S/R", ("S", "R"), 1,
                 "A response not intended by the situation another creates: the situation then behaves like a concessive clause, and the relationship is in truth adversative."),
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
            "description": r.description,
        }
        for r in _TABLE
    ]
