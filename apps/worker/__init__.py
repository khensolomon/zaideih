"""
worker app — bridge between Django and the Cloudflare audio Worker.

Layout:
    worker/
        __init__.py
        apps.py             - ready() hook to register signals
        services.py         - HTTP client that calls the Worker
        signals.py          - post_save / post_delete handlers on Track
        views.py            - /api/internal/track/<id>/play/ endpoint
        urls.py             - URL routing for views
        management/
            __init__.py
            commands/
                __init__.py
                sync_d1.py  - bulk-sync command for initial load / recovery
                check_d1.py - sanity check the connection to the Worker

Settings additions (in your project's settings.py):

    INSTALLED_APPS = [
        ...,
        "worker",
    ]

    # Where the audio Worker lives. Must be reachable from the Django host.
    WORKER_URL = env("WORKER_URL", default="https://api.example.com")

    # Same secret you set on the Worker via `wrangler secret put WORKER_SECRET_SHARED`.
    # Keep this in env vars / .env, NEVER commit it.
    APP_SECRET_SHARED = env("APP_SECRET_SHARED")

URL routing (in your project's urls.py):

    urlpatterns = [
        ...,
        path("api/internal/", include("worker.urls")),
    ]
"""
