from django.urls import path

from . import views

urlpatterns = [
    path("analyses", views.AnalysisListCreateView.as_view()),
    path("analyses/deleted", views.DeletedAnalysisListView.as_view()),
    path("analyses/<int:pk>", views.AnalysisDetailView.as_view()),
    path("analyses/<int:pk>/restore", views.AnalysisRestoreView.as_view()),
    path("first-pass", views.FirstPassView.as_view()),
    path("corpus/words", views.CorpusWordsView.as_view()),
    path("corpus/verses", views.CorpusVersesView.as_view()),
    path("taxonomy", views.TaxonomyView.as_view()),
]
