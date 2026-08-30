import os

from django.apps import AppConfig


class DaConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "da"

    def ready(self):
        # Warm the corpus tables at import time so gunicorn --preload loads
        # them ONCE in the master and the workers share them copy-on-write.
        # Without this the tables load lazily on each worker's first request
        # (~0.5s each). DA_SKIP_WARMUP opts out for one-off management
        # commands that never touch the corpus.
        if os.environ.get("DA_SKIP_WARMUP") == "1":
            return
        from .corpus import load_words
        from .corpus.interlinear import _table as interlinear_table
        from .corpus.structure import _table as structure_table
        from .corpus.translation import load_translation

        load_words()
        interlinear_table()
        structure_table()
        load_translation()
