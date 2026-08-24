"""JSON shaping for the API — camelCase on the wire (docs/DESIGN.md §7).

Deliberately thin: DRF ModelSerializers shape *output* only. Input validation
of the ``document`` JSON is NOT re-modeled as DRF fields — the single
authority is :func:`da.documents.validate_document`, which the views call
directly so the validator and the API can never disagree.
"""

from rest_framework import serializers

from .corpus import Alignment, Word, gloss_for
from .models import Analysis


class AnalysisListSerializer(serializers.ModelSerializer):
    """Row shape for ``GET /api/analyses``."""

    passageRef = serializers.CharField(source="passage_ref", read_only=True)
    updatedAt = serializers.DateTimeField(source="updated_at", read_only=True)

    class Meta:
        model = Analysis
        fields = ["id", "title", "passageRef", "updatedAt"]


class AnalysisDetailSerializer(AnalysisListSerializer):
    """Full shape for detail responses and successful writes."""

    class Meta(AnalysisListSerializer.Meta):
        fields = ["id", "title", "passageRef", "document", "updatedAt"]


def word_json(word: Word) -> dict:
    """One corpus word as served by ``GET /api/corpus/words``."""
    entry = gloss_for(word.lemma)
    return {
        "index": word.index,
        "text": word.text,
        "word": word.word,
        "norm": word.norm,
        "lemma": word.lemma,
        "pos": word.pos,
        "parsing": word.parsing,
        "book": word.book,
        "bookName": word.book_name,
        "chapter": word.chapter,
        "verse": word.verse,
        # TBESG (STEPBible.org, CC BY 4.0): null when the lemma has no entry.
        "translit": entry[0] if entry is not None else None,
        "gloss": entry[1] if entry is not None else None,
    }


def alignment_json(alignment: Alignment | None) -> dict | None:
    """The alignment half of a ``POST /api/first-pass`` response."""
    if alignment is None:
        return None
    return {
        "ref": alignment.ref,
        "start": alignment.start,
        "end": alignment.end,
        "exact": alignment.exact,
        "matchedTokens": alignment.matched_tokens,
        "totalTokens": alignment.total_tokens,
        "mismatchedPositions": list(alignment.mismatched_positions),
    }
