from django.contrib import admin

from .models import Analysis


@admin.register(Analysis)
class AnalysisAdmin(admin.ModelAdmin):
    list_display = ("id", "title", "passage_ref", "owner", "updated_at")
    list_filter = ("owner",)
    search_fields = ("title", "passage_ref")
    readonly_fields = ("created_at", "updated_at")
