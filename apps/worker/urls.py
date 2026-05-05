"""
URL routing for the worker app.

Mount in your project's urls.py:

    urlpatterns = [
        ...,
        path("api/", include("worker.urls")),
    ]

Endpoints:
    POST /api/track/<id>/played/   - record a play (called by SPA)
"""

from django.urls import path

from . import views

urlpatterns = [
    path(
        "track/<int:track_id>/played/",
        views.track_played,
        name="track_played",
    ),
]