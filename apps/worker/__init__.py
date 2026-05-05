"""
worker app — Django side of the Cloudflare audio Worker integration.

Responsibilities:
  - Push track path/file data to the Worker's D1 (one-way sync).
  - Receive play notifications from the SPA (public POST endpoint).
  - Provide management commands for bulk sync and connectivity check.

The Worker does NOT call into Django anymore. Plays are reported by the
SPA directly to /api/track/<id>/played/ since the Worker can't observe
plays after the browser caches the audio response.

Layout:
    worker/
        __init__.py
        apps.py             - ready() hook to register signals
        services.py         - HTTP client (sync calls only now)
        signals.py          - post_save / post_delete handlers on Track
        views.py            - /api/track/<id>/played/ public endpoint
        urls.py             - URL routing for the played endpoint
        management/
            __init__.py
            commands/
                __init__.py
                sync_d1.py  - bulk-sync command
                check_d1.py - connectivity check

Settings (in your project's settings.py):

    INSTALLED_APPS = [
        ...,
        "worker",
    ]

    WORKER_URL = env("WORKER_URL", default="https://media.example.com")
    APP_SECRET_SHARED = env("APP_SECRET_SHARED")

URL routing (in your project's urls.py):

    urlpatterns = [
        ...,
        path("api/", include("worker.urls")),
    ]
"""