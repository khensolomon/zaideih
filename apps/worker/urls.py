"""
URL routing for worker_sync.

Mount in your project's urls.py:

    urlpatterns = [
        ...,
        path("api/internal/", include("worker_sync.urls")),
    ]

This puts the play-increment endpoint at:
    POST /api/internal/track/<id>/play/
"""

from django.urls import path

from . import views

urlpatterns = [
    path(
        "track/<int:track_id>/play/",
        views.track_play,
        name="worker_sync_track_play",
    ),
]
