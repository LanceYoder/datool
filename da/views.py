"""The datool HTTP API (docs/DESIGN.md §7) — plain, explicit DRF APIViews.

Error contract: every 400 carries ``{"errors": [str, ...]}``.
"""

from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from .corpus import format_ref, load_words, verses_for_range
from .documents import DocumentError, validate_document
from .models import Analysis, purge_expired
from .serializers import (
    AnalysisDetailSerializer,
    AnalysisListSerializer,
    DeletedAnalysisSerializer,
    alignment_json,
    word_json,
)
from .taxonomy import as_json as taxonomy_json

WORD_RANGE_CAP = 2000  # max words per /api/corpus/words request


def _errors(problems: list[str]) -> Response:
    return Response({"errors": problems}, status=status.HTTP_400_BAD_REQUEST)


def _validated_document(payload) -> dict:
    """Extract and validate the ``document`` of a write payload.

    Raises DocumentError (listing every problem) on anything invalid —
    a missing key falls out naturally as "document must be an object".
    """
    document = payload.get("document") if isinstance(payload, dict) else None
    validate_document(document, corpus_size=len(load_words()))
    return document


def _derive_passage_ref(document: dict) -> str:
    """Passage reference from the first/last corpus-sourced propositions."""
    corpus_props = [
        p for p in document["propositions"]
        if p.get("source", {}).get("kind") == "corpus"
    ]
    if not corpus_props:
        return ""
    return format_ref(
        corpus_props[0]["source"]["start"],
        corpus_props[-1]["source"]["end"],
    )


class AnalysisListCreateView(APIView):
    def get(self, request):
        rows = Analysis.objects.filter(deleted_at__isnull=True).order_by("-updated_at")
        return Response(AnalysisListSerializer(rows, many=True).data)

    def post(self, request):
        payload = request.data
        title = payload.get("title") if isinstance(payload, dict) else None
        if title is not None and not isinstance(title, str):
            return _errors(["title must be a string"])
        try:
            document = _validated_document(payload)
        except DocumentError as e:
            return _errors(e.problems)
        passage_ref = _derive_passage_ref(document)
        analysis = Analysis.objects.create(
            title=(title or "").strip() or passage_ref or "Untitled analysis",
            passage_ref=passage_ref,
            document=document,
        )
        return Response(
            AnalysisDetailSerializer(analysis).data, status=status.HTTP_201_CREATED
        )


class AnalysisDetailView(APIView):
    """A LIVE analysis: one in Recently Deleted reads as gone (404) until it
    is restored. Only delete() reaches a trashed row, to purge it."""

    def get(self, request, pk: int):
        analysis = get_object_or_404(Analysis, pk=pk, deleted_at__isnull=True)
        return Response(AnalysisDetailSerializer(analysis).data)

    def put(self, request, pk: int):
        analysis = get_object_or_404(Analysis, pk=pk, deleted_at__isnull=True)
        payload = request.data
        if not isinstance(payload, dict):
            return _errors(["request body must be an object"])
        if "title" in payload:
            title = payload["title"]
            if not isinstance(title, str) or not title.strip():
                return _errors(["title must be a non-empty string"])
            analysis.title = title.strip()
        if "document" in payload:
            try:
                analysis.document = _validated_document(payload)
            except DocumentError as e:
                return _errors(e.problems)
            analysis.passage_ref = _derive_passage_ref(analysis.document)
        if "notes" in payload:
            notes = payload["notes"]
            if not isinstance(notes, str):
                return _errors(["notes must be a string"])
            analysis.notes = notes
        analysis.save()
        return Response(AnalysisDetailSerializer(analysis).data)

    def delete(self, request, pk: int):
        """Soft by default — the analysis moves to Recently Deleted. Only
        ``?purge=1`` (emptying the trash) removes the row itself."""
        analysis = get_object_or_404(Analysis, pk=pk)
        if request.query_params.get("purge") in ("1", "true"):
            analysis.delete()
        else:
            analysis.deleted_at = timezone.now()
            analysis.save(update_fields=["deleted_at"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class DeletedAnalysisListView(APIView):
    """Recently Deleted. Listing it is also what purges the expired rows —
    a single-user app needs no scheduler for a 30-day window."""

    def get(self, request):
        purge_expired()
        rows = Analysis.objects.filter(deleted_at__isnull=False).order_by("-deleted_at")
        return Response(DeletedAnalysisSerializer(rows, many=True).data)


class AnalysisRestoreView(APIView):
    def post(self, request, pk: int):
        analysis = get_object_or_404(Analysis, pk=pk, deleted_at__isnull=False)
        analysis.deleted_at = None
        analysis.save(update_fields=["deleted_at"])
        return Response(AnalysisDetailSerializer(analysis).data)


class FirstPassView(APIView):
    def post(self, request):
        payload = request.data
        text = payload.get("text") if isinstance(payload, dict) else None
        if not isinstance(text, str) or not text.strip():
            return _errors(["text must be a non-empty string"])
        # Imported at call time: the first-pass service is a separate module;
        # the rest of the API must not go down with it, and tests may stub it.
        from .documents import DocumentError
        from .firstpass import first_pass

        try:
            result = first_pass(text)
        except DocumentError:
            # build_document's self-validation failing is a builder bug, not
            # bad input — let it surface as a 500, never a 400 blaming the user.
            raise
        except ValueError as e:  # e.g. nothing analyzable in the paste
            return _errors([str(e)])
        return Response({
            "document": result.document,
            "alignment": alignment_json(result.alignment),
        })


class CorpusWordsView(APIView):
    def get(self, request):
        raw_start = request.query_params.get("start")
        raw_end = request.query_params.get("end")
        try:
            start, end = int(raw_start), int(raw_end)
        except (TypeError, ValueError):
            return _errors(["start and end must be integers"])
        words = load_words()
        if not (0 <= start <= end < len(words)):
            return _errors([f"need 0 <= start <= end < {len(words)}"])
        if end - start + 1 > WORD_RANGE_CAP:
            return _errors([f"range exceeds the {WORD_RANGE_CAP}-word cap"])
        return Response([word_json(w) for w in words[start:end + 1]])


class CorpusVersesView(APIView):
    """English reference text for the verses a word range touches.

    ``?translation=bsb`` (default, local data) or ``esv`` (live Crossway API,
    needs ``settings.ESV_API_KEY``; 503 when unconfigured or unreachable).
    """

    def get(self, request):
        raw_start = request.query_params.get("start")
        raw_end = request.query_params.get("end")
        translation = request.query_params.get("translation", "bsb")
        if translation not in ("bsb", "esv"):
            return _errors(["translation must be bsb or esv"])
        try:
            start, end = int(raw_start), int(raw_end)
        except (TypeError, ValueError):
            return _errors(["start and end must be integers"])
        words = load_words()
        if not (0 <= start <= end < len(words)):
            return _errors([f"need 0 <= start <= end < {len(words)}"])
        if end - start + 1 > WORD_RANGE_CAP:
            return _errors([f"range exceeds the {WORD_RANGE_CAP}-word cap"])
        if translation == "esv":
            from .corpus.esv import EsvError, esv_verses_for_range
            try:
                return Response(esv_verses_for_range(start, end))
            except EsvError as e:
                return Response({"errors": [str(e)]}, status=503)
        return Response(verses_for_range(start, end))


class TaxonomyView(APIView):
    def get(self, request):
        return Response(taxonomy_json())
