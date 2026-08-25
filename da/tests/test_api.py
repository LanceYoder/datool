"""API tests (pytest-django) for the DRF layer: da/views.py + da/urls.py."""

import sys
import types

import pytest
from rest_framework.test import APIClient

from da.corpus import align, load_words
from da.models import Analysis, TRASH_DAYS

JOHN_1_1 = "Ἐν ἀρχῇ ἦν ὁ λόγος, καὶ ὁ λόγος ἦν πρὸς τὸν θεόν, καὶ θεὸς ἦν ὁ λόγος."


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture(scope="module")
def john_1_1():
    """Real corpus indexes for the CRUD document, located via align."""
    alignment = align(JOHN_1_1)
    assert alignment is not None and alignment.exact
    return alignment


def small_document(alignment) -> dict:
    """Two corpus-sourced propositions covering John 1:1, in a Series."""
    start, end = alignment.start, alignment.end
    return {
        "schemaVersion": 2,
        "propositions": [
            {"id": "p1", "label": "1a",
             "source": {"kind": "corpus", "start": start, "end": start + 4}},
            {"id": "p2", "label": "1b",
             "source": {"kind": "corpus", "start": start + 5, "end": end}},
        ],
        "forest": [
            {
                "kind": "bracket", "rel": "Ser", "prominent": None,
                "children": [
                    {"kind": "prop", "ref": "p1"},
                    {"kind": "prop", "ref": "p2"},
                ],
            },
        ],
    }


@pytest.mark.django_db
class TestAnalysisCrud:
    def test_round_trip(self, client, john_1_1):
        document = small_document(john_1_1)

        # Create — no title: derived from the alignment-based passage ref.
        created = client.post("/api/analyses", {"document": document}, format="json")
        assert created.status_code == 201
        body = created.json()
        pk = body["id"]
        assert body["passageRef"] == "John 1:1"
        assert body["title"] == "John 1:1"
        assert body["document"] == document
        assert "updatedAt" in body

        # List — newest first, list shape has no document.
        second = client.post(
            "/api/analyses",
            {"title": "Second", "document": document},
            format="json",
        )
        assert second.status_code == 201
        listed = client.get("/api/analyses").json()
        assert [row["title"] for row in listed] == ["Second", "John 1:1"]
        assert set(listed[0]) == {"id", "title", "passageRef", "updatedAt"}

        # Detail.
        detail = client.get(f"/api/analyses/{pk}").json()
        assert detail["document"] == document
        assert set(detail) == {"id", "title", "passageRef", "document", "notes", "updatedAt"}

        # Update title and document; passage_ref re-derives from the document.
        smaller = {
            "schemaVersion": 2,
            "propositions": [
                {"id": "q1", "label": "1a",
                 "source": {"kind": "corpus",
                            "start": john_1_1.start, "end": john_1_1.start + 4}},
            ],
            "forest": [{"kind": "prop", "ref": "q1"}],
        }
        updated = client.put(
            f"/api/analyses/{pk}",
            {"title": "In the beginning", "document": smaller},
            format="json",
        )
        assert updated.status_code == 200
        assert updated.json()["title"] == "In the beginning"
        assert updated.json()["passageRef"] == "John 1:1"
        assert updated.json()["document"] == smaller
        assert client.get(f"/api/analyses/{pk}").json()["document"] == smaller

        # Delete — soft: it reads as gone, and drops out of the listing.
        assert client.delete(f"/api/analyses/{pk}").status_code == 204
        assert client.get(f"/api/analyses/{pk}").status_code == 404
        assert [row["title"] for row in client.get("/api/analyses").json()] == ["Second"]

    def test_notes_round_trip(self, client, john_1_1):
        """Notes are free text on the analysis: empty by default, saved by PUT."""
        created = client.post(
            "/api/analyses", {"document": small_document(john_1_1)}, format="json"
        ).json()
        assert created["notes"] == ""
        pk = created["id"]

        saved = client.put(f"/api/analyses/{pk}", {"notes": "  ἐν ἀρχῇ — the echo of Gen 1:1  "}, format="json")
        assert saved.status_code == 200
        # Kept verbatim: whitespace is the writer's, not ours to trim.
        assert saved.json()["notes"] == "  ἐν ἀρχῇ — the echo of Gen 1:1  "
        assert client.get(f"/api/analyses/{pk}").json()["notes"] == "  ἐν ἀρχῇ — the echo of Gen 1:1  "

        # A document-only save leaves the notes alone.
        client.put(f"/api/analyses/{pk}", {"document": small_document(john_1_1)}, format="json")
        assert client.get(f"/api/analyses/{pk}").json()["notes"].strip().startswith("ἐν ἀρχῇ")

    def test_notes_must_be_a_string(self, client, john_1_1):
        pk = client.post(
            "/api/analyses", {"document": small_document(john_1_1)}, format="json"
        ).json()["id"]
        bad = client.put(f"/api/analyses/{pk}", {"notes": 5}, format="json")
        assert bad.status_code == 400
        assert bad.json()["errors"] == ["notes must be a string"]

    def test_create_disconnected_forest(self, client, john_1_1):
        """A partly connected analysis — two roots — saves and reads back."""
        document = small_document(john_1_1)
        document["forest"] = [
            {"kind": "prop", "ref": "p1"},
            {"kind": "prop", "ref": "p2"},
        ]
        created = client.post("/api/analyses", {"document": document}, format="json")
        assert created.status_code == 201
        assert created.json()["document"] == document
        assert created.json()["passageRef"] == "John 1:1"

    def test_create_legacy_v1_document_accepted(self, client, john_1_1):
        """Validator tolerance: a v1 single-tree document still writes."""
        v2 = small_document(john_1_1)
        legacy = {
            "schemaVersion": 1,
            "propositions": v2["propositions"],
            "tree": v2["forest"][0],
        }
        created = client.post("/api/analyses", {"document": legacy}, format="json")
        assert created.status_code == 201
        assert created.json()["document"] == legacy
        assert created.json()["passageRef"] == "John 1:1"

    def test_create_invalid_document_400(self, client, john_1_1):
        document = small_document(john_1_1)
        document["forest"][0]["rel"] = "Zorp"
        document["forest"][0]["prominent"] = 5
        response = client.post("/api/analyses", {"document": document}, format="json")
        assert response.status_code == 400
        errors = response.json()["errors"]
        assert isinstance(errors, list) and errors
        assert any("Zorp" in e for e in errors)

    def test_create_without_document_400(self, client):
        response = client.post("/api/analyses", {"title": "empty"}, format="json")
        assert response.status_code == 400
        assert response.json()["errors"]

    def test_create_range_beyond_corpus_400(self, client):
        n = len(load_words())
        document = {
            "schemaVersion": 2,
            "propositions": [
                {"id": "p1", "label": "1",
                 "source": {"kind": "corpus", "start": n, "end": n + 3}},
            ],
            "forest": [{"kind": "prop", "ref": "p1"}],
        }
        response = client.post("/api/analyses", {"document": document}, format="json")
        assert response.status_code == 400
        assert any("corpus" in e for e in response.json()["errors"])

    def test_update_invalid_document_leaves_row_untouched(self, client, john_1_1):
        document = small_document(john_1_1)
        pk = client.post(
            "/api/analyses", {"document": document}, format="json"
        ).json()["id"]
        bad = dict(document, forest=[{"kind": "prop", "ref": "nope"}])
        response = client.put(f"/api/analyses/{pk}", {"document": bad}, format="json")
        assert response.status_code == 400
        assert client.get(f"/api/analyses/{pk}").json()["document"] == document

    def test_detail_404(self, client):
        assert client.get("/api/analyses/999999").status_code == 404


class TestFirstPass:
    def test_blank_text_400(self, client):
        assert client.post("/api/first-pass", {"text": "   "}, format="json").status_code == 400
        assert client.post("/api/first-pass", {}, format="json").status_code == 400
        assert client.post("/api/first-pass", {"text": 7}, format="json").status_code == 400

    def test_real_first_pass(self, client):
        pytest.importorskip("da.firstpass")
        response = client.post("/api/first-pass", {"text": JOHN_1_1}, format="json")
        assert response.status_code == 200
        body = response.json()
        document, alignment = body["document"], body["alignment"]
        assert document["schemaVersion"] == 2
        # Fully analyzed: every proposition connected into one tree.
        assert document["propositions"]
        assert len(document["forest"]) == 1
        assert alignment is not None
        assert alignment["ref"] == "John 1:1"
        assert alignment["exact"] is True
        assert alignment["matchedTokens"] == alignment["totalTokens"] == 17
        assert alignment["mismatchedPositions"] == []
        assert alignment["end"] - alignment["start"] == 16

    def test_mocked_first_pass(self, client, monkeypatch):
        """Stub the firstpass boundary — works whether or not the module exists."""
        stub_document = {
            "schemaVersion": 2,
            "propositions": [
                {"id": "p1", "label": "1", "source": {"kind": "raw", "text": "stub"}},
            ],
            "forest": [{"kind": "prop", "ref": "p1"}],
        }
        result = types.SimpleNamespace(document=stub_document, alignment=None)
        calls = []

        def fake_first_pass(text):
            calls.append(text)
            return result

        try:
            import da.firstpass as firstpass_module
        except ImportError:
            firstpass_module = types.ModuleType("da.firstpass")
            monkeypatch.setitem(sys.modules, "da.firstpass", firstpass_module)
        monkeypatch.setattr(
            firstpass_module, "first_pass", fake_first_pass, raising=False
        )

        response = client.post("/api/first-pass", {"text": "ψευδόμεθα"}, format="json")
        assert response.status_code == 200
        assert response.json() == {"document": stub_document, "alignment": None}
        assert calls == ["ψευδόμεθα"]


class TestTaxonomy:
    def test_eighteen_entries(self, client):
        response = client.get("/api/taxonomy")
        assert response.status_code == 200
        entries = response.json()
        assert len(entries) == 18
        by_code = {e["code"]: e for e in entries}
        assert by_code["Ser"]["coordinate"] is True
        assert by_code["Ser"]["starredLabel"] is None
        assert by_code["Grnd"]["starredLabel"] == 0
        assert set(entries[0]) == {
            "code", "name", "family", "symbol", "labels", "starredLabel", "coordinate",
            "description",
        }
        # Every relationship explains itself — the menu's "i" has nothing to
        # fall back on.
        assert all(e["description"].strip() for e in entries)
        assert "because" in by_code["Grnd"]["description"]


class TestCorpusWords:
    def test_happy_path(self, client):
        response = client.get("/api/corpus/words", {"start": 0, "end": 4})
        assert response.status_code == 200
        rows = response.json()
        assert len(rows) == 5
        first = rows[0]
        assert first["index"] == 0
        assert first["text"] == "Βίβλος"
        assert first["bookName"] == "Matthew"
        assert (first["book"], first["chapter"], first["verse"]) == (1, 1, 1)
        assert set(first) == {
            "index", "text", "word", "norm", "lemma", "pos", "parsing",
            "book", "bookName", "chapter", "verse", "translit", "gloss", "eng",
            "engOrd",
        }
        assert [r["index"] for r in rows] == [0, 1, 2, 3, 4]

    def test_range_cap(self, client):
        ok = client.get("/api/corpus/words", {"start": 0, "end": 1999})
        assert ok.status_code == 200
        assert len(ok.json()) == 2000
        over = client.get("/api/corpus/words", {"start": 0, "end": 2000})
        assert over.status_code == 400
        assert any("cap" in e for e in over.json()["errors"])

    def test_bad_ranges(self, client):
        n = len(load_words())
        for params in (
            {},                                # missing both
            {"start": 5},                      # missing end
            {"start": "x", "end": "3"},        # non-integer
            {"start": 5, "end": 2},            # start > end
            {"start": -3, "end": 2},           # negative
            {"start": n - 1, "end": n},        # past the corpus
        ):
            response = client.get("/api/corpus/words", params)
            assert response.status_code == 400, params
            assert response.json()["errors"], params


@pytest.mark.django_db
class TestRecentlyDeleted:
    """Deleting is a move, not an end: the analysis waits in Recently Deleted
    until it is restored or its window runs out."""

    def test_deleted_analysis_waits_in_the_trash_and_restores(self, client, john_1_1):
        pk = client.post(
            "/api/analyses", {"title": "Doomed", "document": small_document(john_1_1)},
            format="json",
        ).json()["id"]

        assert client.delete(f"/api/analyses/{pk}").status_code == 204
        assert client.get("/api/analyses").json() == []

        trash = client.get("/api/analyses/deleted").json()
        assert [row["title"] for row in trash] == ["Doomed"]
        assert set(trash[0]) == {"id", "title", "passageRef", "updatedAt", "deletedAt", "daysLeft"}
        assert trash[0]["daysLeft"] == TRASH_DAYS

        restored = client.post(f"/api/analyses/{pk}/restore")
        assert restored.status_code == 200
        assert restored.json()["title"] == "Doomed"
        assert [row["title"] for row in client.get("/api/analyses").json()] == ["Doomed"]
        assert client.get("/api/analyses/deleted").json() == []
        assert client.get(f"/api/analyses/{pk}").status_code == 200

    def test_restoring_a_live_analysis_is_a_404(self, client, john_1_1):
        pk = client.post(
            "/api/analyses", {"document": small_document(john_1_1)}, format="json"
        ).json()["id"]
        assert client.post(f"/api/analyses/{pk}/restore").status_code == 404

    def test_purge_removes_the_row_for_good(self, client, john_1_1):
        pk = client.post(
            "/api/analyses", {"document": small_document(john_1_1)}, format="json"
        ).json()["id"]
        client.delete(f"/api/analyses/{pk}")
        assert client.delete(f"/api/analyses/{pk}?purge=1").status_code == 204
        assert client.get("/api/analyses/deleted").json() == []
        assert not Analysis.objects.filter(pk=pk).exists()

    def test_listing_the_trash_purges_what_has_expired(self, client, john_1_1):
        from datetime import timedelta

        from django.utils import timezone

        fresh = client.post(
            "/api/analyses", {"title": "Fresh", "document": small_document(john_1_1)},
            format="json",
        ).json()["id"]
        stale = client.post(
            "/api/analyses", {"title": "Stale", "document": small_document(john_1_1)},
            format="json",
        ).json()["id"]
        client.delete(f"/api/analyses/{fresh}")
        client.delete(f"/api/analyses/{stale}")
        Analysis.objects.filter(pk=stale).update(
            deleted_at=timezone.now() - timedelta(days=TRASH_DAYS, hours=1)
        )

        assert [row["title"] for row in client.get("/api/analyses/deleted").json()] == ["Fresh"]
        assert not Analysis.objects.filter(pk=stale).exists()
