"""
Signal handlers that keep D1 in sync with Django's Track model.

When a Track is saved (created or updated), we push its path data to
the Worker. When deleted, we tell the Worker to drop the row.

These run in the same process as the admin save, so they slow the admin
slightly. With the 5s timeout in services.py, the worst case is a 5s
delay on save during a Worker outage. If you want to make this fully
async (so admin saves never wait), wrap the calls in a background task
queue (Celery, django-q, etc.) — see comments below.
"""

from __future__ import annotations

import logging

from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from . import services

# Replace this import with the actual location of your Track model.
# The example assumes Track is in an app called `music`.
from api.models import Track

logger = logging.getLogger(__name__)


@receiver(post_save, sender=Track)
def track_saved(sender, instance: Track, created: bool, **kwargs):
    """
    Push the track's path to D1 whenever it changes.

    Note: bulk_create() and queryset.update() do NOT fire post_save by
    default. If you do bulk operations, run `manage.py sync_d1 --all`
    afterwards to bring D1 in line.
    """
    try:
        # Resolve the album's folder_path. If you pre-fetch this in
        # production code paths, this query is free.
        folder_path = instance.album.folder_path
    except Exception as exc:
        logger.error("track_saved: cannot resolve album for track %s: %s",
                     instance.id, exc)
        return

    services.upsert_track(
        track_id=instance.id,
        folder_path=folder_path,
        mp3=instance.mp3,
    )


@receiver(post_delete, sender=Track)
def track_deleted(sender, instance: Track, **kwargs):
    """Tell the Worker the track is gone."""
    services.delete_track(track_id=instance.id)


# ---------------------------------------------------------------------------
# Optional: async fan-out
# ---------------------------------------------------------------------------
#
# If you find admin saves are noticeably slower because of the sync,
# wrap the upsert/delete calls in a background task. Example with Celery:
#
#     @shared_task
#     def upsert_track_async(track_id, folder_path, mp3):
#         services.upsert_track(track_id, folder_path, mp3)
#
#     @receiver(post_save, sender=Track)
#     def track_saved(sender, instance, created, **kwargs):
#         upsert_track_async.delay(
#             instance.id,
#             instance.album.folder_path,
#             instance.mp3,
#         )
#
# For your current scale (admin edits are rare), the synchronous version
# is simpler and works well. Start there.
